//
//  ExportService.swift
//  scribeai
//
//  Handles downloading exported files (PDF/DOCX) from the backend
//

import Foundation

class ExportService {
    static let shared = ExportService()
    private init() {}

    enum ExportFormat: String {
        case pdf
        case docx

        var mimeType: String {
            switch self {
            case .pdf: return "application/pdf"
            case .docx: return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            }
        }

        var fileExtension: String {
            return rawValue
        }
    }

    enum ExportError: LocalizedError {
        case noAuthToken
        case invalidURL
        case premiumRequired
        case serverError(String)
        case downloadFailed

        var errorDescription: String? {
            switch self {
            case .noAuthToken: return "Please sign in to export notes"
            case .invalidURL: return "Invalid export URL"
            case .premiumRequired: return "Premium subscription required to export"
            case .serverError(let msg): return msg
            case .downloadFailed: return "Failed to download the exported file"
            }
        }
    }

    /// Export a note as PDF or DOCX, returns a local file URL for sharing
    func exportNote(noteId: String, format: ExportFormat) async throws -> URL {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            throw ExportError.noAuthToken
        }

        guard let url = URL(string: "\(Constants.baseURL)/api/notes/\(noteId)/export/\(format.rawValue)") else {
            throw ExportError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ExportError.downloadFailed
        }

        switch httpResponse.statusCode {
        case 200:
            break
        case 403:
            throw ExportError.premiumRequired
        default:
            // Try to parse error message from JSON
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                throw ExportError.serverError(error)
            }
            throw ExportError.serverError("Export failed (HTTP \(httpResponse.statusCode))")
        }

        // Extract filename from Content-Disposition header or use default
        var filename = "Scribe AI Export.\(format.fileExtension)"
        if let disposition = httpResponse.value(forHTTPHeaderField: "Content-Disposition"),
           let range = disposition.range(of: "filename=\""),
           let endRange = disposition[range.upperBound...].range(of: "\"") {
            let encoded = String(disposition[range.upperBound..<endRange.lowerBound])
            if let decoded = encoded.removingPercentEncoding {
                filename = decoded
            }
        }

        // Save to temp directory
        let tempDir = FileManager.default.temporaryDirectory
        let fileURL = tempDir.appendingPathComponent(filename)

        // Remove existing file if any
        try? FileManager.default.removeItem(at: fileURL)
        try data.write(to: fileURL)

        return fileURL
    }
}
