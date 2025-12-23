//
//  PaywallView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/29/25.
//


//
//  PaywallView.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati
//  Subscription paywall UI matching Android design
//

import SwiftUI
import StoreKit

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var storeManager = StoreKitManager.shared
    
    @State private var selectedProduct: Product?
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""
    
    let onSubscriptionComplete: (() -> Void)?
    
    init(onSubscriptionComplete: (() -> Void)? = nil) {
        self.onSubscriptionComplete = onSubscriptionComplete
    }
    
    var body: some View {
        ZStack {
            Color.darkBackground
                .ignoresSafeArea()
            
            ScrollView {
                VStack(spacing: 0) {
                    // Header
                    headerSection
                    
                    // Features List
                    featuresSection
                    
                    // Subscription Options
                    subscriptionOptionsSection
                    
                    // Subscribe Button
                    subscribeButton
                    
                    // Restore & Terms
                    footerSection
                }
            }
            
            // Loading Overlay
            if isPurchasing || storeManager.isLoading {
                loadingOverlay
            }
        }
        .navigationBarItems(leading: Button {
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .foregroundColor(.textSecondary)
        })
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            // Pre-select yearly as default (best value)
            if selectedProduct == nil {
                selectedProduct = storeManager.getYearlyProduct()
            }
        }
        .onChange(of: storeManager.products) { products in
            if selectedProduct == nil, let yearly = storeManager.getYearlyProduct() {
                selectedProduct = yearly
            }
        }.onAppear {
            AnalyticsService.shared.trackPaywallViewed(source: "profile")
        }
    }
    
    // MARK: - Header Section
    
    private var headerSection: some View {
        VStack(spacing: 16) {
            // App Icon / Logo
            ZStack {
                Circle()
                    .fill(Color.purple80.opacity(0.2))
                    .frame(width: 80, height: 80)
                
                Image(systemName: "sparkles")
                    .font(.system(size: 36))
                    .foregroundColor(.purple80)
            }
            .padding(.top, 32)
            
            Text("Unlock ScribeAI Premium")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.textPrimary)
                .multilineTextAlignment(.center)
            
            Text("Get unlimited access to all AI-powered features")
                .font(.system(size: 16))
                .foregroundColor(.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.bottom, 32)
    }
    
    // MARK: - Features Section
    
    private var featuresSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            FeatureRow(icon: "infinity", title: "Unlimited Notebooks", description: "Create as many notes as you need")
            FeatureRow(icon: "doc.text.magnifyingglass", title: "AI Summaries", description: "Instant summaries of your content")
            FeatureRow(icon: "headphones", title: "Audio Podcasts", description: "Convert notes to podcasts")
            FeatureRow(icon: "questionmark.circle", title: "Quizzes & Flashcards", description: "AI-generated study materials")
            FeatureRow(icon: "bubble.left.and.bubble.right", title: "AI Chat Assistant", description: "Ask questions about your notes")
            FeatureRow(icon: "icloud", title: "Cloud Sync", description: "Access from all your devices")
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 32)
    }
    
    // MARK: - Subscription Options Section
    
    private var subscriptionOptionsSection: some View {
        VStack(spacing: 12) {
            if storeManager.products.isEmpty {
                // Loading state
                ProgressView()
                    .tint(.purple80)
                    .padding()
            } else {
                // Yearly Option (Best Value)
                if let yearly = storeManager.getYearlyProduct() {
                    SubscriptionOptionCard(
                        product: yearly,
                        isSelected: selectedProduct?.id == yearly.id,
                        isBestValue: true,
                        savingsText: storeManager.savingsPercentage().map { "Save \($0)%" },
                        monthlyEquivalent: storeManager.monthlyEquivalentPrice(for: yearly)
                    ) {
                        selectedProduct = yearly
                    }
                }
                
                // Monthly Option
                if let monthly = storeManager.getMonthlyProduct() {
                    SubscriptionOptionCard(
                        product: monthly,
                        isSelected: selectedProduct?.id == monthly.id,
                        isBestValue: false,
                        savingsText: nil,
                        monthlyEquivalent: nil
                    ) {
                        selectedProduct = monthly
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }
    
    // MARK: - Subscribe Button
    
    private var subscribeButton: some View {
        Button(action: purchase) {
            HStack {
                if isPurchasing {
                    ProgressView()
                        .tint(.white)
                } else {
                    Text(buttonText)
                        .font(.system(size: 18, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(Color.purple80)
            .foregroundColor(.white)
            .cornerRadius(16)
        }
        .disabled(selectedProduct == nil || isPurchasing)
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
    }
    
    private var buttonText: String {
        guard let product = selectedProduct else {
            return "Select a Plan"
        }
        return "Subscribe for \(product.displayPrice)/\(product.periodDescription)"
    }
    
    // MARK: - Footer Section
    
    private var footerSection: some View {
        VStack(spacing: 16) {
            // Restore Purchases
            Button(action: restorePurchases) {
                Text("Restore Purchases")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.purple80)
            }
            
            // Terms and Privacy
            HStack(spacing: 8) {
                if let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") {
                    Link("Terms of Service", destination: termsURL)
                        .font(.system(size: 12))
                        .foregroundColor(.textTertiary)
                }

                Text("•")
                    .foregroundColor(.textTertiary)

                if let privacyURL = URL(string: "https://www.sendsmiles.biz/privacy-policy") {
                    Link("Privacy Policy", destination: privacyURL)
                        .font(.system(size: 12))
                        .foregroundColor(.textTertiary)
                }
            }
            
            // Subscription Info
            Text("Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period. You can manage and cancel your subscriptions in your App Store account settings.")
                .font(.system(size: 11))
                .foregroundColor(.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
        .padding(.bottom, 32)
    }
    
    // MARK: - Loading Overlay
    
    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
            
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.white)
                
                Text("Processing...")
                    .font(.headline)
                    .foregroundColor(.white)
            }
            .padding(32)
            .background(Color.black.opacity(0.7))
            .cornerRadius(16)
        }
    }
    
    // MARK: - Actions
    
    private func purchase() {
        guard let product = selectedProduct else { return }

        isPurchasing = true

        Task {
            do {
                try await storeManager.purchase(product)

                await MainActor.run {
                    isPurchasing = false
                    // Dismiss the paywall - use callback if provided, otherwise use dismiss()
                    if let onComplete = onSubscriptionComplete {
                        onComplete()
                    } else {
                        dismiss()
                    }
                }

            } catch PurchaseError.purchaseCancelled {
                await MainActor.run {
                    isPurchasing = false
                }
            } catch {
                await MainActor.run {
                    isPurchasing = false
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
        }
    }
    
    private func restorePurchases() {
        Task {
            await storeManager.restorePurchases()

            if storeManager.isSubscribed {
                // Dismiss the paywall - use callback if provided, otherwise use dismiss()
                if let onComplete = onSubscriptionComplete {
                    onComplete()
                } else {
                    dismiss()
                }
            }
        }
    }
}

// MARK: - Feature Row

struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.purple80.opacity(0.2))
                    .frame(width: 44, height: 44)
                
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(.purple80)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)
                
                Text(description)
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
            }
            
            Spacer()
            
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.accentGreen)
        }
    }
}

// MARK: - Subscription Option Card

struct SubscriptionOptionCard: View {
    let product: Product
    let isSelected: Bool
    let isBestValue: Bool
    let savingsText: String?
    let monthlyEquivalent: String?
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack {
                // Radio Button
                ZStack {
                    Circle()
                        .stroke(isSelected ? Color.purple80 : Color.textTertiary, lineWidth: 2)
                        .frame(width: 24, height: 24)
                    
                    if isSelected {
                        Circle()
                            .fill(Color.purple80)
                            .frame(width: 14, height: 14)
                    }
                }
                
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(product.displayName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textPrimary)
                        
                        if isBestValue {
                            Text("BEST VALUE")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.accentGreen)
                                .cornerRadius(4)
                        }
                    }
                    
                    if let monthlyEquivalent = monthlyEquivalent {
                        Text("\(monthlyEquivalent)/month")
                            .font(.system(size: 13))
                            .foregroundColor(.textSecondary)
                    }
                }
                
                Spacer()
                
                VStack(alignment: .trailing, spacing: 4) {
                    Text(product.displayPrice)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.textPrimary)
                    
                    Text("/\(product.periodDescription)")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                    
                    if let savingsText = savingsText {
                        Text(savingsText)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.accentGreen)
                    }
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Preview

#Preview {
    NavigationView {
        PaywallView()
    }
}
