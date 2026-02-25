//
//  APIService.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/18/25.
//  Updated with automatic token refresh on 401 errors
//

import Foundation
import UIKit

enum APIError: Error {
    case invalidURL
    case noData
    case decodingError
    case serverError(String)
    case unauthorized
    case notFound
    case timeout
    case networkError(String, isRetryable: Bool)
    case subscriptionRequired(reason: String, trialExpired: Bool)
    case freeTierLimitReached(feature: String, used: Int, limit: Int)
    case consentRequired
}

extension APIError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noData:
            return "No data received"
        case .decodingError:
            return "Failed to decode response"
        case .serverError(let message):
            return message
        case .unauthorized:
            return "Session expired. Please log in again."
        case .notFound:
            return "Resource not found"
        case .timeout:
            return "Request timed out. Please try again."
        case .networkError(let message, _):
            return message
        case .subscriptionRequired(let reason, _):
            return reason
        case .freeTierLimitReached(let feature, _, _):
            return "You've reached your free limit for \(feature). Upgrade to continue."
        case .consentRequired:
            return "AI data sharing consent is required. Please grant consent in Settings > Data & Privacy."
        }
    }
}

class APIService {
    static let shared = APIService()
    
    // Separate session for long-running operations like transcription
    private lazy var longRunningSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300 // 5 minutes
        config.timeoutIntervalForResource = 600 // 10 minutes
        return URLSession(configuration: config)
    }()

    private init() {}

    // MARK: - Consent Check

    /// Checks if the user has granted AI data sharing consent.
    private func requireAIConsent() async throws {
        let hasConsent = await MainActor.run { AIDataConsentManager.shared.hasConsented }
        guard hasConsent else {
            throw APIError.consentRequired
        }
    }

    // MARK: - Dynamic Timeout Helper

    /// Calculate appropriate timeout based on content size
    /// Larger notes require more processing time on the server
    private func calculateTimeout(forContentLength contentLength: Int, baseTimeout: TimeInterval = 60) -> TimeInterval {
        // Base timeout: 60 seconds for small content
        // Add 30 seconds per 100K characters (roughly 17K words)
        // Cap at 5 minutes (300 seconds)
        let additionalTime = TimeInterval(contentLength / 100_000) * 30
        let totalTimeout = baseTimeout + additionalTime
        return min(totalTimeout, 300) // Cap at 5 minutes
    }

    /// Create a URLSession with dynamic timeout based on content length
    private func sessionForContent(length: Int) -> URLSession {
        let timeout = calculateTimeout(forContentLength: length)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout + 60 // Extra buffer for resource timeout
        print("⏱️ Using dynamic timeout: \(Int(timeout))s for content length: \(length)")
        return URLSession(configuration: config)
    }

    // MARK: - Retry Logic with Exponential Backoff

    /// Configuration for retry behavior
    private struct RetryConfig {
        let maxAttempts: Int
        let baseDelay: TimeInterval
        let maxDelay: TimeInterval

        static let upload = RetryConfig(maxAttempts: 3, baseDelay: 1.0, maxDelay: 8.0)
        static let transcribe = RetryConfig(maxAttempts: 2, baseDelay: 2.0, maxDelay: 8.0)
    }

    /// Check if an error is retryable (transient network issues)
    private func isRetryableError(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .networkConnectionLost,      // Connection dropped mid-request
                 .notConnectedToInternet,     // No network
                 .timedOut,                   // Request timed out
                 .cannotConnectToHost,        // Server unreachable
                 .cannotFindHost,             // DNS resolution failed
                 .dnsLookupFailed,            // DNS lookup failed
                 .dataNotAllowed,             // Cellular data disabled
                 .internationalRoamingOff:    // Roaming disabled
                return true
            default:
                return false
            }
        }
        return false
    }

    /// Convert URLError to user-friendly APIError
    private func convertNetworkError(_ error: URLError) -> APIError {
        let isRetryable = isRetryableError(error)

        let message: String
        switch error.code {
        case .networkConnectionLost:
            message = "Network connection was lost. Please check your connection and try again."
        case .notConnectedToInternet:
            message = "No internet connection. Please check your network settings."
        case .timedOut:
            message = "The request timed out. Please try again."
        case .cannotConnectToHost, .cannotFindHost:
            message = "Unable to reach the server. Please try again later."
        case .dataNotAllowed:
            message = "Cellular data is disabled. Please enable it or connect to Wi-Fi."
        default:
            message = "A network error occurred. Please try again."
        }

        return .networkError(message, isRetryable: isRetryable)
    }

    // MARK: - Subscription Error Handling

    /// Response structure for subscription-related 403 errors
    private struct SubscriptionErrorResponse: Codable {
        let success: Bool
        let error: String
        let code: String?
        let details: SubscriptionErrorDetails?
    }

    private struct SubscriptionErrorDetails: Codable {
        let reason: String?
        let trialExpired: Bool?
        let trialDaysRemaining: Int?
        let featureType: String?
        let used: Int?
        let limit: Int?
        let upgradeRequired: Bool?
        let feature: String?
    }

    /// Check if response is a subscription error and throw appropriate APIError
    private func checkForSubscriptionError(statusCode: Int, data: Data) throws {
        guard statusCode == 403 else { return }

        do {
            let errorResponse = try JSONDecoder().decode(SubscriptionErrorResponse.self, from: data)

            if errorResponse.code == "SUBSCRIPTION_REQUIRED" {
                let reason = errorResponse.details?.reason ?? errorResponse.error
                let trialExpired = errorResponse.details?.trialExpired ?? false
                throw APIError.subscriptionRequired(reason: reason, trialExpired: trialExpired)
            }

            if errorResponse.code == "FREE_TIER_LIMIT_REACHED" {
                let feature = errorResponse.details?.featureType ?? errorResponse.details?.feature ?? "this feature"
                let used = errorResponse.details?.used ?? 0
                let limit = errorResponse.details?.limit ?? 0
                throw APIError.freeTierLimitReached(feature: feature, used: used, limit: limit)
            }

            // Generic 403 error
            throw APIError.serverError(errorResponse.error)
        } catch let apiError as APIError {
            throw apiError
        } catch {
            // If decoding fails, throw generic 403 error
            throw APIError.serverError("Access denied")
        }
    }

    /// Execute an operation with retry logic and exponential backoff
    private func executeWithRetry<T>(
        config: RetryConfig,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        var lastError: Error?

        for attempt in 1...config.maxAttempts {
            do {
                return try await operation()
            } catch {
                lastError = error

                // Check if this is a retryable error
                if isRetryableError(error), attempt < config.maxAttempts {
                    // Calculate delay with exponential backoff: baseDelay * 2^(attempt-1)
                    let delay = min(config.baseDelay * pow(2.0, Double(attempt - 1)), config.maxDelay)
                    print("⚠️ Attempt \(attempt)/\(config.maxAttempts) failed: \(error.localizedDescription)")
                    print("🔄 Retrying in \(delay) seconds...")

                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                } else {
                    // Non-retryable error or last attempt - throw immediately
                    if let urlError = error as? URLError {
                        throw convertNetworkError(urlError)
                    }
                    throw error
                }
            }
        }

        // If we get here, all retries failed
        if let urlError = lastError as? URLError {
            throw convertNetworkError(urlError)
        }
        throw lastError ?? APIError.serverError("Unknown error after retries")
    }

    // MARK: - Language Preference Helper

    private func getPreferredLanguage() -> String {
        return UserDefaults.standard.string(forKey: "preferred_language") ?? "english"
    }
    
    /// Execute an API request with automatic token refresh on 401
    private func executeWithTokenRefresh<T>(
        _ operation: @escaping (String) async throws -> T,
        hasRetriedOnce: Bool = false
    ) async throws -> T {
        // Get a valid token (will refresh if expired)
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }
        
        do {
            return try await operation(token)
        } catch APIError.unauthorized {
            // If we already retried once, don't retry again
            if hasRetriedOnce {
                print("❌ Still unauthorized after token refresh, clearing tokens")
                TokenManager.shared.clearTokens()
                throw APIError.unauthorized
            }
            
            print("🔄 Got 401, attempting token refresh...")
            
            // Try to refresh the token
            guard let newToken = await TokenManager.shared.refreshTokenIfNeeded() else {
                print("❌ Token refresh failed")
                TokenManager.shared.clearTokens()
                throw APIError.unauthorized
            }
            
            print("🔄 Retrying request with new token...")
            
            // Retry the operation with the new token
            return try await operation(newToken)
        }
    }
    
    // MARK: - Notes

    /// Result type for paginated notes fetch
    struct PaginatedNotesResult {
        let notes: [Note]
        let pagination: NotesPagination?
    }

    func fetchNotes(token: String, page: Int = 1, limit: Int = 20) async throws -> [Note] {
        // Use the token refresh wrapper - backwards compatible, returns just notes
        return try await executeWithTokenRefresh { validToken in
            let result = try await self._fetchNotes(token: validToken, page: page, limit: limit)
            return result.notes
        }
    }

    func fetchNotesPaginated(token: String, page: Int = 1, limit: Int = 20) async throws -> PaginatedNotesResult {
        // Use the token refresh wrapper - returns notes with pagination info
        return try await executeWithTokenRefresh { validToken in
            try await self._fetchNotes(token: validToken, page: page, limit: limit)
        }
    }
    
    // MARK: - Analytics

    func trackAnalyticsEvent(token: String, event: [String: Any]) async throws {
        guard let url = URL(string: "\(Constants.baseURL)/api/analytics/event") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: event)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError("Failed to track event")
        }
    }
    
    private func _fetchNotes(token: String, page: Int = 1, limit: Int = 20) async throws -> PaginatedNotesResult {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.notes)?page=\(page)&limit=\(limit)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response - not HTTP")
        }

        let statusCode = httpResponse.statusCode

        if statusCode == 401 {
            throw APIError.unauthorized
        }

        guard statusCode == 200 else {
            let rawResponse = String(data: data, encoding: .utf8) ?? "Unable to decode response"
            let errorResponse = try? JSONDecoder().decode(NotesResponse.self, from: data)
            let serverMessage = errorResponse?.error ?? "Unknown server error"
            #if DEBUG
            print("❌ Fetch notes failed - HTTP \(statusCode): \(rawResponse)")
            #endif
            throw APIError.serverError("HTTP \(statusCode): \(serverMessage)")
        }

        do {
            let notesResponse = try JSONDecoder().decode(NotesResponse.self, from: data)
            return PaginatedNotesResult(
                notes: notesResponse.data ?? [],
                pagination: notesResponse.pagination
            )
        } catch {
            let rawResponse = String(data: data, encoding: .utf8) ?? "Unable to decode response"
            #if DEBUG
            print("❌ Fetch notes decode error: \(error)")
            print("📄 Raw response: \(rawResponse.prefix(500))")
            #endif
            throw APIError.serverError("Decode error: \(error.localizedDescription) | Response: \(rawResponse.prefix(200))")
        }
    }
    
    func fetchNoteById(token: String, noteId: String) async throws -> Note {
        return try await executeWithTokenRefresh { validToken in
            try await self._fetchNoteById(token: validToken, noteId: noteId)
        }
    }
    
    private func _fetchNoteById(token: String, noteId: String) async throws -> Note {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.notes)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch note")
        }
        
        let noteResponse = try JSONDecoder().decode(NoteResponse.self, from: data)
        
        guard let note = noteResponse.data else {
            throw APIError.noData
        }
        
        return note
    }
    
    func deleteNote(token: String, noteId: String) async throws {
        try await executeWithTokenRefresh { validToken in
            try await self._deleteNote(token: validToken, noteId: noteId)
        }
    }
    
    private func _deleteNote(token: String, noteId: String) async throws {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.notes)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 200 else {
            if let errorData = try? JSONDecoder().decode([String: String].self, from: data),
               let errorMessage = errorData["error"] {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to delete note")
        }
    }

    func updateNote(token: String, noteId: String, title: String? = nil, content: String? = nil) async throws -> Note {
        return try await executeWithTokenRefresh { validToken in
            try await self._updateNote(token: validToken, noteId: noteId, title: title, content: content)
        }
    }

    private func _updateNote(token: String, noteId: String, title: String? = nil, content: String? = nil) async throws -> Note {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.notes)/\(noteId)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [:]
        if let title = title { body["title"] = title }
        if let content = content { body["content"] = content }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            if let errorData = try? JSONDecoder().decode([String: String].self, from: data),
               let errorMessage = errorData["error"] {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to update note")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let noteResponse = try decoder.decode(NoteResponse.self, from: data)

        guard let note = noteResponse.data else {
            throw APIError.serverError("No note data in response")
        }

        return note
    }

    func createNote(token: String, title: String, content: String, sourceType: String = "manual", sourceUrl: String? = nil, metadata: [String: Any]? = nil) async throws -> Note {
        return try await executeWithTokenRefresh { validToken in
            try await self._createNote(token: validToken, title: title, content: content, sourceType: sourceType, sourceUrl: sourceUrl, metadata: metadata)
        }
    }

    private func _createNote(token: String, title: String, content: String, sourceType: String, sourceUrl: String?, metadata: [String: Any]?) async throws -> Note {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.notes)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "title": title,
            "content": content,
            "source_type": sourceType
        ]
        if let sourceUrl = sourceUrl { body["source_url"] = sourceUrl }
        if let metadata = metadata { body["metadata"] = metadata }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        // Log response for debugging
        if let responseString = String(data: data, encoding: .utf8) {
            print("📝 Create note response: \(responseString)")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        print("📝 Create note status: \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 201 || httpResponse.statusCode == 200 else {
            if let errorData = try? JSONDecoder().decode([String: String].self, from: data),
               let errorMessage = errorData["error"] {
                print("❌ Create note error: \(errorMessage)")
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to create note")
        }

        do {
            let decoder = JSONDecoder()
            // Note: Don't use .convertFromSnakeCase since Note model has explicit CodingKeys
            let noteResponse = try decoder.decode(NoteResponse.self, from: data)

            guard let note = noteResponse.data else {
                throw APIError.serverError("No note data in response")
            }

            print("✅ Note created successfully: \(note.id)")
            return note
        } catch {
            print("❌ Failed to decode note response: \(error)")
            throw error
        }
    }

    // MARK: - Recording Upload & Transcription

    func uploadRecording(token: String, fileURL: URL, title: String? = nil) async throws -> Recording {
        return try await executeWithTokenRefresh { validToken in
            // Wrap upload in retry logic for network resilience
            try await self.executeWithRetry(config: .upload) {
                try await self._uploadRecording(token: validToken, fileURL: fileURL, title: title)
            }
        }
    }
    
    private func _uploadRecording(token: String, fileURL: URL, title: String? = nil) async throws -> Recording {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.uploadAudio)") else {
            throw APIError.invalidURL
        }
        
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120 // 2 minutes for upload
        
        var httpBody = Data()
        
        // Add audio file
        let fileData = try Data(contentsOf: fileURL)
        let filename = fileURL.lastPathComponent
        let mimeType = getMimeType(for: fileURL)
        
        print("📤 Uploading recording: \(filename), size: \(fileData.count) bytes")
        
        httpBody.append("--\(boundary)\r\n".data(using: .utf8)!)
        httpBody.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        httpBody.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        httpBody.append(fileData)
        httpBody.append("\r\n".data(using: .utf8)!)
        
        // Add title if provided
        if let title = title, !title.isEmpty {
            httpBody.append("--\(boundary)\r\n".data(using: .utf8)!)
            httpBody.append("Content-Disposition: form-data; name=\"title\"\r\n\r\n".data(using: .utf8)!)
            httpBody.append(title.data(using: .utf8)!)
            httpBody.append("\r\n".data(using: .utf8)!)
        }
        
        httpBody.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        request.httpBody = httpBody
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📤 Upload response: \(httpResponse.statusCode)")
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 201 else {
            let errorMessage = extractErrorMessage(from: data) ?? "Failed to upload recording (HTTP \(httpResponse.statusCode))"
            print("❌ Upload failed: \(errorMessage)")
            throw APIError.serverError(errorMessage)
        }
        
        let recordingResponse = try JSONDecoder().decode(RecordingResponse.self, from: data)
        
        guard let recording = recordingResponse.data else {
            throw APIError.noData
        }
        
        print("✅ Upload successful, recording_id: \(recording.id)")
        
        return recording
    }
    
    func transcribeRecording(token: String, recordingId: String) async throws -> TranscriptionResult {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            // Wrap transcription in retry logic for network resilience
            try await self.executeWithRetry(config: .transcribe) {
                try await self._transcribeRecording(token: validToken, recordingId: recordingId)
            }
        }
    }
    
    private func _transcribeRecording(token: String, recordingId: String) async throws -> TranscriptionResult {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.transcribe)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 300 // 5 minutes for transcription
        
        let body: [String: Any] = ["recording_id": recordingId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        print("🎤 Starting transcription for recording: \(recordingId)")
        
        do {
            // Use long-running session for transcription
            let (data, response) = try await longRunningSession.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError("Invalid response")
            }
            
            print("🎤 Transcription response: \(httpResponse.statusCode)")
            
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            
            guard httpResponse.statusCode == 200 else {
                let errorMessage = extractErrorMessage(from: data) ?? "Failed to transcribe recording (HTTP \(httpResponse.statusCode))"
                print("❌ Transcription failed: \(errorMessage)")
                throw APIError.serverError(errorMessage)
            }
            
            // Log raw response for debugging
            if let responseString = String(data: data, encoding: .utf8) {
                print("🎤 Transcription response body: \(responseString.prefix(500))...")
            }
            
            let transcriptionResponse = try JSONDecoder().decode(TranscriptionResponse.self, from: data)
            
            guard let result = transcriptionResponse.data else {
                throw APIError.noData
            }
            
            print("✅ Transcription successful, note_id: \(result.noteId ?? "unknown")")
            
            return result
            
        } catch let error as URLError where error.code == .timedOut {
            print("⏱️ Transcription timed out")
            throw APIError.timeout
        }
    }
    
    // MARK: - PDF Upload
    
    func uploadPDF(token: String, fileURL: URL) async throws -> Note {
        return try await executeWithTokenRefresh { validToken in
            try await self._uploadPDF(token: validToken, fileURL: fileURL)
        }
    }
    
    private func _uploadPDF(token: String, fileURL: URL) async throws -> Note {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.uploadPDF)") else {
            throw APIError.invalidURL
        }
        
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120 // 2 minutes for upload
        
        let httpBody = try createMultipartBody(
            boundary: boundary,
            fileURL: fileURL,
            fieldName: "file"
        )
        
        request.httpBody = httpBody
        
        print("📄 Uploading PDF: \(fileURL.lastPathComponent)")
        
        let (data, response) = try await longRunningSession.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📄 PDF upload response: \(httpResponse.statusCode)")
        
        // Log raw response for debugging
        if let responseString = String(data: data, encoding: .utf8) {
            print("📄 Response body: \(responseString)")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 201 || httpResponse.statusCode == 200 else {
            let errorMessage = extractErrorMessage(from: data) ?? "Failed to upload PDF (HTTP \(httpResponse.statusCode))"
            print("❌ PDF upload failed: \(errorMessage)")
            throw APIError.serverError(errorMessage)
        }
        
        // Try standard NoteResponse first (server returns { success, data: Note })
        do {
            let noteResponse = try JSONDecoder().decode(NoteResponse.self, from: data)
            if let note = noteResponse.data {
                print("✅ PDF upload successful, note_id: \(note.id)")
                return note
            }
        } catch {
            print("⚠️ Standard NoteResponse decode failed: \(error)")
        }
        
        // Try alternate format where result contains note
        do {
            struct PDFUploadResponse: Codable {
                let success: Bool
                let data: PDFResultData?
            }
            
            struct PDFResultData: Codable {
                let note: Note
            }
            
            let pdfResponse = try JSONDecoder().decode(PDFUploadResponse.self, from: data)
            if let note = pdfResponse.data?.note {
                print("✅ PDF upload successful (nested), note_id: \(note.id)")
                return note
            }
        } catch {
            print("⚠️ Nested format decode failed: \(error)")
        }
        
        print("❌ Could not parse PDF upload response")
        throw APIError.decodingError
    }
    
    // MARK: - Podcast APIs

    func getPodcast(token: String, noteId: String) async throws -> Podcast? {
        return try await executeWithTokenRefresh { validToken in
            try await self._getPodcast(token: validToken, noteId: noteId)
        }
    }
    
    private func _getPodcast(token: String, noteId: String) async throws -> Podcast? {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.podcast)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        if httpResponse.statusCode == 404 {
            return nil // No podcast exists yet
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch podcast")
        }
        
        let podcastResponse = try JSONDecoder().decode(PodcastResponse.self, from: data)
        return podcastResponse.data
    }

    // MARK: - AI Content APIs

    func getAIContent(token: String, noteId: String, contentType: String) async throws -> AIContent? {
        return try await executeWithTokenRefresh { validToken in
            try await self._getAIContent(token: validToken, noteId: noteId, contentType: contentType)
        }
    }
    
    private func _getAIContent(token: String, noteId: String, contentType: String) async throws -> AIContent? {
        // Use the unified endpoint to get all AI content for a note
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/note/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        // Log raw response for debugging
        if let jsonString = String(data: data, encoding: .utf8) {
            print("📦 Raw API response: \(jsonString)")
        }
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        if httpResponse.statusCode == 404 {
            return nil // No content exists yet
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch AI content")
        }
        
        
        // Response wrapper
        struct AIContentListResponse: Codable {
            let success: Bool
            let data: [AIContentItem]?
            let error: String?
        }
        
        // MARK: - AI Content Models

        struct AIContentItem: Codable {
            let id: String
            let noteId: String
            let contentType: String
            let content: AIContentData
            let createdAt: String
            
            enum CodingKeys: String, CodingKey {
                case id
                case noteId = "note_id"
                case contentType = "content_type"
                case content
                case createdAt = "created_at"
            }
        }

        struct AIContentData: Codable {
            let model: String?
            let questions: QuizQuestionsWrapper?
            let flashcards: [Flashcard]?
            let audioUrl: String?
            let duration: String?
            let style: String?
            let script: String?
            let numHosts: Int?
            let difficulty: String?
            let numQuestions: Int?
            let numCards: Int?
            let status: String?
            let summary: String?
            let length: String?
            // Mind map fields
            let title: String?
            let nodes: [MindMapNode]?

            enum CodingKeys: String, CodingKey {
                case model, questions, flashcards, duration, style, script, difficulty, status, summary, length, title, nodes
                case audioUrl = "audio_url"
                case numHosts = "num_hosts"
                case numQuestions = "num_questions"
                case numCards = "num_cards"
            }
        }

        struct QuizQuestionsWrapper: Codable {
            let quizQuestions: [QuizQuestion]?
            let quiz: [QuizQuestion]?
            
            enum CodingKeys: String, CodingKey {
                case quizQuestions = "quiz_questions"
                case quiz
            }
            
            // Custom decoder to handle both array and object formats
            init(from decoder: Decoder) throws {
                // Try to decode as direct array first
                if let questionsArray = try? decoder.singleValueContainer().decode([QuizQuestion].self) {
                    self.quizQuestions = questionsArray
                    self.quiz = nil
                } else {
                    // Fall back to object format
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    self.quizQuestions = try? container.decode([QuizQuestion].self, forKey: .quizQuestions)
                    self.quiz = try? container.decode([QuizQuestion].self, forKey: .quiz)
                }
            }
            
            // Get questions from either field
            var questions: [QuizQuestion] {
                return quizQuestions ?? quiz ?? []
            }
        }

        
        do {
            let listResponse = try JSONDecoder().decode(AIContentListResponse.self, from: data)
            
            guard let items = listResponse.data else {
                return nil
            }
            
            // Find the specific content type we're looking for
            guard let item = items.first(where: { $0.contentType == contentType }) else {
                return nil
            }
            
            // Convert flashcards (adding IDs)
            let flashcards = item.content.flashcards?.map { flashcardData in
                Flashcard(id: UUID().uuidString, front: flashcardData.front, back: flashcardData.back)
            }
            
            // Extract quiz questions wrapper
            let quizWrapper: QuizWrapper? = {
                if let questionsWrapper = item.content.questions {
                    let questions = questionsWrapper.questions
                    return questions.isEmpty ? nil : QuizWrapper(quizQuestions: questions)
                }
                return nil
            }()
            
            // Convert to AIContent
            return AIContent(
                id: item.id,
                noteId: noteId,
                audioUrl: item.content.audioUrl,
                duration: item.content.duration,
                status: item.content.status ?? "completed",
                questions: quizWrapper,
                flashcards: flashcards,
                summary: item.content.summary,
                mindMapTitle: item.content.title,
                mindMapNodes: item.content.nodes,
                createdAt: item.createdAt
            )
        } catch {
            print("❌ Decoding error: \(error)")
            throw error
        }
    }

    func generatePodcast(token: String, noteId: String, contentLength: Int = 0, duration: String = "short", gender: String = "female", instructions: String? = nil) async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generatePodcast(token: validToken, noteId: noteId, contentLength: contentLength, duration: duration, gender: gender, instructions: instructions)
        }
    }

    private func _generatePodcast(token: String, noteId: String, contentLength: Int, duration: String = "short", gender: String = "female", instructions: String? = nil) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/podcast") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var options: [String: Any] = [
            "generate_audio": true,
            "language": getPreferredLanguage(),
            "duration": duration,
            "gender": gender
        ]
        if let instructions = instructions, !instructions.isEmpty {
            options["instructions"] = instructions
        }

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "podcast",
            "options": options
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 Generating podcast...")
        print("   URL: \(url)")
        print("   Body: \(String(data: request.httpBody!, encoding: .utf8) ?? "")")

        // Use dynamic timeout based on content length
        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📥 Response status: \(httpResponse.statusCode)")
        if let responseString = String(data: data, encoding: .utf8) {
            print("   Response: \(responseString)")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        // Check for subscription errors (403)
        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? "Failed to generate podcast")
        }

        // Server returns immediately with status: 'generating'
        return AIContent(
            id: nil,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: "generating",
            questions: nil,
            flashcards: nil,
            summary: nil,
            createdAt: nil
        )
    }

    func generateQuiz(token: String, noteId: String, difficulty: String = "medium", numQuestions: Int = 5, contentLength: Int = 0) async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generateQuiz(token: validToken, noteId: noteId, difficulty: difficulty, numQuestions: numQuestions, contentLength: contentLength)
        }
    }

    private func _generateQuiz(token: String, noteId: String, difficulty: String = "medium", numQuestions: Int = 5, contentLength: Int) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/quiz") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "quiz",
            "options": [
                "difficulty": difficulty,
                "num_questions": numQuestions,
                "language": getPreferredLanguage()
            ]
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 Generating quiz...")
        print("   URL: \(url.absoluteString)")
        if let bodyString = String(data: request.httpBody!, encoding: .utf8) {
            print("   Body: \(bodyString)")
        }

        // Use dynamic timeout based on content length
        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📥 Response status: \(httpResponse.statusCode)")
        if let jsonString = String(data: data, encoding: .utf8) {
            print("   Response: \(jsonString)")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        // Check for subscription errors (403)
        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to generate quiz")
        }

        // Response structure for generate endpoint
        struct GenerateQuizResponse: Codable {
            let success: Bool
            let data: GenerateQuizData?
            let error: String?
        }
        
        struct GenerateQuizData: Codable {
            let id: String
            let noteId: String?
            let questions: QuizQuestionsWrapper
            let difficulty: String?
            
            enum CodingKeys: String, CodingKey {
                case id, questions, difficulty
                case noteId = "note_id"
            }
        }
        
        struct QuizQuestionsWrapper: Codable {
            let quizQuestions: [QuizQuestion]?
            let quiz: [QuizQuestion]?
            
            enum CodingKeys: String, CodingKey {
                case quizQuestions = "quiz_questions"
                case quiz
            }
            
            init(from decoder: Decoder) throws {
                // Try to decode as direct array first
                if let questionsArray = try? decoder.singleValueContainer().decode([QuizQuestion].self) {
                    self.quizQuestions = questionsArray
                    self.quiz = nil
                } else {
                    // Fall back to object format
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    self.quizQuestions = try? container.decode([QuizQuestion].self, forKey: .quizQuestions)
                    self.quiz = try? container.decode([QuizQuestion].self, forKey: .quiz)
                }
            }
            
            var questions: [QuizQuestion] {
                return quizQuestions ?? quiz ?? []
            }
        }
        
        let generateResponse = try JSONDecoder().decode(GenerateQuizResponse.self, from: data)
        
        guard let quizData = generateResponse.data else {
            throw APIError.serverError(generateResponse.error ?? "No quiz data returned")
        }
        
        // Extract questions using the computed property
        let questions = quizData.questions.questions
        
        guard !questions.isEmpty else {
            throw APIError.serverError("No questions generated")
        }
        
        print("✅ Successfully decoded \(questions.count) questions")
        
        // Convert to AIContent structure - wrap questions in QuizWrapper
        return AIContent(
            id: quizData.id,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: "completed",
            questions: QuizWrapper(quizQuestions: questions),
            flashcards: nil,
            summary: nil,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    func generateFlashcards(token: String, noteId: String, contentLength: Int = 0, count: Int = 20, instructions: String? = nil) async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generateFlashcards(token: validToken, noteId: noteId, contentLength: contentLength, count: count, instructions: instructions)
        }
    }

    private func _generateFlashcards(token: String, noteId: String, contentLength: Int, count: Int = 20, instructions: String? = nil) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/flashcards") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var options: [String: Any] = [
            "language": getPreferredLanguage(),
            "count": count
        ]
        if let instructions = instructions, !instructions.isEmpty {
            options["instructions"] = instructions
        }

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "flashcards",
            "options": options
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 POST \(url)")
        print("📦 Body: \(String(data: request.httpBody!, encoding: .utf8) ?? "")")

        // Use dynamic timeout based on content length
        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)
        
        // Log raw response
        if let jsonString = String(data: data, encoding: .utf8) {
            print("📦 Response: \(jsonString)")
        }
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        // Check for subscription errors (403)
        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? errorData?["details"] ?? "Failed to generate flashcards")
        }

        // Updated to match actual server response structure
        struct FlashcardsGenerateResponse: Codable {
            let success: Bool
            let data: FlashcardsGenerateData
        }
        
        struct FlashcardsGenerateData: Codable {
            let id: String
            let noteId: String
            let flashcards: [FlashcardData]
            
            enum CodingKeys: String, CodingKey {
                case id
                case noteId = "note_id"
                case flashcards
            }
        }
        
        struct FlashcardData: Codable {
            let front: String
            let back: String
        }
        
        let flashcardsResponse = try JSONDecoder().decode(FlashcardsGenerateResponse.self, from: data)
        
        print("✅ Decoded flashcards response: \(flashcardsResponse.data.flashcards.count) cards")
        
        // Convert FlashcardData to Flashcard (adding IDs)
        let flashcards = flashcardsResponse.data.flashcards.map { flashcardData in
            Flashcard(id: UUID().uuidString, front: flashcardData.front, back: flashcardData.back)
        }
        
        return AIContent(
            id: flashcardsResponse.data.id,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: nil,
            questions: nil,
            flashcards: flashcards,
            summary: nil,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }
    
    // MARK: - Mind Map Generation

    func generateMindMap(token: String, noteId: String, contentLength: Int = 0, includeExploration: Bool = true) async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generateMindMap(token: validToken, noteId: noteId, contentLength: contentLength, includeExploration: includeExploration)
        }
    }

    private func _generateMindMap(token: String, noteId: String, contentLength: Int, includeExploration: Bool) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/mindmap") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let options: [String: Any] = [
            "language": getPreferredLanguage(),
            "includeExploration": includeExploration
        ]

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "mindmap",
            "options": options
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 POST \(url)")
        print("📦 Body: \(String(data: request.httpBody!, encoding: .utf8) ?? "")")

        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)

        if let jsonString = String(data: data, encoding: .utf8) {
            print("📦 Mind Map Response: \(jsonString)")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? errorData?["details"] ?? "Failed to generate mind map")
        }

        struct MindMapGenerateResponse: Codable {
            let success: Bool
            let data: MindMapGenerateData?
            let error: String?
        }

        struct MindMapGenerateData: Codable {
            let id: String
            let noteId: String
            let title: String
            let nodes: [MindMapNodeData]

            enum CodingKeys: String, CodingKey {
                case id
                case noteId = "note_id"
                case title
                case nodes
            }
        }

        struct MindMapNodeData: Codable {
            let id: String
            let label: String
            let content: String
            let level: Int
            let parentId: String?
            let color: String?
            let isExploratory: Bool?
        }

        let mindMapResponse: MindMapGenerateResponse
        do {
            mindMapResponse = try JSONDecoder().decode(MindMapGenerateResponse.self, from: data)
        } catch let decodingError {
            print("❌ Mind Map decoding error: \(decodingError)")
            if let jsonString = String(data: data, encoding: .utf8) {
                print("❌ Raw response that failed to decode: \(jsonString)")
            }
            throw APIError.decodingError
        }

        // Check for error in response
        if let error = mindMapResponse.error {
            print("❌ Mind Map API error: \(error)")
            throw APIError.serverError(error)
        }

        guard let responseData = mindMapResponse.data else {
            print("❌ Mind Map response missing data")
            throw APIError.serverError("Failed to generate mind map - no data returned")
        }

        print("✅ Decoded mind map response: \(responseData.nodes.count) nodes")

        let nodes = responseData.nodes.map { nodeData in
            MindMapNode(
                id: nodeData.id,
                label: nodeData.label,
                content: nodeData.content,
                level: nodeData.level,
                parentId: nodeData.parentId,
                color: nodeData.color,
                isExploratory: nodeData.isExploratory
            )
        }

        return AIContent(
            id: responseData.id,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: nil,
            questions: nil,
            flashcards: nil,
            summary: nil,
            mindMapTitle: responseData.title,
            mindMapNodes: nodes,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    // MARK: - Infographic Generation

    func generateInfographic(token: String, noteId: String, contentLength: Int = 0, style: String = "modern") async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generateInfographic(token: validToken, noteId: noteId, contentLength: contentLength, style: style)
        }
    }

    private func _generateInfographic(token: String, noteId: String, contentLength: Int, style: String) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/infographic") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let options: [String: Any] = [
            "language": getPreferredLanguage(),
            "style": style
        ]

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "infographic",
            "options": options
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 POST \(url)")
        print("📦 Body: \(String(data: request.httpBody!, encoding: .utf8) ?? "")")

        // Use a longer timeout for DALL-E image generation (can take 30-60 seconds)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120 // 2 minutes for image generation
        config.timeoutIntervalForResource = 180 // 3 minutes total
        let session = URLSession(configuration: config)

        let (data, response) = try await session.data(for: request)

        if let jsonString = String(data: data, encoding: .utf8) {
            print("📦 Infographic Response: \(jsonString)")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? errorData?["details"] ?? "Failed to generate infographic")
        }

        struct InfographicGenerateResponse: Codable {
            let success: Bool
            let data: InfographicGenerateData?
            let error: String?
        }

        struct InfographicGenerateData: Codable {
            let id: String
            let noteId: String
            let imageUrl: String
            let extractedData: InfographicExtractedData?
            let style: String?

            enum CodingKeys: String, CodingKey {
                case id
                case noteId = "note_id"
                case imageUrl = "image_url"
                case extractedData = "extracted_data"
                case style
            }
        }

        let infographicResponse: InfographicGenerateResponse
        do {
            infographicResponse = try JSONDecoder().decode(InfographicGenerateResponse.self, from: data)
        } catch let decodingError {
            print("❌ Infographic decoding error: \(decodingError)")
            if let jsonString = String(data: data, encoding: .utf8) {
                print("❌ Raw response that failed to decode: \(jsonString)")
            }
            throw APIError.decodingError
        }

        if let error = infographicResponse.error {
            print("❌ Infographic API error: \(error)")
            throw APIError.serverError(error)
        }

        guard let responseData = infographicResponse.data else {
            print("❌ Infographic response missing data")
            throw APIError.serverError("Failed to generate infographic - no data returned")
        }

        print("✅ Decoded infographic response: \(responseData.imageUrl)")

        return AIContent(
            id: responseData.id,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: nil,
            questions: nil,
            flashcards: nil,
            summary: nil,
            mindMapTitle: nil,
            mindMapNodes: nil,
            infographicImageUrl: responseData.imageUrl,
            infographicExtractedData: responseData.extractedData,
            infographicStyle: responseData.style,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    func generateSummary(token: String, noteId: String, length: String, contentLength: Int = 0) async throws -> AIContent {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._generateSummary(token: validToken, noteId: noteId, length: length, contentLength: contentLength)
        }
    }

    private func _generateSummary(token: String, noteId: String, length: String, contentLength: Int) async throws -> AIContent {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/summary") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "note_id": noteId,
            "content_type": "summary",
            "options": [
                "length": length,
                "language": getPreferredLanguage()
            ]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 Generating summary...")
        print("   URL: \(url)")
        if let bodyString = String(data: request.httpBody!, encoding: .utf8) {
            print("   Body: \(bodyString)")
        }

        // Use dynamic timeout based on content length
        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📥 Response status: \(httpResponse.statusCode)")
        if let jsonString = String(data: data, encoding: .utf8) {
            print("   Response: \(jsonString)")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        // Check for subscription errors (403)
        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? "Failed to generate summary")
        }

        // Response structure for summary endpoint
        struct GenerateSummaryResponse: Codable {
            let success: Bool
            let data: GenerateSummaryData?
            let error: String?
        }
        
        struct GenerateSummaryData: Codable {
            let id: String
            let summary: String
            let length: String
            let noteId: String?
            
            enum CodingKeys: String, CodingKey {
                case id, summary, length
                case noteId = "note_id"
            }
        }
        
        let summaryResponse = try JSONDecoder().decode(GenerateSummaryResponse.self, from: data)
        
        guard let summaryData = summaryResponse.data else {
            throw APIError.serverError(summaryResponse.error ?? "No summary data returned")
        }
        
        print("✅ Successfully generated summary")
        
        // Convert to AIContent structure
        return AIContent(
            id: summaryData.id,
            noteId: noteId,
            audioUrl: nil,
            duration: nil,
            status: "completed",
            questions: nil,
            flashcards: nil,
            summary: summaryData.summary,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    func chatWithNote(token: String, noteId: String, question: String, conversationHistory: [ChatHistoryItem], contentLength: Int = 0) async throws -> ChatResponse {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._chatWithNote(token: validToken, noteId: noteId, question: question, conversationHistory: conversationHistory, contentLength: contentLength)
        }
    }

    private func _chatWithNote(token: String, noteId: String, question: String, conversationHistory: [ChatHistoryItem], contentLength: Int) async throws -> ChatResponse {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/chat") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "note_id": noteId,
            "question": question,
            "language": getPreferredLanguage(),
            "conversation_history": conversationHistory.map {
                ["text": $0.text, "isUser": $0.isUser]
            }
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("📤 Sending chat message...")
        print("   URL: \(url)")
        if let bodyString = String(data: request.httpBody!, encoding: .utf8) {
            print("   Body: \(bodyString)")
        }

        // Use dynamic timeout based on content length
        let session = contentLength > 0 ? sessionForContent(length: contentLength) : longRunningSession
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📥 Response status: \(httpResponse.statusCode)")
        if let jsonString = String(data: data, encoding: .utf8) {
            print("   Response: \(jsonString)")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        // Check for subscription errors (403)
        try checkForSubscriptionError(statusCode: httpResponse.statusCode, data: data)

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? "Failed to chat with note")
        }

        // Response structure for chat endpoint
        struct ChatApiResponse: Codable {
            let success: Bool
            let data: ChatResponse?
            let error: String?
        }

        let chatApiResponse = try JSONDecoder().decode(ChatApiResponse.self, from: data)

        guard let chatResponse = chatApiResponse.data else {
            throw APIError.serverError(chatApiResponse.error ?? "No chat response returned")
        }

        print("✅ Successfully received chat response")

        return chatResponse
    }

    // MARK: - Chat Suggestions

    func getChatSuggestions(token: String, noteId: String) async throws -> [String] {
        return try await executeWithTokenRefresh { validToken in
            try await self._getChatSuggestions(token: validToken, noteId: noteId)
        }
    }

    private func _getChatSuggestions(token: String, noteId: String) async throws -> [String] {
        let language = getPreferredLanguage()
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/suggestions/\(noteId)?language=\(language)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        print("📤 Fetching chat suggestions with language: \(language)")
        print("   URL: \(url)")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            let errorData = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError.serverError(errorData?["error"] ?? "Failed to get suggestions")
        }

        struct SuggestionsResponse: Codable {
            let success: Bool
            let data: SuggestionsData?
            let error: String?
        }

        struct SuggestionsData: Codable {
            let suggestions: [String]
            let note_id: String
        }

        let suggestionsResponse = try JSONDecoder().decode(SuggestionsResponse.self, from: data)

        guard let suggestionsData = suggestionsResponse.data else {
            throw APIError.serverError(suggestionsResponse.error ?? "No suggestions returned")
        }

        print("✅ Received \(suggestionsData.suggestions.count) suggestions")

        return suggestionsData.suggestions
    }

    func checkPodcastStatus(token: String, noteId: String) async throws -> AIContent? {
        return try await executeWithTokenRefresh { validToken in
            try await self._checkPodcastStatus(token: validToken, noteId: noteId)
        }
    }
    
    private func _checkPodcastStatus(token: String, noteId: String) async throws -> AIContent? {
        guard let url = URL(string: "\(Constants.baseURL)/api/ai/podcast/status/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to check podcast status")
        }
        
        struct PodcastStatusResponse: Codable {
            let success: Bool
            let data: PodcastStatusData
        }
        
        struct PodcastStatusData: Codable {
            let status: String
            let id: String?
            let audioUrl: String?
            let script: String?
            let duration: String?
            let style: String?
            let noteId: String?
            let message: String?
            
            enum CodingKeys: String, CodingKey {
                case status
                case id
                case audioUrl = "audio_url"
                case script
                case duration
                case style
                case noteId = "note_id"
                case message
            }
        }
        
        let statusResponse = try JSONDecoder().decode(PodcastStatusResponse.self, from: data)
        
        if statusResponse.data.status == "not_found" {
            return nil
        }
        
        if statusResponse.data.status == "generating" {
            return AIContent(
                id: nil,
                noteId: noteId,
                audioUrl: nil,
                duration: nil,
                status: "generating",
                questions: nil,
                flashcards: nil,
                summary: nil,
                createdAt: nil
            )
        }
        
        // Ready
        return AIContent(
            id: statusResponse.data.id,
            noteId: noteId,
            audioUrl: statusResponse.data.audioUrl,
            duration: statusResponse.data.duration,
            status: "ready",
            questions: nil,
            flashcards: nil,
            summary: nil,
            createdAt: nil
        )
    }


    // MARK: - Quiz APIs

    func getQuiz(token: String, noteId: String) async throws -> Quiz? {
        return try await executeWithTokenRefresh { validToken in
            try await self._getQuiz(token: validToken, noteId: noteId)
        }
    }
    
    private func _getQuiz(token: String, noteId: String) async throws -> Quiz? {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.quiz)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        if httpResponse.statusCode == 404 {
            return nil
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch quiz")
        }
        
        let quizResponse = try JSONDecoder().decode(QuizResponse.self, from: data)
        return quizResponse.data
    }

    

    // MARK: - Flashcards APIs

    func getFlashcards(token: String, noteId: String) async throws -> FlashcardSet? {
        return try await executeWithTokenRefresh { validToken in
            try await self._getFlashcards(token: validToken, noteId: noteId)
        }
    }
    
    private func _getFlashcards(token: String, noteId: String) async throws -> FlashcardSet? {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.flashcards)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        if httpResponse.statusCode == 404 {
            return nil
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch flashcards")
        }
        
        let flashcardResponse = try JSONDecoder().decode(FlashcardResponse.self, from: data)
        return flashcardResponse.data
    }

    

    // MARK: - Chat APIs

    func getChatHistory(token: String, noteId: String) async throws -> [ChatMessage] {
        return try await executeWithTokenRefresh { validToken in
            try await self._getChatHistory(token: validToken, noteId: noteId)
        }
    }
    
    private func _getChatHistory(token: String, noteId: String) async throws -> [ChatMessage] {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.chat)/\(noteId)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        if httpResponse.statusCode == 404 {
            return []
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch chat history")
        }
        
        struct ChatHistoryApiResponse: Codable {
            let success: Bool
            let data: [ChatMessageData]?
            let error: String?
        }
        
        struct ChatMessageData: Codable {
            let id: String
            let role: String
            let text: String
        }
        
        let chatHistoryResponse = try JSONDecoder().decode(ChatHistoryApiResponse.self, from: data)
        
        // Convert ChatMessageData to ChatMessage
        let messages = (chatHistoryResponse.data ?? []).map { messageData in
            ChatMessage(
                id: messageData.id,
                role: messageData.role,
                text: messageData.text
            )
        }
        
        return messages
    }

    func sendChatMessage(token: String, noteId: String, message: String) async throws -> ChatMessage {
        try await requireAIConsent()
        return try await executeWithTokenRefresh { validToken in
            try await self._sendChatMessage(token: validToken, noteId: noteId, message: message)
        }
    }
    
    private func _sendChatMessage(token: String, noteId: String, message: String) async throws -> ChatMessage {
        guard let url = URL(string: "\(Constants.baseURL)\(Constants.API.chat)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "note_id": noteId,
            "question": message,
            "conversation_history": []
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to send message")
        }
        
        struct ChatApiResponse: Codable {
            let success: Bool
            let data: ChatResponse?
            let error: String?
        }
        
        let chatApiResponse = try JSONDecoder().decode(ChatApiResponse.self, from: data)
        
        guard let chatResponse = chatApiResponse.data else {
            throw APIError.serverError(chatApiResponse.error ?? "No response")
        }
        
        // Convert ChatResponse to ChatMessage
        return ChatMessage(
            id: UUID().uuidString,
            role: "assistant",
            text: chatResponse.answer
        )
    }
    
    // MARK: - Scanned Document Upload
    
    func uploadScannedDocument(token: String, pdfURL: URL, extractedText: String) async throws -> Note {
        return try await executeWithTokenRefresh { validToken in
            try await self._uploadScannedDocument(token: validToken, pdfURL: pdfURL, extractedText: extractedText)
        }
    }
    
    private func _uploadScannedDocument(token: String, pdfURL: URL, extractedText: String) async throws -> Note {
        guard let url = URL(string: "\(Constants.baseURL)/api/uploads/scan") else {
            throw APIError.invalidURL
        }
        
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        
        var httpBody = Data()
        
        // Add file
        let fileData = try Data(contentsOf: pdfURL)
        httpBody.append("--\(boundary)\r\n".data(using: .utf8)!)
        httpBody.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(pdfURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
        httpBody.append("Content-Type: application/pdf\r\n\r\n".data(using: .utf8)!)
        httpBody.append(fileData)
        httpBody.append("\r\n".data(using: .utf8)!)
        
        // Add extracted text
        httpBody.append("--\(boundary)\r\n".data(using: .utf8)!)
        httpBody.append("Content-Disposition: form-data; name=\"extractedText\"\r\n\r\n".data(using: .utf8)!)
        httpBody.append(extractedText.data(using: .utf8)!)
        httpBody.append("\r\n".data(using: .utf8)!)
        
        httpBody.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        request.httpBody = httpBody
        
        print("📸 Uploading scanned document")
        
        let (data, response) = try await longRunningSession.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("📸 Scan upload response: \(httpResponse.statusCode)")
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 201 || httpResponse.statusCode == 200 else {
            let errorMessage = extractErrorMessage(from: data) ?? "Failed to upload scanned document (HTTP \(httpResponse.statusCode))"
            throw APIError.serverError(errorMessage)
        }
        
        // Server returns: { success, message, note, stats, pdfUrl }
        // The note is under 'note' key, not 'data'
        struct ScanUploadResponse: Codable {
            let success: Bool
            let message: String?
            let note: Note
            let stats: ScanStats?
            let pdfUrl: String?
        }
        
        struct ScanStats: Codable {
            let fileSize: Double?
            let wordCount: Int?
            let characterCount: Int?
            let pageCount: Int?
        }
        
        do {
            let scanResponse = try JSONDecoder().decode(ScanUploadResponse.self, from: data)
            print("✅ Scan upload successful, note_id: \(scanResponse.note.id)")
            return scanResponse.note
        } catch {
            print("❌ Failed to decode scan response: \(error)")
            
            // Log raw response for debugging
            if let responseString = String(data: data, encoding: .utf8) {
                print("📸 Raw response: \(responseString)")
            }
            
            throw APIError.decodingError
        }
    }
    
    // MARK: - YouTube Video Processing
    
    func processVideoUrl(token: String, url videoUrl: String) async throws {
        try await executeWithTokenRefresh { validToken in
            try await self._processVideoUrl(token: validToken, url: videoUrl)
        }
    }
    
    private func _processVideoUrl(token: String, url videoUrl: String) async throws {
        guard let apiUrl = URL(string: "\(Constants.baseURL)\(Constants.API.videoUrl)") else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: apiUrl)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 180 // 3 minutes for YouTube processing
        
        let body: [String: Any] = ["url": videoUrl]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        print("🎬 Processing YouTube video: \(videoUrl)")
        
        let (data, response) = try await longRunningSession.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }
        
        print("🎬 YouTube response: \(httpResponse.statusCode)")
        
        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }
        
        guard httpResponse.statusCode == 201 else {
            let errorMessage = extractErrorMessage(from: data) ?? "Failed to process video (HTTP \(httpResponse.statusCode))"
            print("❌ YouTube processing failed: \(errorMessage)")
            throw APIError.serverError(errorMessage)
        }
        
        print("✅ YouTube video processed successfully")
    }
    
    // MARK: - Helper Methods
    
    private func extractErrorMessage(from data: Data) -> String? {
        // Try different JSON structures for error messages
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = json["error"] as? String {
                return error
            }
            if let message = json["message"] as? String {
                return message
            }
            if let errors = json["errors"] as? [[String: Any]],
               let firstError = errors.first,
               let msg = firstError["message"] as? String {
                return msg
            }
        }
        
        // Return raw response if it's short enough
        if let responseString = String(data: data, encoding: .utf8), responseString.count < 200 {
            return responseString
        }
        
        return nil
    }
    
    private func createMultipartBody(boundary: String, fileURL: URL, fieldName: String) throws -> Data {
        var body = Data()
        
        let filename = fileURL.lastPathComponent
        let mimeType = getMimeType(for: fileURL)
        let fileData = try Data(contentsOf: fileURL)
        
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        
        return body
    }
    
    private func getMimeType(for url: URL) -> String {
        let pathExtension = url.pathExtension.lowercased()
        
        switch pathExtension {
        case "pdf": return "application/pdf"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/m4a"
        case "wav": return "audio/wav"
        case "aac": return "audio/aac"
        case "mp4": return "audio/mp4"
        default: return "application/octet-stream"
        }
    }
    
    func deleteUserAccount(token: String) async throws {
            try await executeWithTokenRefresh { validToken in
                try await self._deleteUserAccount(token: validToken)
            }
        }
        
        private func _deleteUserAccount(token: String) async throws {
            guard let url = URL(string: "\(Constants.baseURL)/api/user/delete-account") else {
                throw APIError.invalidURL
            }
            
            var request = URLRequest(url: url)
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = 60 // Account deletion may take time
            
            print("🗑️ Sending account deletion request...")
            
            let (data, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError("Invalid response")
            }
            
            print("🗑️ Account deletion response: \(httpResponse.statusCode)")
            
            if httpResponse.statusCode == 401 {
                throw APIError.unauthorized
            }
            
            guard httpResponse.statusCode == 200 else {
                let errorMessage = extractErrorMessage(from: data) ?? "Failed to delete account (HTTP \(httpResponse.statusCode))"
                print("❌ Account deletion failed: \(errorMessage)")
                throw APIError.serverError(errorMessage)
            }
            
            print("✅ Account deletion successful")
        }

    // MARK: - Onboarding

    /// Save onboarding preferences to backend
    func saveOnboardingPreferences(token: String, preferences: [String: Any]) async throws {
        try await executeWithTokenRefresh { validToken in
            try await self._saveOnboardingPreferences(token: validToken, preferences: preferences)
        }
    }

    private func _saveOnboardingPreferences(token: String, preferences: [String: Any]) async throws {
        guard let url = URL(string: "\(Constants.baseURL)/api/onboarding") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: preferences)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            let errorMessage = extractErrorMessage(from: data) ?? "Failed to save preferences"
            throw APIError.serverError(errorMessage)
        }
    }

    // MARK: - User Stats

    /// Get user stats for retention screens
    func getUserStats(token: String) async throws -> UserStats {
        try await executeWithTokenRefresh { validToken in
            try await self._getUserStats(token: validToken)
        }
    }

    private func _getUserStats(token: String) async throws -> UserStats {
        guard let url = URL(string: "\(Constants.baseURL)/api/onboarding/stats") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get user stats")
        }

        struct StatsResponse: Codable {
            let success: Bool
            let data: StatsData
        }

        struct StatsData: Codable {
            let notes_count: Int
            let quizzes_count: Int
            let flashcards_count: Int
            let audio_hours: Double
        }

        let statsResponse = try JSONDecoder().decode(StatsResponse.self, from: data)
        return UserStats(
            notesCount: statsResponse.data.notes_count,
            quizzesCount: statsResponse.data.quizzes_count,
            flashcardsCount: statsResponse.data.flashcards_count,
            audioHours: statsResponse.data.audio_hours
        )
    }

    // MARK: - Promo Code

    func validatePromoCode(_ code: String) async throws -> PromoValidationResult {
        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/creators/validate-code")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Include auth token if available to check discount eligibility
        if let token = await TokenManager.shared.getValidToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let body: [String: Any] = ["code": code]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode != 200 {
            // Try to parse error message
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw APIError.serverError(error)
            }
            throw APIError.serverError("Invalid promo code")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let success = json["success"] as? Bool, success,
              let resultData = json["data"] as? [String: Any] else {
            throw APIError.serverError("Invalid response format")
        }

        return PromoValidationResult(
            valid: resultData["valid"] as? Bool ?? false,
            code: resultData["code"] as? String ?? code,
            trialExtensionDays: resultData["trialExtensionDays"] as? Int ?? 0,
            creatorName: resultData["creatorName"] as? String ?? ""
        )
    }

    func applyPromoCode(_ code: String, platform: String = "ios") async throws {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/creators/apply-code")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // Include device fingerprint for fraud detection
        let deviceFingerprint = DeviceFingerprint.generate()
        let body: [String: Any] = [
            "code": code,
            "platform": platform,
            "deviceFingerprint": deviceFingerprint
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode != 200 {
            // Try to parse error message
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw APIError.serverError(error)
            }
            throw APIError.serverError("Failed to apply promo code")
        }
    }

    // MARK: - Meetings API

    /// Create a new meeting and deploy bot to join
    func createMeeting(meetingUrl: String, title: String? = nil) async throws -> CreateMeetingResponse {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = ["meetingUrl": meetingUrl]
        if let title = title {
            body["title"] = title
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode == 403 {
            throw APIError.subscriptionRequired(reason: "Meeting bot requires a premium subscription", trialExpired: false)
        }

        if httpResponse.statusCode != 201 && httpResponse.statusCode != 200 {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw APIError.serverError(error)
            }
            throw APIError.serverError("Failed to create meeting")
        }

        return try JSONDecoder().decode(CreateMeetingResponse.self, from: data)
    }

    /// Get all meetings for the current user
    func getMeetings(page: Int = 1, limit: Int = 20) async throws -> MeetingsListResponse {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings?page=\(page)&limit=\(limit)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode == 403 {
            throw APIError.subscriptionRequired(reason: "Meeting bot requires a premium subscription", trialExpired: false)
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get meetings")
        }

        return try JSONDecoder().decode(MeetingsListResponse.self, from: data)
    }

    /// Get status of a specific meeting
    func getMeetingStatus(meetingId: String) async throws -> MeetingResponse {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings/\(meetingId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode == 404 {
            throw APIError.notFound
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to get meeting status")
        }

        return try JSONDecoder().decode(MeetingResponse.self, from: data)
    }

    /// Cancel a meeting and stop the bot
    func cancelMeeting(meetingId: String) async throws {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings/\(meetingId)/cancel")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode == 404 {
            throw APIError.notFound
        }

        guard httpResponse.statusCode == 200 else {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw APIError.serverError(error)
            }
            throw APIError.serverError("Failed to cancel meeting")
        }
    }

    /// Delete a meeting
    func deleteMeeting(meetingId: String) async throws {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings/\(meetingId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        if httpResponse.statusCode == 404 {
            throw APIError.notFound
        }

        guard httpResponse.statusCode == 200 else {
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw APIError.serverError(error)
            }
            throw APIError.serverError("Failed to delete meeting")
        }
    }

    /// Validate a meeting URL
    func validateMeetingUrl(_ meetingUrl: String) async throws -> ValidateMeetingUrlResponse {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        let baseURL = Bundle.main.infoDictionary?["API_BASE_URL"] as? String ?? "https://ai-notetaker-backend-917362189743.us-central1.run.app"
        let url = URL(string: "\(baseURL)/api/meetings/validate-url")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = ["meetingUrl": meetingUrl]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to validate meeting URL")
        }

        return try JSONDecoder().decode(ValidateMeetingUrlResponse.self, from: data)
    }

    // MARK: - Text-to-Speech

    /// TTS Voice options
    struct TTSVoice {
        let id: String
        let name: String
        let gender: String
    }

    /// Available TTS voices (OpenAI voices with friendly names)
    static let ttsVoices: [TTSVoice] = [
        TTSVoice(id: "nova", name: "Sarah", gender: "Female"),
        TTSVoice(id: "shimmer", name: "Emily", gender: "Female"),
        TTSVoice(id: "alloy", name: "Alex", gender: "Neutral"),
        TTSVoice(id: "echo", name: "James", gender: "Male"),
        TTSVoice(id: "fable", name: "Daniel", gender: "Male"),
        TTSVoice(id: "onyx", name: "Marcus", gender: "Male"),
    ]

    /// Synthesize text to speech and return audio data
    func synthesizeSpeech(text: String, voice: String = "nova", speed: Double = 1.0) async throws -> Data {
        try await requireAIConsent()
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/tts/synthesize") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "text": text,
            "voice": voice,
            "speed": speed
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("🔊 Generating TTS...")
        print("   Text length: \(text.count)")
        print("   Voice: \(voice), Speed: \(speed)")

        // Use longer timeout for TTS (can take time for long content)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120 // 2 minutes
        config.timeoutIntervalForResource = 180 // 3 minutes
        let session = URLSession(configuration: config)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        print("📥 TTS response status: \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            // Try to parse error message
            if let errorJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMessage = errorJson["error"] as? String {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to generate speech")
        }

        print("✅ TTS audio received: \(data.count) bytes")
        return data
    }

    /// Get available TTS voices
    func getTTSVoices() async throws -> [TTSVoice] {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/tts/voices") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch voices")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let responseData = json["data"] as? [String: Any] else {
            throw APIError.decodingError
        }

        // Parse voices from API response
        var voices: [TTSVoice] = []
        if let voicesArray = responseData["voices"] as? [[String: Any]] {
            for voice in voicesArray {
                if let id = voice["id"] as? String,
                   let name = voice["name"] as? String,
                   let gender = voice["gender"] as? String {
                    voices.append(TTSVoice(id: id, name: name, gender: gender))
                }
            }
        }

        return voices.isEmpty ? APIService.ttsVoices : voices
    }

    /// Get TTS service status
    func getTTSStatus() async throws -> [String: Any] {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/tts/status") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.serverError("Failed to fetch TTS status")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let responseData = json["data"] as? [String: Any] else {
            throw APIError.decodingError
        }

        return responseData
    }

    /// TTS response for note
    struct TTSForNoteResponse {
        let audioUrl: String
        let voice: String
        let speed: Double
        let durationSeconds: Int
    }

    /// Generate TTS for a note and save to storage
    func generateTTSForNote(noteId: String, voice: String = "nova", speed: Double = 1.0) async throws -> TTSForNoteResponse {
        try await requireAIConsent()
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/tts/generate") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "note_id": noteId,
            "voice": voice,
            "speed": speed
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        print("🔊 Generating TTS for note: \(noteId)")

        // Use longer timeout for TTS generation
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 180 // 3 minutes
        config.timeoutIntervalForResource = 240 // 4 minutes
        let session = URLSession(configuration: config)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        print("📥 TTS generate response status: \(httpResponse.statusCode)")

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard httpResponse.statusCode == 200 else {
            if let errorJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMessage = errorJson["error"] as? String {
                throw APIError.serverError(errorMessage)
            }
            throw APIError.serverError("Failed to generate TTS")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let responseData = json["data"] as? [String: Any],
              let audioUrl = responseData["audio_url"] as? String else {
            throw APIError.decodingError
        }

        print("✅ TTS generated: \(audioUrl)")

        return TTSForNoteResponse(
            audioUrl: audioUrl,
            voice: responseData["voice"] as? String ?? voice,
            speed: responseData["speed"] as? Double ?? speed,
            durationSeconds: responseData["duration_seconds"] as? Int ?? 0
        )
    }

    /// Get saved TTS for a note
    func getTTSForNote(noteId: String) async throws -> TTSForNoteResponse? {
        guard let token = await TokenManager.shared.getValidToken() else {
            throw APIError.unauthorized
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/tts/note/\(noteId)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        guard httpResponse.statusCode == 200 else {
            return nil
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let responseData = json["data"] as? [String: Any],
              let audioUrl = responseData["audio_url"] as? String else {
            return nil
        }

        return TTSForNoteResponse(
            audioUrl: audioUrl,
            voice: responseData["voice"] as? String ?? "nova",
            speed: responseData["speed"] as? Double ?? 1.0,
            durationSeconds: responseData["duration_seconds"] as? Int ?? 0
        )
    }
}

// MARK: - Device Fingerprint

/// Generates a unique device fingerprint for fraud detection
struct DeviceFingerprint {
    /// Generate a device fingerprint combining multiple device identifiers
    static func generate() -> String {
        var components: [String] = []

        // Vendor ID (persists across app reinstalls while device is not reset)
        if let vendorID = UIDevice.current.identifierForVendor?.uuidString {
            components.append(vendorID)
        }

        // Device model and name
        components.append(UIDevice.current.model)
        components.append(UIDevice.current.systemName)
        components.append(UIDevice.current.systemVersion)

        // Screen dimensions (helps identify device type)
        let screen = UIScreen.main.bounds
        components.append("\(Int(screen.width))x\(Int(screen.height))")

        // Combine all components into a single fingerprint
        let combined = components.joined(separator: "|")
        return combined
    }
}
