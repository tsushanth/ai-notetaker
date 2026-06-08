//
//  YouTubeInputView.swift
//  scribeai
//
//  FIXED: Better error handling for Generate Note button
//  FIXED: URL validation and cleaning
//  FIXED: Analytics tracking moved out of view body
//

import SwiftUI
import UserNotifications

extension Notification.Name {
    /// Posted from "View Note" in a generation success view. HomeView listens and
    /// refreshes + surfaces the newest note. Decoupled so each input flow (YouTube,
    /// upload, scan, recording) can fire it without dragging navigation state in.
    static let scribeOpenLatestNote = Notification.Name("scribeOpenLatestNote")
}

struct YouTubeInputView: View {
    @Environment(\.dismiss) var dismiss
    @State private var youtubeUrl = ""
    @State private var processingState: ScribeProcessingState = .idle
    @State private var showInfo = false
    @State private var urlValidationState: URLValidationState = .empty

    // Processing steps for YouTube
    @State private var processingSteps: [ScribeProcessingStep] = []
    @State private var currentStepIndex = 0
    @State private var uploadComplete = false

    // URL validation states
    enum URLValidationState: Equatable {
        case empty
        case invalid
        case valid(videoId: String)

        var isValid: Bool {
            if case .valid = self { return true }
            return false
        }
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                Color.darkBackground
                    .ignoresSafeArea()
                
                switch processingState {
                case .idle:
                    inputContent
                    
                case .processing:
                    ScribeProcessingStepsView(
                        steps: processingSteps,
                        currentIndex: currentStepIndex,
                        uploadComplete: uploadComplete
                    )
                    
                case .success:
                    ScribeSuccessView(
                        onViewNote: {
                            // Track on user action so the post-value paywall (which trackNoteCreated
                            // schedules) doesn't race against the success view they're trying to read.
                            AnalyticsService.shared.trackNoteCreated(sourceType: "youtube")
                            NotificationCenter.default.post(name: .scribeOpenLatestNote, object: nil)
                            dismiss()
                        },
                        onGoHome: {
                            AnalyticsService.shared.trackNoteCreated(sourceType: "youtube")
                            dismiss()
                        }
                    )
                    
                case .error(let message):
                    ScribeErrorView(
                        message: message,
                        onRetry: {
                            processingState = .idle
                        },
                        onGoBack: {
                            dismiss()
                        }
                    )
                    .onAppear {
                        // Track error here, not in view body
                        AnalyticsService.shared.trackProcessingError(type: "youtube", message: message)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(.textPrimary)
                    }
                }
                
                ToolbarItem(placement: .principal) {
                    if case .idle = processingState {
                        Text("YouTube Transcript")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.textPrimary)
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    if case .idle = processingState {
                        Button {
                            showInfo = true
                        } label: {
                            Image(systemName: "info.circle")
                                .foregroundColor(.textSecondary)
                        }
                    }
                }
            }
            .alert("About YouTube Transcripts", isPresented: $showInfo) {
                Button("Got it", role: .cancel) {}
            } message: {
                Text("This feature extracts captions/subtitles from YouTube videos.\n\nRequirements:\n• Video must have captions enabled\n• Auto-generated or manual subtitles\n• Works with most public videos")
            }
        }
        .navigationViewStyle(.stack)
    }
    
    // MARK: - Input Content
    
    private var inputContent: some View {
        ScrollView {
            VStack(spacing: 32) {
                Spacer()
                    .frame(height: 32)
                
                // YouTube Icon
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.accentRed.opacity(0.2))
                        .frame(width: 80, height: 80)
                    
                    Image(systemName: "play.rectangle.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.accentRed)
                }
                
                // Info Card
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "info.circle.fill")
                        .foregroundColor(.purple80)
                        .font(.system(size: 20))
                    
                    Text("Only videos with captions/subtitles are supported")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                        .lineSpacing(4)
                }
                .padding()
                .background(Color.cardBackground)
                .cornerRadius(12)
                .padding(.horizontal, 24)
                
                // Open YouTube Button
                Button {
                    if let url = URL(string: "https://youtube.com") {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.right.square")
                        Text("Open YouTube")
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.cardBackground)
                    .foregroundColor(.purple80)
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.purple80, lineWidth: 1)
                    )
                }
                .padding(.horizontal, 24)
                
                // URL Input
                VStack(alignment: .leading, spacing: 8) {
                    Text("👇 enter link here 👇")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .center)

                    HStack(spacing: 12) {
                        ZStack(alignment: .leading) {
                            if youtubeUrl.isEmpty {
                                Text("www.youtube.com/watch?v=...")
                                    .foregroundColor(Color(white: 0.4))
                                    .padding(.leading, 16)
                            }

                            TextField("", text: $youtubeUrl)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .padding()
                                .foregroundColor(.textPrimary)
                                .onChange(of: youtubeUrl) { newValue in
                                    validateUrl(newValue)
                                }
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(urlBorderColor, lineWidth: 1)
                        )

                        // Validation indicator
                        if !youtubeUrl.isEmpty {
                            validationIndicator
                        }
                    }

                    // Validation message
                    if case .invalid = urlValidationState {
                        Text("Please enter a valid YouTube URL")
                            .font(.system(size: 12))
                            .foregroundColor(.accentRed)
                            .padding(.leading, 4)
                    } else if case .valid(let videoId) = urlValidationState {
                        if videoId != "unknown" {
                            Text("Video ID: \(videoId)")
                                .font(.system(size: 12))
                                .foregroundColor(.accentGreen)
                                .padding(.leading, 4)
                        } else {
                            Text("YouTube URL detected")
                                .font(.system(size: 12))
                                .foregroundColor(.accentGreen)
                                .padding(.leading, 4)
                        }
                    }
                }
                .padding(.horizontal, 24)
                
                // Paste Button
                Button {
                    if let clipboardString = UIPasteboard.general.string {
                        youtubeUrl = clipboardString.trimmingCharacters(in: .whitespacesAndNewlines)
                    }
                } label: {
                    HStack {
                        Image(systemName: "doc.on.clipboard")
                        Text("Paste From Clipboard")
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color.cardBackground)
                    .foregroundColor(.purple80)
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.purple80, lineWidth: 1)
                    )
                }
                .padding(.horizontal, 24)
                
                Spacer()
                
                // Generate Notes Button — always tappable; processVideo() reports
                // inline error if URL is invalid instead of silently no-oping.
                // (User feedback 2026-06-08: tapping the disabled-looking button after
                // paste did nothing visible, looked broken.)
                Button {
                    processVideo()
                } label: {
                    HStack {
                        Image(systemName: "paperplane.fill")
                        Text("Generate Notes")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(youtubeUrl.isEmpty ? Color.purple80.opacity(0.5) : Color.purple80)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(youtubeUrl.isEmpty)
                .padding(.horizontal, 24)
                
                Spacer()
                    .frame(height: 32)
            }
        }
    }
    
    // MARK: - Processing
    
    private func processVideo() {
        let cleanedUrl = youtubeUrl
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        
        guard !cleanedUrl.isEmpty else {
            processingState = .error(message: "Please enter a YouTube URL")
            return
        }
        
        guard isValidYouTubeUrl(cleanedUrl) else {
            processingState = .error(message: """
                Please enter a valid YouTube URL.
                
                Supported formats:
                • youtube.com/watch?v=...
                • youtu.be/...
                • youtube.com/shorts/...
                """)
            return
        }
        
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken) else {
            processingState = .error(message: "Session expired. Please log in again.")
            return
        }
        
        // Track YouTube processing started
        AnalyticsService.shared.track(.youtubeProcessed)
        
        // Initialize processing steps
        processingSteps = ScribeYouTubeStep.allCases.map {
            ScribeProcessingStep(title: $0.title, status: .pending)
        }
        currentStepIndex = 0
        uploadComplete = false
        processingState = .processing(steps: processingSteps, currentIndex: 0, uploadComplete: false)
        
        Task {
            do {
                await updateStep(at: 0, to: .inProgress)
                
                let result = try await withTimeout(seconds: 60) {
                    try await APIService.shared.processVideoUrl(token: token, url: cleanedUrl)
                }
                
                await updateStep(at: 0, to: .completed)
                uploadComplete = true
                
                for i in 1..<processingSteps.count {
                    await updateStep(at: i, to: .inProgress)
                    try await Task.sleep(nanoseconds: 800_000_000)
                    await updateStep(at: i, to: .completed)
                }
                
                await MainActor.run {
                    processingState = .success(noteId: nil)
                }
                
            } catch let error as APIError {
                await MainActor.run {
                    handleAPIError(error)
                }
            } catch {
                await MainActor.run {
                    let errorDescription = error.localizedDescription.lowercased()
                    
                    if errorDescription.contains("timeout") || errorDescription.contains("timed out") {
                        processingState = .error(message: "Request timed out. The video might be too long. Please try a shorter video.")
                    } else if errorDescription.contains("network") || errorDescription.contains("connection") {
                        processingState = .error(message: "Network error. Please check your internet connection and try again.")
                    } else if errorDescription.contains("transcript") || errorDescription.contains("caption") || errorDescription.contains("subtitle") {
                        processingState = .error(message: "This video doesn't have captions/subtitles available. Please try a different video with captions enabled.")
                    } else {
                        processingState = .error(message: "Failed to process video: \(error.localizedDescription)")
                    }
                }
            }
        }
    }
    
    private func handleAPIError(_ error: APIError) {
        var isUserError = false

        switch error {
        case .serverError(let message):
            let lowerMessage = message.lowercased()
            if lowerMessage.contains("transcript") || lowerMessage.contains("caption") || lowerMessage.contains("subtitle") {
                processingState = .error(message: "This video doesn't have captions/subtitles available.\n\nPlease try a different video with captions enabled.")
                isUserError = true  // Video limitation, not system error
            } else if lowerMessage.contains("video id") || lowerMessage.contains("extract") {
                processingState = .error(message: "Invalid YouTube URL.\n\nPlease enter a valid YouTube video link (e.g., youtube.com/watch?v=xxx or youtu.be/xxx)")
                isUserError = true  // User entered invalid URL
            } else if lowerMessage.contains("private") || lowerMessage.contains("unavailable") {
                processingState = .error(message: "This video is private or unavailable.\n\nPlease check the URL and try again.")
                isUserError = true  // Video is not accessible
            } else if lowerMessage.contains("age") || lowerMessage.contains("restricted") {
                processingState = .error(message: "This video is age-restricted.\n\nPlease try a different video.")
                isUserError = true  // Video limitation
            } else if lowerMessage.contains("live") || lowerMessage.contains("stream") {
                processingState = .error(message: "Live streams are not supported.\n\nPlease try a regular video.")
                isUserError = true  // Feature limitation
            } else {
                processingState = .error(message: "Server error: \(message)")
            }
        case .noData:
            processingState = .error(message: "Network error.\n\nPlease check your internet connection and try again.")
        case .unauthorized:
            processingState = .error(message: "Session expired.\n\nPlease log in again.")
        case .decodingError:
            processingState = .error(message: "Received invalid response from server.\n\nPlease try again.")
        case .timeout:
            processingState = .error(message: "Request timed out.\n\nThe video might be too long. Please try a shorter video.")
            isUserError = true  // Usually means video is too long
        default:
            processingState = .error(message: "An unexpected error occurred.\n\nPlease try again.")
        }

        // Only report actual system errors, not user/content errors
        if !isUserError {
            ErrorReportingService.shared.reportError(flow: .youtubeLink, error: error)
        }
    }
    
    @MainActor
    private func updateStep(at index: Int, to status: ScribeProcessingStep.ScribeStepStatus) {
        guard index < processingSteps.count else { return }
        processingSteps[index].status = status
        currentStepIndex = index
        processingState = .processing(steps: processingSteps, currentIndex: index, uploadComplete: uploadComplete)
    }
    
    // MARK: - URL Validation

    private var urlBorderColor: Color {
        switch urlValidationState {
        case .empty:
            return Color.darkSurfaceVariant
        case .invalid:
            return Color.accentRed
        case .valid:
            return Color.accentGreen
        }
    }

    private var validationIndicator: some View {
        Group {
            switch urlValidationState {
            case .empty:
                EmptyView()
            case .invalid:
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.accentRed)
                    .font(.system(size: 24))
            case .valid:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.accentGreen)
                    .font(.system(size: 24))
            }
        }
    }

    private func validateUrl(_ url: String) {
        let cleaned = url.trimmingCharacters(in: .whitespacesAndNewlines)

        if cleaned.isEmpty {
            urlValidationState = .empty
            return
        }

        if let videoId = extractVideoId(from: cleaned) {
            urlValidationState = .valid(videoId: videoId)
        } else {
            urlValidationState = .invalid
        }
    }

    /// Extract YouTube video ID from various URL formats
    private func extractVideoId(from url: String) -> String? {
        let cleaned = url
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")

        // Pattern 1: youtube.com/watch?v=VIDEO_ID
        if let range = cleaned.range(of: "v=") {
            let afterV = cleaned[range.upperBound...]
            let videoId = String(afterV.prefix(while: { $0 != "&" && $0 != "#" && $0 != "?" }))
            if isValidVideoId(videoId) {
                return videoId
            }
        }

        // Pattern 2: youtu.be/VIDEO_ID
        if cleaned.contains("youtu.be/") {
            if let range = cleaned.range(of: "youtu.be/") {
                let afterSlash = cleaned[range.upperBound...]
                let videoId = String(afterSlash.prefix(while: { $0 != "?" && $0 != "&" && $0 != "#" }))
                if isValidVideoId(videoId) {
                    return videoId
                }
            }
        }

        // Pattern 3: youtube.com/shorts/VIDEO_ID
        if cleaned.contains("/shorts/") {
            if let range = cleaned.range(of: "/shorts/") {
                let afterSlash = cleaned[range.upperBound...]
                let videoId = String(afterSlash.prefix(while: { $0 != "?" && $0 != "&" && $0 != "#" }))
                if isValidVideoId(videoId) {
                    return videoId
                }
            }
        }

        // Pattern 4: youtube.com/embed/VIDEO_ID
        if cleaned.contains("/embed/") {
            if let range = cleaned.range(of: "/embed/") {
                let afterSlash = cleaned[range.upperBound...]
                let videoId = String(afterSlash.prefix(while: { $0 != "?" && $0 != "&" && $0 != "#" }))
                if isValidVideoId(videoId) {
                    return videoId
                }
            }
        }

        // Pattern 5: youtube.com/v/VIDEO_ID
        if cleaned.contains("/v/") {
            if let range = cleaned.range(of: "/v/") {
                let afterSlash = cleaned[range.upperBound...]
                let videoId = String(afterSlash.prefix(while: { $0 != "?" && $0 != "&" && $0 != "#" }))
                if isValidVideoId(videoId) {
                    return videoId
                }
            }
        }

        // Fallback: If it looks like a YouTube URL but we couldn't extract ID,
        // return a placeholder so we let the server try to handle it
        let lowercased = cleaned.lowercased()
        if lowercased.contains("youtube.com") || lowercased.contains("youtu.be") {
            return "unknown" // Let server validate
        }

        return nil
    }

    /// Validate video ID format
    /// Being lenient here - just check it's not empty and has reasonable characters
    /// Server will do the final validation
    private func isValidVideoId(_ id: String) -> Bool {
        // Video IDs are typically 11 characters, but be lenient (8-12 chars)
        // They contain: a-z, A-Z, 0-9, _, -
        guard id.count >= 8 && id.count <= 15 else { return false }
        let allowedCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        return id.unicodeScalars.allSatisfy { allowedCharacters.contains($0) }
    }

    private func isValidYouTubeUrl(_ url: String) -> Bool {
        return extractVideoId(from: url) != nil
    }
}

// MARK: - Timeout Helper

func withTimeout<T>(seconds: Double, operation: @escaping () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw APIError.timeout
        }
        
        guard let result = try await group.next() else {
            throw APIError.timeout
        }
        
        group.cancelAll()
        return result
    }
}

#Preview {
    YouTubeInputView()
}
