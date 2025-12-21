import Foundation
import UIKit

/// Service for reporting user journey errors to the backend
class ErrorReportingService {
    static let shared = ErrorReportingService()

    private init() {}

    /// User journey flows that can be reported
    enum UserFlow: String {
        // Auth flows
        case signIn = "Sign In"
        case signUp = "Sign Up"
        case signInWithApple = "Sign In with Apple"
        case signInWithGoogle = "Sign In with Google"
        case signOut = "Sign Out"

        // Content creation flows
        case recordAudio = "Record Audio"
        case uploadPDF = "Upload PDF"
        case scanDocument = "Scan Document"
        case youtubeLink = "YouTube Link"
        case uploadSlideshow = "Upload Slideshow"

        // AI generation flows
        case generateSummary = "Generate Summary"
        case generateQuiz = "Generate Quiz"
        case generateFlashcards = "Generate Flashcards"
        case generatePodcast = "Generate Podcast"
        case generateDiagram = "Generate Diagram"
        case chatWithNote = "Chat with Note"

        // Subscription flows
        case purchase = "Purchase Subscription"
        case restorePurchases = "Restore Purchases"

        // Other flows
        case fetchNotes = "Fetch Notes"
        case deleteNote = "Delete Note"
        case transcription = "Transcription"
    }

    /// Report an error that occurred during a user journey
    /// Runs completely in background - never blocks UI
    /// - Parameters:
    ///   - flow: The user flow where the error occurred
    ///   - error: The error that occurred
    ///   - additionalInfo: Any additional context
    func reportError(flow: UserFlow, error: Error, additionalInfo: String? = nil) {
        // Fire and forget - detached task with low priority
        Task.detached(priority: .utility) { [weak self] in
            await self?.reportErrorAsync(flow: flow, error: error, additionalInfo: additionalInfo)
        }
    }

    /// Report an error with a custom error message
    /// Runs completely in background - never blocks UI
    /// - Parameters:
    ///   - flow: The user flow where the error occurred
    ///   - errorMessage: Custom error message
    ///   - additionalInfo: Any additional context
    func reportError(flow: UserFlow, errorMessage: String, additionalInfo: String? = nil) {
        // Fire and forget - detached task with low priority
        Task.detached(priority: .utility) { [weak self] in
            await self?.reportErrorAsync(flow: flow, errorMessage: errorMessage, additionalInfo: additionalInfo)
        }
    }

    private func reportErrorAsync(flow: UserFlow, error: Error, additionalInfo: String? = nil) async {
        var errorMessage = error.localizedDescription
        if let additionalInfo = additionalInfo {
            errorMessage += " | Additional: \(additionalInfo)"
        }
        await reportErrorAsync(flow: flow, errorMessage: errorMessage, additionalInfo: nil)
    }

    private func reportErrorAsync(flow: UserFlow, errorMessage: String, additionalInfo: String? = nil) async {
        let url = URL(string: "\(Constants.baseURL)/api/alerts/error")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10 // Short timeout - don't wait too long

        // Add auth token if available
        if let token = KeychainService.shared.get(Constants.Keychain.accessToken) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Build error message
        var fullErrorMessage = errorMessage
        if let additionalInfo = additionalInfo {
            fullErrorMessage += " | \(additionalInfo)"
        }

        // Get device info
        let deviceInfo: [String: Any] = [
            "device": UIDevice.current.model,
            "osVersion": UIDevice.current.systemVersion,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
        ]

        let body: [String: Any] = [
            "flow": flow.rawValue,
            "error": fullErrorMessage,
            "deviceInfo": deviceInfo
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (_, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                print("📧 Error reported successfully for flow: \(flow.rawValue)")
            } else {
                print("⚠️ Failed to report error, status: \((response as? HTTPURLResponse)?.statusCode ?? -1)")
            }
        } catch {
            // Don't report errors about reporting errors - just log locally
            print("⚠️ Failed to send error report: \(error.localizedDescription)")
        }
    }
}
