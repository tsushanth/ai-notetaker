//
//  PostValueTrialPrompt.swift
//  scribeai
//
//  Shows a gentle trial prompt after user experiences value (first AI content)
//  Strategy: Users who skip onboarding trial get a second chance after seeing value
//

import SwiftUI

// MARK: - Post Value Trial Manager

@MainActor
class PostValueTrialManager: ObservableObject {
    static let shared = PostValueTrialManager()

    @Published var shouldShowPrompt = false

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let hasShownPostValuePrompt = "has_shown_post_value_prompt"
        static let lastPromptDate = "last_post_value_prompt_date"
        static let promptDismissCount = "post_value_prompt_dismiss_count"
    }

    private init() {}

    /// Call this after user reaches value (AI content generated)
    /// Only shows if: not subscribed, hasn't seen prompt recently, skipped onboarding trial
    func checkAndTriggerPrompt() {
        // Don't show if already subscribed
        guard !StoreKitManager.shared.isSubscribed else { return }

        // Don't show if within trial
        guard !SubscriptionGateManager.shared.isInTrialPeriod else { return }

        // Don't show if already shown recently (within 24 hours)
        if let lastPrompt = defaults.object(forKey: Keys.lastPromptDate) as? Date {
            let hoursSinceLastPrompt = Date().timeIntervalSince(lastPrompt) / 3600
            if hoursSinceLastPrompt < 24 { return }
        }

        // Don't show more than 3 times total
        let dismissCount = defaults.integer(forKey: Keys.promptDismissCount)
        if dismissCount >= 3 { return }

        // Show the prompt
        shouldShowPrompt = true
        defaults.set(Date(), forKey: Keys.lastPromptDate)

        // Track this
        AnalyticsService.shared.track(.paywallViewed, properties: [
            "source": "post_value_prompt",
            "prompt_number": dismissCount + 1
        ])
    }

    func dismissPrompt() {
        shouldShowPrompt = false
        let count = defaults.integer(forKey: Keys.promptDismissCount) + 1
        defaults.set(count, forKey: Keys.promptDismissCount)

        AnalyticsService.shared.trackPaywallDismissed(
            source: "post_value_prompt",
            timeSpentSeconds: 0,
            selectedPlan: nil
        )
    }

    func reset() {
        defaults.removeObject(forKey: Keys.hasShownPostValuePrompt)
        defaults.removeObject(forKey: Keys.lastPromptDate)
        defaults.removeObject(forKey: Keys.promptDismissCount)
        shouldShowPrompt = false
    }
}

// MARK: - Post Value Trial Prompt View

struct PostValueTrialPromptView: View {
    @ObservedObject private var manager = PostValueTrialManager.shared
    @StateObject private var storeManager = StoreKitManager.shared
    @State private var showFullPaywall = false

    var body: some View {
        VStack(spacing: 16) {
            // Handle bar
            RoundedRectangle(cornerRadius: 2.5)
                .fill(Color.textTertiary.opacity(0.5))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            // Content
            VStack(spacing: 12) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Color.purple80.opacity(0.15))
                        .frame(width: 56, height: 56)

                    Image(systemName: "sparkles")
                        .font(.system(size: 24))
                        .foregroundColor(.purple80)
                }

                // Title
                Text("Loving the AI features?")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.textPrimary)

                // Subtitle
                Text("Start your free 7-day trial to keep using unlimited AI features")
                    .font(.system(size: 15))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                // Trial timeline preview
                HStack(spacing: 24) {
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.accentGreen)
                        Text("Today")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.textSecondary)
                        Text("Free access")
                            .font(.system(size: 10))
                            .foregroundColor(.textTertiary)
                    }

                    Image(systemName: "arrow.right")
                        .foregroundColor(.textTertiary)

                    VStack(spacing: 4) {
                        Image(systemName: "bell.badge.fill")
                            .foregroundColor(.blue)
                        Text("Day 5")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.textSecondary)
                        Text("Reminder")
                            .font(.system(size: 10))
                            .foregroundColor(.textTertiary)
                    }

                    Image(systemName: "arrow.right")
                        .foregroundColor(.textTertiary)

                    VStack(spacing: 4) {
                        Image(systemName: "creditcard.fill")
                            .foregroundColor(.purple80)
                        Text("Day 7")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.textSecondary)
                        Text("First charge")
                            .font(.system(size: 10))
                            .foregroundColor(.textTertiary)
                    }
                }
                .padding(.vertical, 12)

                // CTA Button
                Button {
                    AnalyticsService.shared.trackPaywallViewed(source: "post_value_prompt_cta")
                    showFullPaywall = true
                } label: {
                    HStack {
                        Image(systemName: "crown.fill")
                        Text("Start Free Trial")
                            .fontWeight(.semibold)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color.purple80)
                    .cornerRadius(12)
                }
                .padding(.horizontal, 24)

                // Dismiss button
                Button {
                    manager.dismissPrompt()
                } label: {
                    Text("Maybe later")
                        .font(.system(size: 14))
                        .foregroundColor(.textTertiary)
                }
                .padding(.bottom, 8)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .background(Color.cardBackground)
        .cornerRadius(20, corners: [.topLeft, .topRight])
        .sheet(isPresented: $showFullPaywall) {
            NavigationView {
                ScribeRemotePaywallView(triggerSource: "post_value_prompt") {
                    showFullPaywall = false
                    manager.dismissPrompt()
                }
            }
        }
    }
}

// MARK: - View Modifier for Post Value Prompt

struct PostValuePromptModifier: ViewModifier {
    @ObservedObject private var manager = PostValueTrialManager.shared

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $manager.shouldShowPrompt) {
                PostValueTrialPromptView()
                    .presentationDetents([.height(380)])
                    .presentationDragIndicator(.hidden)
            }
    }
}

extension View {
    func postValueTrialPrompt() -> some View {
        modifier(PostValuePromptModifier())
    }
}

// MARK: - Corner Radius Extension

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()

        VStack {
            Spacer()
            PostValueTrialPromptView()
        }
    }
}
