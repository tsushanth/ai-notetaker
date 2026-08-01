//
//  OnboardingView.swift
//  scribeai
//
//  Main onboarding container with navigation
//

import SwiftUI

struct OnboardingView: View {
    @StateObject private var manager = OnboardingManager.shared
    @Environment(\.dismiss) private var dismiss
    @State private var stepEntryTime: Date = Date()

    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Progress bar and navigation
                headerView

                // Content based on current step
                contentView
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)
                    ))
            }
        }
        .onAppear {
            AnalyticsService.shared.track(.onboardingStarted, properties: [:])
            stepEntryTime = Date()
        }
        .onChange(of: manager.currentStep) { _ in
            stepEntryTime = Date()
        }
    }

    // MARK: - Header
    private var headerView: some View {
        VStack(spacing: 12) {
            HStack {
                // Back button (hidden on first step)
                Button {
                    manager.previousStep()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(.textSecondary)
                }
                .opacity(manager.currentStep.rawValue > 0 ? 1 : 0)
                .disabled(manager.currentStep.rawValue == 0)

                Spacer()

                // Skip button — always available now that trial step is removed
                Button {
                    manager.skipOnboarding()
                } label: {
                    Text("Skip")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.textSecondary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 4)

                    // Progress
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.purple80)
                        .frame(width: geometry.size.width * manager.currentStep.progress, height: 4)
                        .animation(.easeInOut(duration: 0.3), value: manager.currentStep)
                }
            }
            .frame(height: 4)
            .padding(.horizontal, 20)
        }
    }

    // MARK: - Content
    @ViewBuilder
    private var contentView: some View {
        switch manager.currentStep {
        case .userType:
            OnboardingUserTypeView()
        case .useCase:
            OnboardingUseCaseView()
        case .featureUpload:
            OnboardingFeatureUploadView()
        case .featureNotes:
            OnboardingFeatureNotesView()
        case .featureFlashcards:
            OnboardingFeatureFlashcardsView()
        case .featureQuiz:
            OnboardingFeatureQuizView()
        case .featureAudio:
            OnboardingFeatureAudioView()
        case .socialProof:
            OnboardingSocialProofView()
        case .comparison:
            OnboardingComparisonView()
        case .notifications:
            OnboardingNotificationsView()
        }
    }
}

// MARK: - Onboarding Button Style
struct OnboardingButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(isSelected ? Color.purple80.opacity(0.2) : Color.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

// MARK: - Primary Button
struct OnboardingPrimaryButton: View {
    let title: String
    let action: () -> Void
    var isDisabled: Bool = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(isDisabled ? Color.purple80.opacity(0.5) : Color.purple80)
                )
        }
        .disabled(isDisabled)
        .padding(.horizontal, 24)
    }
}

// MARK: - Preview
#Preview {
    OnboardingView()
}
