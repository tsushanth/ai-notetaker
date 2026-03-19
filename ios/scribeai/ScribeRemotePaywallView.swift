//
//  ScribeRemotePaywallView.swift
//  scribeai
//
//  PaywallKit-powered paywall with server-side A/B testing and event tracking.
//  Replaces the RevenueCat remote paywall UI.
//

import SwiftUI
import PaywallKit
import RevenueCat

struct ScribeRemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    let onSubscriptionComplete: (() -> Void)?

    @State private var paywallProducts: [PaywallProduct] = []

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
        PaywallKit.PaywallView(
            appId: "scribeai",
            appName: "ScribeAI Premium",
            features: [
                PaywallFeature(icon: "📝", title: "Unlimited Notebooks", description: "No limits on notes"),
                PaywallFeature(icon: "🤖", title: "AI Summaries & Chat", description: "Summarize and ask questions"),
                PaywallFeature(icon: "🎙️", title: "Audio Podcasts", description: "Turn notes into podcasts"),
                PaywallFeature(icon: "🧠", title: "Quizzes & Flashcards", description: "Auto-generated study material"),
                PaywallFeature(icon: "🗺️", title: "Mind Maps", description: "Visualize complex topics")
            ],
            products: paywallProducts,
            theme: PaywallTheme(accent: Color(red: 0.49, green: 0.23, blue: 0.93), accent2: Color(red: 0.66, green: 0.33, blue: 0.97)),
            showWinback: true,
            onPurchase: { productId in
                await purchaseProduct(productId: productId)
            },
            onRestore: {
                await restorePurchases()
            },
            onDismiss: {
                PaywallCoordinator.shared.trackDismiss()
                handleDismiss()
            }
        )
        .task {
            await loadProducts()
        }
        .onAppear {
            Purchases.shared.attribution.setAttributes([
                "last_paywall_source": triggerSource,
                "last_paywall_date": ISO8601DateFormatter().string(from: Date())
            ])
            AnalyticsService.shared.trackPaywallViewed(source: triggerSource)
        }
    }

    // MARK: - Product Loading

    private func loadProducts() async {
        let rcManager = RevenueCatManager.shared
        if rcManager.packages.isEmpty {
            await rcManager.loadOfferings()
        }

        paywallProducts = rcManager.packages.compactMap { pkg -> PaywallProduct? in
            let product = pkg.storeProduct
            let period: PaywallProduct.Period
            switch pkg.packageType {
            case .weekly: period = .weekly
            case .monthly: period = .monthly
            case .annual: period = .yearly
            case .lifetime: period = .lifetime
            default:
                // Map by product ID for custom packages
                if product.productIdentifier.contains("lifetime") { period = .lifetime }
                else if product.productIdentifier.contains("yearly") || product.productIdentifier.contains("annual") { period = .yearly }
                else if product.productIdentifier.contains("monthly") { period = .monthly }
                else if product.productIdentifier.contains("weekly") { period = .weekly }
                else { return nil }
            }

            var trialDays: Int? = nil
            if let intro = product.introductoryDiscount,
               intro.paymentMode == .freeTrial {
                let sub = intro.subscriptionPeriod
                switch sub.unit {
                case .day: trialDays = sub.value
                case .week: trialDays = sub.value * 7
                case .month: trialDays = sub.value * 30
                case .year: trialDays = sub.value * 365
                @unknown default: trialDays = sub.value
                }
            }

            return PaywallProduct(
                id: product.productIdentifier,
                localizedPrice: product.localizedPriceString,
                price: product.price,
                currencyCode: product.currencyCode ?? "USD",
                trialDays: trialDays,
                period: period
            )
        }
    }

    // MARK: - Purchase

    private func purchaseProduct(productId: String) async {
        let rcManager = RevenueCatManager.shared

        guard let package = rcManager.packages.first(where: {
            $0.storeProduct.productIdentifier == productId
        }) else {
            print("[ScribePaywall] No package found for \(productId)")
            return
        }

        do {
            try await rcManager.purchase(package)
            await SubscriptionGateManager.shared.refreshAccessStatus()
            await MainActor.run { handleDismiss() }
        } catch {
            print("[ScribePaywall] Purchase failed: \(error)")
        }
    }

    // MARK: - Restore

    private func restorePurchases() async {
        await RevenueCatManager.shared.restorePurchases()
        if RevenueCatManager.shared.isPremium {
            await SubscriptionGateManager.shared.refreshAccessStatus()
            await MainActor.run { handleDismiss() }
        }
    }
}
