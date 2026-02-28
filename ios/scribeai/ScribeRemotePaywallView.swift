//
//  ScribeRemotePaywallView.swift
//  scribeai
//
//  RevenueCat remote paywall for A/B testing and experimentation.
//  Design is controlled from the RevenueCat dashboard.
//

import SwiftUI
import RevenueCatUI
import RevenueCat

struct ScribeRemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    let onSubscriptionComplete: (() -> Void)?

    init(triggerSource: String = "unknown", onSubscriptionComplete: (() -> Void)? = nil) {
        self.triggerSource = triggerSource
        self.onSubscriptionComplete = onSubscriptionComplete
    }

    private func handleDismiss() {
        if let onComplete = onSubscriptionComplete {
            onComplete()
        } else {
            dismiss()
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            RevenueCatUI.PaywallView(displayCloseButton: false)
                .onPurchaseCompleted { _ in
                    // Sync with existing backend
                    Task {
                        await RevenueCatManager.shared.refreshCustomerInfo()
                        await SubscriptionGateManager.shared.refreshAccessStatus()
                    }
                    handleDismiss()
                }
                .onRestoreCompleted { customerInfo in
                    if customerInfo.entitlements["premium"]?.isActive == true {
                        Task {
                            await SubscriptionGateManager.shared.refreshAccessStatus()
                        }
                        handleDismiss()
                    }
                }

            // Custom close button — 44x44pt minimum tap target
            Button(action: { dismiss() }) {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
                    .contentShape(Circle())
            }
            .padding(.leading, 16)
            .padding(.top, 16)
        }
        .onAppear {
            Purchases.shared.attribution.setAttributes([
                "last_paywall_source": triggerSource,
                "last_paywall_date": ISO8601DateFormatter().string(from: Date())
            ])
            // Track in existing analytics
            AnalyticsService.shared.trackPaywallViewed(source: triggerSource)
        }
    }
}
