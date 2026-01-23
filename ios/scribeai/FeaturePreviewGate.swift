//
//  FeaturePreviewGate.swift
//  scribeai
//
//  Shows a preview of premium content with a paywall gate to unlock more
//  Strategy: Let users see partial value to motivate subscription
//

import SwiftUI

// MARK: - Feature Preview Gate Manager

@MainActor
class FeaturePreviewGateManager {
    static let shared = FeaturePreviewGateManager()

    // Number of free items to show for each feature type
    let freeFlashcardsCount = 3
    let freeQuizQuestionsCount = 3
    let freeSummaryCharacters = 500

    private init() {}

    /// Check if user should see preview gate (trial expired AND not subscribed)
    var shouldShowPreviewGate: Bool {
        let gateManager = SubscriptionGateManager.shared

        // Show full content if subscribed or in trial
        if gateManager.isSubscribed || gateManager.isInTrialPeriod {
            return false
        }

        // Show preview gate if trial expired
        return gateManager.hasTrialExpired
    }
}

// MARK: - Flashcard Preview Overlay

struct FlashcardPreviewOverlay: View {
    let currentIndex: Int
    let totalCards: Int
    let freeLimit: Int
    let onSubscribe: () -> Void

    var shouldShow: Bool {
        FeaturePreviewGateManager.shared.shouldShowPreviewGate &&
        currentIndex >= freeLimit
    }

    var body: some View {
        if shouldShow {
            ZStack {
                // Blur background
                Color.darkBackground.opacity(0.95)

                VStack(spacing: 20) {
                    // Lock icon
                    ZStack {
                        Circle()
                            .fill(Color.purple80.opacity(0.2))
                            .frame(width: 80, height: 80)

                        Image(systemName: "lock.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.purple80)
                    }

                    // Message
                    VStack(spacing: 8) {
                        Text("You've seen \(freeLimit) of \(totalCards) cards")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text("Subscribe to unlock all flashcards and study more effectively")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    // Subscribe button
                    Button(action: onSubscribe) {
                        HStack {
                            Image(systemName: "crown.fill")
                            Text("Unlock All Cards")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.purple80)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)

                    // Start trial text
                    Text("Start your free 7-day trial")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
            }
            .transition(.opacity)
        }
    }
}

// MARK: - Quiz Preview Overlay

struct QuizPreviewOverlay: View {
    let currentIndex: Int
    let totalQuestions: Int
    let freeLimit: Int
    let onSubscribe: () -> Void

    var shouldShow: Bool {
        FeaturePreviewGateManager.shared.shouldShowPreviewGate &&
        currentIndex >= freeLimit
    }

    var body: some View {
        if shouldShow {
            ZStack {
                Color.darkBackground.opacity(0.95)

                VStack(spacing: 20) {
                    ZStack {
                        Circle()
                            .fill(Color.purple80.opacity(0.2))
                            .frame(width: 80, height: 80)

                        Image(systemName: "lock.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.purple80)
                    }

                    VStack(spacing: 8) {
                        Text("You've answered \(freeLimit) of \(totalQuestions) questions")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text("Subscribe to complete the quiz and test your knowledge")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    Button(action: onSubscribe) {
                        HStack {
                            Image(systemName: "crown.fill")
                            Text("Unlock Full Quiz")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.purple80)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 32)

                    Text("Start your free 7-day trial")
                        .font(.system(size: 13))
                        .foregroundColor(.textTertiary)
                }
            }
            .transition(.opacity)
        }
    }
}

// MARK: - Summary Preview View

struct SummaryPreviewView: View {
    let fullText: String
    let charLimit: Int
    let onSubscribe: () -> Void

    private var shouldTruncate: Bool {
        FeaturePreviewGateManager.shared.shouldShowPreviewGate &&
        fullText.count > charLimit
    }

    private var displayText: String {
        if shouldTruncate {
            let index = fullText.index(fullText.startIndex, offsetBy: min(charLimit, fullText.count))
            return String(fullText[..<index]) + "..."
        }
        return fullText
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(displayText)
                .font(.system(size: 15))
                .foregroundColor(.textPrimary)
                .lineSpacing(6)

            if shouldTruncate {
                // Gradient fade
                LinearGradient(
                    colors: [Color.clear, Color.darkBackground],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 60)
                .offset(y: -76)
                .allowsHitTesting(false)

                // Unlock prompt
                VStack(spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: "lock.fill")
                            .foregroundColor(.purple80)
                        Text("Subscribe to read the full summary")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.textSecondary)
                    }

                    Button(action: {
                        AnalyticsService.shared.trackPaywallViewed(source: "summary_preview_gate")
                        onSubscribe()
                    }) {
                        HStack {
                            Image(systemName: "crown.fill")
                            Text("Unlock Full Summary")
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color.purple80)
                        .cornerRadius(10)
                    }
                }
                .padding()
                .background(Color.cardBackground)
                .cornerRadius(12)
            }
        }
    }
}

// MARK: - Preview Badge

struct PreviewBadge: View {
    var body: some View {
        if FeaturePreviewGateManager.shared.shouldShowPreviewGate {
            HStack(spacing: 4) {
                Image(systemName: "eye.fill")
                    .font(.system(size: 10))
                Text("PREVIEW")
                    .font(.system(size: 10, weight: .bold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.purple80)
            .cornerRadius(4)
        }
    }
}
