import SwiftUI

// MARK: - AI Data Consent View

/// Disclosure and consent screen for third-party AI data sharing.
/// Used in onboarding (new users) and settings (review/revoke).
struct AIDataConsentView: View {
    let isOnboarding: Bool
    @ObservedObject private var consentManager = AIDataConsentManager.shared
    @Environment(\.dismiss) private var dismiss

    private let privacyURL = URL(string: "https://scribeai.online/privacy")!

    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 20) {
                        headerSection
                        disclosureCards
                        privacyLink
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 24)
                    .padding(.bottom, 16)
                }

                footerSection
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isOnboarding {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(.textPrimary)
                }
            }
        }
        .interactiveDismissDisabled(isOnboarding)
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 48))
                .foregroundStyle(.blue)
                .padding(.bottom, 4)

            Text("Your Data & AI Services")
                .font(.title2.bold())
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)

            Text("Scribe AI uses cloud-based AI services to transcribe, summarize, and generate study materials from your content. Here's exactly what data is shared and with whom.")
                .font(.subheadline)
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Disclosure Cards

    private var disclosureCards: some View {
        VStack(spacing: 12) {
            DataDisclosureCard(
                icon: "mic.fill",
                iconColor: .blue,
                title: "Audio Transcription",
                description: "When you record or upload audio, it is sent to our servers for transcription.",
                services: [
                    (name: "OpenAI Whisper", detail: "Audio-to-text transcription")
                ]
            )

            DataDisclosureCard(
                icon: "text.magnifyingglass",
                iconColor: .purple,
                title: "AI Content Generation",
                description: "When you generate summaries, quizzes, flashcards, or chat with your notes, the text content is sent to our servers.",
                services: [
                    (name: "OpenAI GPT-4", detail: "Summaries, quizzes, flashcards, chat")
                ]
            )

            DataDisclosureCard(
                icon: "headphones",
                iconColor: .orange,
                title: "AI Podcast Generation",
                description: "When you generate a podcast from your notes, the text is sent for audio synthesis.",
                services: [
                    (name: "OpenAI TTS", detail: "Text-to-speech for podcasts")
                ]
            )

            DataDisclosureCard(
                icon: "person.badge.key.fill",
                iconColor: .green,
                title: "Authentication & Storage",
                description: "Your account and files are managed by:",
                services: [
                    (name: "Supabase", detail: "Authentication, database, and file storage")
                ]
            )

            DataDisclosureCard(
                icon: "lock.shield.fill",
                iconColor: .teal,
                title: "What Stays on Your Device",
                description: "The following never leaves your device:",
                services: [
                    (name: "Your app settings", detail: "Stored locally"),
                    (name: "Offline cached notes", detail: "Stored locally"),
                    (name: "Your preferences", detail: "Stored locally")
                ]
            )
        }
    }

    // MARK: - Privacy Link

    private var privacyLink: some View {
        VStack(spacing: 8) {
            Text("All AI features require cloud processing. You can review or revoke your consent anytime in Settings.")
                .font(.caption)
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)

            Link("Read our full Privacy Policy", destination: privacyURL)
                .font(.caption.weight(.medium))
                .tint(.blue)
        }
    }

    // MARK: - Footer

    private var footerSection: some View {
        VStack(spacing: 12) {
            Divider()
                .background(Color.darkSurfaceVariant)

            VStack(spacing: 12) {
                Button(action: handleAccept) {
                    Text("I Understand & Agree")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(Color.purple80)
                        )
                }

                if !isOnboarding && consentManager.hasConsented {
                    Button(action: handleRevoke) {
                        Text("Revoke Consent")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .padding(.top, 8)
        }
    }

    // MARK: - Actions

    private func handleAccept() {
        consentManager.grantConsent()
        if isOnboarding {
            let manager = OnboardingManager.shared
            if manager.isReturningUser {
                manager.completeOnboarding()
            } else {
                manager.nextStep()
            }
        } else {
            dismiss()
        }
    }

    private func handleRevoke() {
        consentManager.revokeConsent()
        dismiss()
    }
}

// MARK: - Disclosure Card

struct DataDisclosureCard: View {
    let icon: String
    let iconColor: Color
    let title: String
    let description: String
    let services: [(name: String, detail: String)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(iconColor)
                    .frame(width: 32, height: 32)
                Text(title)
                    .font(.headline)
                    .foregroundColor(.textPrimary)
            }

            Text(description)
                .font(.subheadline)
                .foregroundColor(.textSecondary)

            ForEach(Array(services.enumerated()), id: \.offset) { _, service in
                HStack(spacing: 8) {
                    Circle()
                        .fill(iconColor.opacity(0.3))
                        .frame(width: 6, height: 6)
                    Text(service.name)
                        .font(.caption.weight(.medium))
                        .foregroundColor(.textPrimary)
                    Text("— \(service.detail)")
                        .font(.caption)
                        .foregroundColor(.textSecondary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
