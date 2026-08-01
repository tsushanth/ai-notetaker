//
//  ScribeRemotePaywallView.swift
//  scribeai
//
//  PaywallKit-powered paywall with StoreKit 2 purchases.
//

import SwiftUI
import PaywallKit
import RatingKit

struct ScribeRemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    var placementOverride: String? = nil
    /// Hard paywall (no close button, no swipe-to-dismiss). Used on the onboarding_trial
    /// step where we want a TurboAI-style forced trial entry. Defaults to true so all
    /// other paywall surfaces (winback, settings, etc.) keep working as before.
    var isDismissible: Bool = true
    /// Scrollable footer slot — passes through to PaywallKit's TrialGateTemplate.
    /// Used by OnboardingTrialView to inline the "Maybe later" Apple-3.1.2(a) escape
    /// hatch inside the paywall's own ScrollView (instead of overlaying it).
    var bottomAccessory: AnyView? = nil
    let onSubscriptionComplete: (() -> Void)?
    @State private var didPurchaseOrRestore = false
    @ObservedObject private var store = StoreManager.shared

    init(triggerSource: String = "unknown",
         placementOverride: String? = nil,
         isDismissible: Bool = true,
         bottomAccessory: AnyView? = nil,
         onSubscriptionComplete: (() -> Void)? = nil) {
        self.triggerSource = triggerSource
        self.placementOverride = placementOverride
        self.isDismissible = isDismissible
        self.bottomAccessory = bottomAccessory
        self.onSubscriptionComplete = onSubscriptionComplete
    }

    private func handleDismiss() {
        if let onComplete = onSubscriptionComplete {
            onComplete()
        } else {
            dismiss()
        }
    }

    private var placement: String {
        if let override = placementOverride { return override }
        if PromoCodeManager.shared.activeCode != nil { return "promo_code_onboarding" }
        return triggerSource
    }

    var body: some View {
        PaywallKit.PaywallView(
            appId: "scribeai",
            placement: placement,
            appName: "ScribeAI Premium",
            features: [
                PaywallFeature(icon: "\u{1F4DD}", title: "Unlimited Notebooks", description: "No limits on notes"),
                PaywallFeature(icon: "\u{1F916}", title: "AI Summaries & Chat", description: "Summarize and ask questions"),
                PaywallFeature(icon: "\u{1F399}\u{FE0F}", title: "Audio Podcasts", description: "Turn notes into podcasts"),
                PaywallFeature(icon: "\u{1F9E0}", title: "Quizzes & Flashcards", description: "Auto-generated study material"),
                PaywallFeature(icon: "\u{1F5FA}\u{FE0F}", title: "Mind Maps", description: "Visualize complex topics")
            ],
            products: store.paywallProducts,
            theme: PaywallTheme(accent: Color(red: 0.49, green: 0.23, blue: 0.93), accent2: Color(red: 0.66, green: 0.33, blue: 0.97)),
            showWinback: true,
            isDismissible: isDismissible,
            // bottomAccessory: not in current PaywallKit init signature.
            onPurchase: { productId in
                let result = await store.purchase(productId: productId)
                if case .purchased = result {
                    didPurchaseOrRestore = true
                    await StoreKitManager.shared.updateSubscriptionStatus()
                    await SubscriptionGateManager.shared.refreshAccessStatus()
                    TikTokHelper.shared.trackEvent("purchase_success", properties: ["product_id": productId])
                    do {
                        let storeProduct = StoreKitManager.shared.products.first(where: { $0.id == productId })
                        let price = storeProduct.map { NSDecimalNumber(decimal: $0.price).doubleValue } ?? 0
                        let currency = storeProduct?.priceFormatStyle.currencyCode ?? "USD"
                        FacebookSDKHelper.shared.logSubscriptionStarted(productId: productId, price: price, currency: currency)
                    }
                    PaywallManager.shared.trackEvent(appId: "scribeai", placement: "remote_paywall", templateId: "default", event: "purchased", productId: productId)
                    await MainActor.run {
                        RatingKit.shared.trackPurchase()
                        handleDismiss()
                    }
                    return true
                }
                return false
            },
            onRestore: {
                await store.restore()
                await StoreManager.shared.refreshSubscriptionStatus()
                await StoreKitManager.shared.updateSubscriptionStatus()
                if StoreManager.shared.isPremium || StoreKitManager.shared.isSubscribed {
                    didPurchaseOrRestore = true
                    await SubscriptionGateManager.shared.refreshAccessStatus()
                    await MainActor.run { handleDismiss() }
                }
            },
            onDismiss: {
                if !didPurchaseOrRestore {
                    PaywallCoordinator.shared.trackDismiss()
                }
                handleDismiss()
            }
        )
        .task {
            if store.paywallProducts.isEmpty {
                await store.loadProducts()
            }
        }
        .onAppear {
            AnalyticsService.shared.trackPaywallViewed(source: triggerSource)
        }
    }
}
