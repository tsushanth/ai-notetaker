//
//  JoinMeetingView.swift
//  scribeai
//
//  Modal view for entering a meeting URL to join
//

import SwiftUI

struct JoinMeetingView: View {
    @Environment(\.dismiss) var dismiss
    @State private var meetingUrl = ""
    @State private var title = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var urlValidation: URLValidationState = .empty

    let onMeetingCreated: (Meeting) -> Void

    enum URLValidationState: Equatable {
        case empty
        case invalid
        case valid(platform: MeetingPlatform)

        var isValid: Bool {
            if case .valid = self { return true }
            return false
        }
    }

    var body: some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // Header
                        headerSection

                        // URL Input
                        urlInputSection

                        // Title Input
                        titleInputSection

                        // Supported Platforms
                        supportedPlatformsSection

                        // Error Message
                        if let error = errorMessage {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                                .multilineTextAlignment(.center)
                        }

                        Spacer(minLength: 20)

                        // Join Button
                        joinButton
                    }
                    .padding()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(.blue)
                }
            }
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "video.badge.plus")
                .font(.system(size: 56))
                .foregroundColor(.blue)

            Text("Join a Meeting")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Paste your meeting link and our bot will join to record and transcribe.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 20)
    }

    // MARK: - URL Input Section

    private var urlInputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Meeting Link")
                .font(.headline)

            TextField("https://zoom.us/j/...", text: $meetingUrl)
                .textFieldStyle(.plain)
                .padding()
                .background(Color(.secondarySystemGroupedBackground))
                .cornerRadius(12)
                .autocapitalization(.none)
                .keyboardType(.URL)
                .textContentType(.URL)
                .onChange(of: meetingUrl) { newValue in
                    validateUrl(newValue)
                }

            // Validation feedback
            validationFeedback
        }
    }

    @ViewBuilder
    private var validationFeedback: some View {
        switch urlValidation {
        case .empty:
            EmptyView()
        case .invalid:
            HStack {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundColor(.red)
                Text("Please enter a valid Zoom, Google Meet, or Teams link")
                    .foregroundColor(.red)
            }
            .font(.caption)
        case .valid(let platform):
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                Text("\(platform.displayName) meeting detected")
                    .foregroundColor(.green)
            }
            .font(.caption)
        }
    }

    // MARK: - Title Input Section

    private var titleInputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Meeting Title (optional)")
                .font(.headline)

            TextField("e.g., Team Standup", text: $title)
                .textFieldStyle(.plain)
                .padding()
                .background(Color(.secondarySystemGroupedBackground))
                .cornerRadius(12)
        }
    }

    // MARK: - Supported Platforms Section

    private var supportedPlatformsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Supported Platforms")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                platformBadge("Zoom", color: .blue)
                platformBadge("Google Meet", color: .green)
                platformBadge("Teams", color: .purple)
            }
        }
    }

    private func platformBadge(_ name: String, color: Color) -> some View {
        Text(name)
            .font(.caption)
            .fontWeight(.medium)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(color.opacity(0.15))
            .foregroundColor(color)
            .cornerRadius(8)
    }

    // MARK: - Join Button

    private var joinButton: some View {
        Button {
            joinMeeting()
        } label: {
            HStack {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "video.fill")
                    Text("Send Bot to Meeting")
                }
            }
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding()
            .background(urlValidation.isValid ? Color.blue : Color.gray)
            .cornerRadius(12)
        }
        .disabled(!urlValidation.isValid || isLoading)
    }

    // MARK: - Validation

    private func validateUrl(_ url: String) {
        if url.isEmpty {
            urlValidation = .empty
            return
        }

        let result = MeetingURLValidator.validate(url)
        if result.valid, let platform = result.platform {
            urlValidation = .valid(platform: platform)
        } else {
            urlValidation = .invalid
        }
    }

    // MARK: - Join Meeting Action

    private func joinMeeting() {
        guard urlValidation.isValid else { return }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                let response = try await APIService.shared.createMeeting(
                    meetingUrl: meetingUrl,
                    title: title.isEmpty ? nil : title
                )

                await MainActor.run {
                    if response.success, let data = response.data {
                        onMeetingCreated(data.meeting)
                        dismiss()
                    } else {
                        errorMessage = response.error ?? "Failed to join meeting"
                        isLoading = false
                    }
                }
            } catch let error as APIError {
                await MainActor.run {
                    switch error {
                    case .subscriptionRequired(let reason, _):
                        errorMessage = reason
                    case .serverError(let message):
                        errorMessage = message
                    default:
                        errorMessage = error.localizedDescription
                    }
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
}

// MARK: - Preview

#Preview {
    JoinMeetingView { meeting in
        print("Meeting created: \(meeting.id)")
    }
}
