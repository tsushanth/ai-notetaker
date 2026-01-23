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
    @State private var showTrialSkipButton = false  // Delayed skip button for trial screen

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
        .onChange(of: manager.currentStep) { newStep in
            stepEntryTime = Date()
            // Reset and delay skip button on trial screen
            if newStep == .trial {
                showTrialSkipButton = false
                // Show skip button after 3 seconds on trial screen
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                    withAnimation(.easeIn(duration: 0.3)) {
                        showTrialSkipButton = true
                    }
                }
            }
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

                // Skip button - smaller on trial screen with delayed appearance
                Button {
                    // Track trial skip with enhanced data when on trial step
                    if manager.currentStep == .trial {
                        let timeSpent = Int(Date().timeIntervalSince(stepEntryTime))
                        manager.skipTrial(timeSpentSeconds: timeSpent, selectedPlan: nil)
                    } else {
                        manager.skipOnboarding()
                    }
                } label: {
                    Text(manager.currentStep == .trial ? "Maybe later" : "Skip")
                        .font(.system(size: manager.currentStep == .trial ? 13 : 16, weight: .medium))
                        .foregroundColor(manager.currentStep == .trial ? .textTertiary : .textSecondary)
                }
                // On trial screen, hide until delay passes
                .opacity(manager.currentStep == .trial ? (showTrialSkipButton ? 1 : 0) : 1)
                .disabled(manager.currentStep == .trial && !showTrialSkipButton)
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
        case .trial:
            OnboardingTrialView()
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
