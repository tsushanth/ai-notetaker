//
//  ScribeRemotePaywallView.swift
//  scribeai
//
//  PaywallKit-powered paywall with StoreKit 2 purchases.
//

import SwiftUI
import PaywallKit

struct ScribeRemotePaywallView: View {
    @Environment(\.dismiss) private var dismiss
    var triggerSource: String = "unknown"
    let onSubscriptionComplete: (() -> Void)?
    @State private var didPurchaseOrRestore = false
    @ObservedObject private var store = StoreManager.shared

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
                PaywallFeature(icon: "\u{1F4DD}", title: "Unlimited Notebooks", description: "No limits on notes"),
                PaywallFeature(icon: "\u{1F916}", title: "AI Summaries & Chat", description: "Summarize and ask questions"),
                PaywallFeature(icon: "\u{1F399}\u{FE0F}", title: "Audio Podcasts", description: "Turn notes into podcasts"),
                PaywallFeature(icon: "\u{1F9E0}", title: "Quizzes & Flashcards", description: "Auto-generated study material"),
                PaywallFeature(icon: "\u{1F5FA}\u{FE0F}", title: "Mind Maps", description: "Visualize complex topics")
            ],
            products: store.paywallProducts,
            theme: PaywallTheme(accent: Color(red: 0.49, green: 0.23, blue: 0.93), accent2: Color(red: 0.66, green: 0.33, blue: 0.97)),
            showWinback: true,
            onPurchase: { productId in
                let result = await store.purchase(productId: productId)
                if case .purchased = result {
                    didPurchaseOrRestore = true
                    await SubscriptionGateManager.shared.refreshAccessStatus()
                    await MainActor.run { handleDismiss() }
                    return true
                }
                return false
            },
            onRestore: {
                await store.restore()
                await StoreManager.shared.refreshSubscriptionStatus()
                if StoreManager.shared.isPremium {
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
