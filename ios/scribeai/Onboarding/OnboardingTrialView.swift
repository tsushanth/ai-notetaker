//
//  OnboardingTrialView.swift
//  scribeai
//
//  Onboarding trial step — hard paywall (TurboAI / Cal AI pattern).
//
//  Server resolves placement="onboarding_trial" → trialGate template with
//  isDismissible=false. The paywall itself has no close button or swipe-to-dismiss.
//
//  We still expose a small "Maybe Later" link below the paywall to satisfy
//  Apple guideline 3.1.2(a) (apps must be usable in some form without forced
//  subscription). Tapping it shows a confirmation dialog before actually
//  skipping — matching the TurboAI / Cal AI / RizzAI playbook.
//

import SwiftUI

struct OnboardingTrialView: View {
    @ObservedObject private var manager = OnboardingManager.shared
    @State private var screenAppearedAt = Date()

    var body: some View {
        // Hard paywall — no close button, no interactive dismiss.
        // "Maybe later" is passed as bottomAccessory so it lives inside the
        // paywall's own ScrollView (after the legal footer) and can never
        // visually collide with the CTA.
        ScribeRemotePaywallView(
            triggerSource: "onboarding_trial",
            placementOverride: "onboarding_trial",
            isDismissible: false,
            bottomAccessory: AnyView(maybeLaterLink),
            onSubscriptionComplete: {
                manager.nextStep()
            }
        )
        .onAppear {
            screenAppearedAt = Date()
            AnalyticsService.shared.trackPaywallViewed(source: "onboarding")
            SubscriptionSyncService.shared.trackMetric(eventType: .trialScreenViewed, source: "onboarding")
        }
    }

    // Tiny escape hatch — required by Apple guideline 3.1.2(a).
    // Visually de-emphasized so most users miss it. Passes straight through
    // with no confirmation — re-prompting just creates churn.
    private var maybeLaterLink: some View {
        Button {
            AnalyticsService.shared.trackTrialScreenSkipped(
                source: "onboarding_maybe_later_tap",
                timeSpentSeconds: Int(Date().timeIntervalSince(screenAppearedAt)),
                selectedPlan: nil
            )
            manager.skipTrial(timeSpentSeconds: Int(Date().timeIntervalSince(screenAppearedAt)))
        } label: {
            Text("Maybe later")
                .font(.system(size: 11, weight: .regular))
                .foregroundColor(.white.opacity(0.35))
                .underline()
        }
        .padding(.top, 12)
    }
}

#Preview {
    OnboardingTrialView()
}
