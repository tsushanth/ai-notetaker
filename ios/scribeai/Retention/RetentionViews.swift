//
//  RetentionViews.swift
//  scribeai
//
//  Views shown when user tries to sign out or delete account
//

import SwiftUI

// MARK: - User Stats
struct UserStats {
    let notesCount: Int
    let quizzesCount: Int
    let flashcardsCount: Int
    let audioHours: Double

    static let empty = UserStats(notesCount: 0, quizzesCount: 0, flashcardsCount: 0, audioHours: 0)
}

// MARK: - Sign Out Confirmation View
struct SignOutConfirmationView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var stats: UserStats = .empty
    @State private var isLoading = true

    let onSignOut: () -> Void

    var body: some View {
        ZStack {
            Color.darkBackground.ignoresSafeArea()

            VStack(spacing: 24) {
                // Header
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.yellow)

                    Text("Are you sure?")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.textPrimary)

                    Text("You'll lose access to:")
                        .font(.system(size: 16))
                        .foregroundColor(.textSecondary)
                }
                .padding(.top, 32)

                // Stats
                if isLoading {
                    ProgressView()
                        .tint(.purple80)
                        .padding(.vertical, 40)
                } else {
                    VStack(spacing: 16) {
                        StatRow(icon: "doc.text.fill", value: "\(stats.notesCount)", label: "notes you've created")
                        StatRow(icon: "questionmark.circle.fill", value: "\(stats.quizzesCount)", label: "quizzes generated")
                        StatRow(icon: "rectangle.stack.fill", value: "\(stats.flashcardsCount)", label: "flashcards created")
                        if stats.audioHours > 0 {
                            StatRow(icon: "headphones", value: String(format: "%.1f", stats.audioHours), label: "hours of audio content")
                        }
                    }
                    .padding(.horizontal, 24)
                }

                Spacer()

                // Buttons
                VStack(spacing: 12) {
                    // Stay signed in (primary)
                    Button {
                        AnalyticsService.shared.track(.signoutCancelled, properties: [:])
                        FirebaseAnalyticsHelper.shared.logSignOutCancelled()
                        dismiss()
                    } label: {
                        Text("Stay Signed In")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 56)
                            .background(Color.purple80)
                            .cornerRadius(16)
                    }

                    // Sign out anyway
                    Button {
                        AnalyticsService.shared.track(.signoutCompleted, properties: [
                            "notes_count": stats.notesCount,
                            "quizzes_count": stats.quizzesCount
                        ])
                        FirebaseAnalyticsHelper.shared.logSignOutCompleted()
                        onSignOut()
                        dismiss()
                    } label: {
                        Text("Sign Out Anyway")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.textSecondary)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .onAppear {
            AnalyticsService.shared.track(.signoutAttempted, properties: [:])
            FirebaseAnalyticsHelper.shared.logSignOutAttempted()
            loadStats()
        }
    }

    private func loadStats() {
        Task {
            if let token = await TokenManager.shared.getValidToken() {
                do {
                    let fetchedStats = try await APIService.shared.getUserStats(token: token)
                    await MainActor.run {
                        stats = fetchedStats
                        isLoading = false
                        AnalyticsService.shared.track(.signoutValueShown, properties: [
                            "notes_count": fetchedStats.notesCount,
                            "quizzes_count": fetchedStats.quizzesCount
                        ])
                    }
                } catch {
                    await MainActor.run {
                        isLoading = false
                    }
                }
            } else {
                isLoading = false
            }
        }
    }
}

// MARK: - Delete Account Confirmation View
struct DeleteAccountConfirmationView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var stats: UserStats = .empty
    @State private var isLoading = true
    @State private var showReasonPicker = false
    @State private var selectedReason: DeletionReason?
    @State private var isDeleting = false
    @State private var showError = false
    @State private var errorMessage = ""

    let onDelete: () async throws -> Void

    var body: some View {
        ZStack {
            Color.darkBackground.ignoresSafeArea()

            if showReasonPicker {
                deletionReasonView
            } else {
                confirmationView
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            AnalyticsService.shared.track(.deleteAccountAttempted, properties: [:])
            FirebaseAnalyticsHelper.shared.logDeleteAccountAttempted()
            loadStats()
        }
    }

    // MARK: - Confirmation View
    private var confirmationView: some View {
        VStack(spacing: 24) {
            // Header
            VStack(spacing: 12) {
                Image(systemName: "trash.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.red)

                Text("Delete Account?")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text("This cannot be undone.\nYou'll permanently lose:")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 32)

            // Stats
            if isLoading {
                ProgressView()
                    .tint(.purple80)
                    .padding(.vertical, 40)
            } else {
                VStack(spacing: 16) {
                    StatRow(icon: "doc.text.fill", value: "\(stats.notesCount)", label: "notes you've created")
                    StatRow(icon: "questionmark.circle.fill", value: "\(stats.quizzesCount)", label: "quizzes generated")
                    StatRow(icon: "rectangle.stack.fill", value: "\(stats.flashcardsCount)", label: "flashcards created")
                }
                .padding(.horizontal, 24)
            }

            Spacer()

            // Buttons
            VStack(spacing: 12) {
                // Keep account (primary)
                Button {
                    AnalyticsService.shared.track(.deleteAccountCancelled, properties: [:])
                    FirebaseAnalyticsHelper.shared.logDeleteAccountCancelled()
                    dismiss()
                } label: {
                    Text("Keep My Account")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple80)
                        .cornerRadius(16)
                }

                // Delete anyway
                Button {
                    showReasonPicker = true
                } label: {
                    Text("Delete Anyway")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.red)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Deletion Reason View
    private var deletionReasonView: some View {
        VStack(spacing: 24) {
            // Header
            VStack(spacing: 12) {
                Text("Before you go...")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text("Help us improve by telling us why you're leaving")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 32)

            // Reasons
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(DeletionReason.allCases, id: \.self) { reason in
                        Button {
                            selectedReason = reason
                        } label: {
                            HStack {
                                Text(reason.displayName)
                                    .font(.system(size: 16))
                                    .foregroundColor(.textPrimary)

                                Spacer()

                                if selectedReason == reason {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundColor(.purple80)
                                }
                            }
                            .padding(16)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.cardBackground)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(selectedReason == reason ? Color.purple80 : Color.clear, lineWidth: 2)
                            )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                .padding(.horizontal, 24)
            }

            Spacer()

            // Buttons
            VStack(spacing: 12) {
                // Back
                Button {
                    showReasonPicker = false
                } label: {
                    Text("Go Back")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.purple80)
                        .cornerRadius(16)
                }

                // Confirm delete
                Button {
                    performDeletion()
                } label: {
                    HStack {
                        if isDeleting {
                            ProgressView()
                                .tint(.red)
                        } else {
                            Text("Delete My Account")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(.red)
                        }
                    }
                }
                .disabled(selectedReason == nil || isDeleting)
                .opacity(selectedReason == nil ? 0.5 : 1)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Actions
    private func loadStats() {
        Task {
            if let token = await TokenManager.shared.getValidToken() {
                do {
                    let fetchedStats = try await APIService.shared.getUserStats(token: token)
                    await MainActor.run {
                        stats = fetchedStats
                        isLoading = false
                        AnalyticsService.shared.track(.deleteAccountValueShown, properties: [
                            "notes_count": fetchedStats.notesCount,
                            "quizzes_count": fetchedStats.quizzesCount
                        ])
                    }
                } catch {
                    await MainActor.run {
                        isLoading = false
                    }
                }
            } else {
                isLoading = false
            }
        }
    }

    private func performDeletion() {
        guard let reason = selectedReason else { return }

        isDeleting = true

        Task {
            do {
                AnalyticsService.shared.track(.deleteAccountCompleted, properties: [
                    "reason": reason.rawValue,
                    "notes_count": stats.notesCount
                ])
                FirebaseAnalyticsHelper.shared.logDeleteAccountCompleted(
                    reason: reason.rawValue,
                    notesCount: stats.notesCount
                )

                try await onDelete()

                await MainActor.run {
                    isDeleting = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isDeleting = false
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
        }
    }
}

// MARK: - Stat Row
struct StatRow: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundColor(.purple80)
                .frame(width: 32)

            HStack(spacing: 4) {
                Text(value)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.textPrimary)

                Text(label)
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
            }

            Spacer()
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.cardBackground)
        )
    }
}

// MARK: - Previews
#Preview("Sign Out") {
    SignOutConfirmationView {
        print("Signed out")
    }
}

#Preview("Delete Account") {
    DeleteAccountConfirmationView {
        print("Deleted")
    }
}
