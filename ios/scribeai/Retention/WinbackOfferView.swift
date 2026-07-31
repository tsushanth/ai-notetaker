//
//  WinbackOfferView.swift
//  scribeai
//
//  Winback offer shown to users who dismissed the paywall 3+ times.
//  Highlights value props and offers a yearly subscription CTA.
//

import SwiftUI
import PaywallKit

struct WinbackOfferView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var store = StoreManager.shared
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.08, blue: 0.12),
                    Color(red: 0.15, green: 0.10, blue: 0.25)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {

                    // MARK: - Badge
                    Text("SPECIAL OFFER")
                        .font(.system(size: 12, weight: .bold))
                        .tracking(1.5)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(Color.purple80)
                        )
                        .padding(.top, 40)

                    // MARK: - Headline
                    VStack(spacing: 8) {
                        Text("We miss you!")
                            .font(.system(size: 32, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text("Unlock your full study potential with ScribeAI Premium")
                            .font(.system(size: 16))
                            .foregroundColor(.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    // MARK: - Value Props
                    VStack(spacing: 16) {
                        WinbackFeatureRow(
                            icon: "mic.fill",
                            title: "Unlimited Lecture Transcriptions",
                            subtitle: "Record any lecture, meeting, or conversation"
                        )
                        WinbackFeatureRow(
                            icon: "brain.head.profile",
                            title: "AI-Powered Study Notes",
                            subtitle: "Instant summaries and key takeaways"
                        )
                        WinbackFeatureRow(
                            icon: "questionmark.circle.fill",
                            title: "Quizzes & Flashcards",
                            subtitle: "AI-generated study materials from your notes"
                        )
                        WinbackFeatureRow(
                            icon: "headphones",
                            title: "Audio Podcasts",
                            subtitle: "Convert any note into a listenable podcast"
                        )
                        WinbackFeatureRow(
                            icon: "bubble.left.and.bubble.right.fill",
                            title: "AI Chat Assistant",
                            subtitle: "Ask questions about your notes instantly"
                        )
                    }
                    .padding(.horizontal, 24)

                    // MARK: - CTA Button
                    Button {
                        purchaseYearly()
                    } label: {
                        HStack {
                            if isPurchasing {
                                ProgressView()
                                    .tint(.white)
                            } else {
                                VStack(spacing: 2) {
                                    Text("Start Free Trial")
                                        .font(.system(size: 18, weight: .bold))
                                    if let yearly = store.paywallProducts.first(where: { $0.period == .yearly }) {
                                        Text("then \(yearly.localizedPrice)/year")
                                            .font(.system(size: 13))
                                            .opacity(0.85)
                                    }
                                }
                            }
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 60)
                        .background(
                            LinearGradient(
                                colors: [Color.purple80, Color(red: 0.6, green: 0.4, blue: 1.0)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(16)
                        .shadow(color: Color.purple80.opacity(0.4), radius: 12, y: 6)
                    }
                    .disabled(isPurchasing)
                    .padding(.horizontal, 24)

                    // MARK: - Dismiss
                    Button {
                        dismiss()
                    } label: {
                        Text("No thanks")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.textTertiary)
                    }
                    .padding(.bottom, 40)
                }
            }
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - Purchase

    private func purchaseYearly() {
        let yearlyId = ScribeProductID.yearly

        isPurchasing = true

        Task {
            let result = await store.purchase(productId: yearlyId)
            await MainActor.run {
                isPurchasing = false
                switch result {
                case .purchased:
                    TikTokHelper.shared.trackEvent("purchase_success", properties: ["product_id": yearlyId])
                    do {
                        let storeProduct = StoreKitManager.shared.products.first(where: { $0.id == yearlyId })
                        let price = storeProduct.map { NSDecimalNumber(decimal: $0.price).doubleValue } ?? 0
                        let currency = storeProduct?.priceFormatStyle.currencyCode ?? "USD"
                        FacebookSDKHelper.shared.logSubscriptionStarted(productId: yearlyId, price: price, currency: currency)
                    }
                    PaywallManager.shared.trackEvent(appId: "scribeai", placement: "winback", templateId: "default", event: "winback_purchased", productId: yearlyId)
                    dismiss()
                case .cancelled:
                    break
                case .failed:
                    errorMessage = "Purchase failed. Please try again."
                    showError = true
                default:
                    break
                }
            }
        }
    }
}

// MARK: - Feature Row

private struct WinbackFeatureRow: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.purple80.opacity(0.2))
                    .frame(width: 48, height: 48)

                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.purple80)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
            }

            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.accentGreen)
                .font(.system(size: 20))
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.cardBackground)
        )
    }
}

// MARK: - Preview

#Preview {
    WinbackOfferView()
}
