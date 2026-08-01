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
import PaywallKit

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var storeManager = StoreKitManager.shared

    @State private var selectedProduct: Product?
    @State private var isPurchasing = false
    @State private var showError = false
    @State private var errorMessage = ""

    // Promo code states
    @State private var showPromoCode = false
    @State private var promoCode = ""
    @State private var isValidatingPromo = false
    @State private var promoValidation: PromoValidationResult?
    @State private var promoError: String?

    // Analytics tracking
    @State private var paywallOpenTime: Date = Date()
    private let paywallSource: String

    let onSubscriptionComplete: (() -> Void)?

    init(source: String = "profile", onSubscriptionComplete: (() -> Void)? = nil) {
        self.paywallSource = source
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

                    // Promo Code Section
                    promoCodeSection

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
            // Track paywall dismissed with time spent
            let timeSpent = Int(Date().timeIntervalSince(paywallOpenTime))
            AnalyticsService.shared.trackPaywallDismissed(
                source: paywallSource,
                timeSpentSeconds: timeSpent,
                selectedPlan: selectedProduct?.id
            )
            PaywallCoordinator.shared.trackDismiss()
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
        }
        .onAppear {
            paywallOpenTime = Date()
            AnalyticsService.shared.trackPaywallViewed(source: paywallSource)
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

    /// Discounted price display - not applicable on iOS (App Store prices are fixed)
    /// Promo codes on iOS extend trial period instead of providing discounts
    private func discountedPriceText(for product: Product) -> String? {
        // iOS uses fixed App Store prices - discounts only work on web
        // Promo codes extend trial period from 7 to 14 days instead
        return nil
    }

    private var subscriptionOptionsSection: some View {
        VStack(spacing: 12) {
            // Show trial extension banner when promo code applied
            if let validation = promoValidation, validation.hasTrialExtension {
                HStack {
                    Image(systemName: "gift.fill")
                        .foregroundColor(.accentGreen)
                    Text(validation.promoDescription)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.accentGreen)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.accentGreen.opacity(0.15))
                .cornerRadius(8)
            }

            if storeManager.products.isEmpty {
                // Loading state
                ProgressView()
                    .tint(.purple80)
                    .padding()
            } else {
                // Yearly Option (Best Value) - Show weekly price prominently
                if let yearly = storeManager.getYearlyProduct() {
                    SubscriptionOptionCard(
                        product: yearly,
                        isSelected: selectedProduct?.id == yearly.id,
                        isBestValue: true,
                        savingsText: storeManager.savingsPercentage().map { "Save \($0)%" },
                        monthlyEquivalent: storeManager.monthlyEquivalentPrice(for: yearly),
                        weeklyEquivalent: storeManager.weeklyEquivalentPrice(for: yearly),
                        discountedPrice: discountedPriceText(for: yearly)
                    ) {
                        selectedProduct = yearly
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "yearly",
                            price: yearly.displayPrice,
                            source: paywallSource
                        )
                    }
                }

                // Monthly Option
                if let monthly = storeManager.getMonthlyProduct() {
                    SubscriptionOptionCard(
                        product: monthly,
                        isSelected: selectedProduct?.id == monthly.id,
                        isBestValue: false,
                        savingsText: nil,
                        monthlyEquivalent: nil,
                        weeklyEquivalent: nil,
                        discountedPrice: discountedPriceText(for: monthly)
                    ) {
                        selectedProduct = monthly
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "monthly",
                            price: monthly.displayPrice,
                            source: paywallSource
                        )
                    }
                }

                // Lifetime Option (if available) - Decoy pricing strategy
                if let lifetime = storeManager.getLifetimeProduct() {
                    SubscriptionOptionCard(
                        product: lifetime,
                        isSelected: selectedProduct?.id == lifetime.id,
                        isBestValue: false,
                        savingsText: "One-time",
                        monthlyEquivalent: nil,
                        weeklyEquivalent: nil,
                        discountedPrice: nil,
                        isLifetime: true
                    ) {
                        selectedProduct = lifetime
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "lifetime",
                            price: lifetime.displayPrice,
                            source: paywallSource
                        )
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }
    
    // MARK: - Promo Code Section

    private var promoCodeSection: some View {
        VStack(spacing: 12) {
            // Toggle button to show/hide promo code input
            if !showPromoCode {
                Button(action: {
                    withAnimation { showPromoCode = true }
                    AnalyticsService.shared.trackPromoCodeExpanded(source: paywallSource)
                }) {
                    HStack {
                        Image(systemName: "tag")
                            .font(.system(size: 14))
                        Text("Have a promo code?")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(.purple80)
                }
                .padding(.bottom, 8)
            } else {
                VStack(spacing: 12) {
                    // Input field
                    HStack {
                        ZStack(alignment: .leading) {
                            // Placeholder text
                            if promoCode.isEmpty {
                                Text("Enter promo code")
                                    .font(.system(size: 16))
                                    .foregroundColor(.textTertiary)
                                    .padding(.horizontal, 16)
                            }

                            TextField("", text: $promoCode)
                                .textFieldStyle(PlainTextFieldStyle())
                                .font(.system(size: 16))
                                .foregroundColor(.textPrimary)
                                .autocapitalization(.allCharacters)
                                .disableAutocorrection(true)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(promoError != nil ? Color.red : (promoValidation != nil ? Color.accentGreen : Color.borderColor), lineWidth: 1)
                        )

                        Button(action: validatePromoCode) {
                            if isValidatingPromo {
                                ProgressView()
                                    .tint(.white)
                                    .frame(width: 44, height: 44)
                            } else {
                                Text("Apply")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(width: 70, height: 44)
                            }
                        }
                        .background(promoCode.isEmpty ? Color.gray : Color.purple80)
                        .cornerRadius(12)
                        .disabled(promoCode.isEmpty || isValidatingPromo)
                    }

                    // Validation result
                    if let validation = promoValidation {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.accentGreen)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Code applied!")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.accentGreen)
                                if validation.hasTrialExtension {
                                    Text(validation.promoDescription)
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                }
                                Text("Referred by \(validation.creatorName)")
                                    .font(.system(size: 12))
                                    .foregroundColor(.textTertiary)
                            }
                            Spacer()
                            Button(action: clearPromoCode) {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.textTertiary)
                            }
                        }
                        .padding(12)
                        .background(Color.accentGreen.opacity(0.1))
                        .cornerRadius(12)
                    }

                    // Error message
                    if let error = promoError {
                        HStack {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.red)
                            Spacer()
                        }
                    }

                    // Hide button
                    Button(action: { withAnimation { showPromoCode = false } }) {
                        Text("Hide")
                            .font(.system(size: 13))
                            .foregroundColor(.textTertiary)
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
    }

    // MARK: - Subscribe Button

    private var subscribeButton: some View {
        VStack(spacing: 12) {
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

            // Web discount option
            webDiscountButton
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 16)
    }

    // MARK: - Web Discount Button

    private var webDiscountButton: some View {
        Link(destination: URL(string: "https://scribeai.online/subscription")!) {
            HStack {
                Image(systemName: "globe")
                    .font(.system(size: 16))
                    .foregroundColor(.accentGreen)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Subscribe on Web")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.textPrimary)

                    HStack(spacing: 4) {
                        Text("$69.99")
                            .font(.system(size: 12))
                            .foregroundColor(.textTertiary)
                            .strikethrough()

                        Text("$48.99/yr")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.accentGreen)
                    }
                }

                Spacer()

                Text("30% OFF")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.accentGreen)
                    .cornerRadius(6)

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12))
                    .foregroundColor(.accentGreen)
            }
            .padding(12)
            .background(Color.accentGreen.opacity(0.1))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.accentGreen.opacity(0.3), lineWidth: 1)
            )
        }
        .simultaneousGesture(TapGesture().onEnded {
            AnalyticsService.shared.trackWebDiscountClicked(
                source: paywallSource,
                currentSelectedPlan: selectedProduct?.id
            )
        })
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
            Button(action: {
                AnalyticsService.shared.trackRestorePurchasesTapped(source: paywallSource)
                restorePurchases()
            }) {
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

                if let privacyURL = URL(string: "https://scribeai.online/privacy") {
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

                TikTokHelper.shared.trackEvent("purchase_success", properties: ["product_id": product.id])
                FacebookSDKHelper.shared.logSubscriptionStarted(productId: product.id, price: NSDecimalNumber(decimal: product.price).doubleValue, currency: product.priceFormatStyle.currencyCode ?? "USD")
                PaywallManager.shared.trackEvent(appId: "scribeai", placement: "paywall", templateId: "default", event: "purchased", productId: product.id)

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

    private func validatePromoCode() {
        guard !promoCode.isEmpty else { return }

        isValidatingPromo = true
        promoError = nil

        Task {
            do {
                let result = try await APIService.shared.validatePromoCode(promoCode.uppercased())

                await MainActor.run {
                    isValidatingPromo = false
                    if result.valid {
                        promoValidation = result
                        promoError = nil
                        // Apply the code
                        applyPromoCode()
                    } else {
                        promoError = "Invalid or expired promo code"
                    }
                }
            } catch {
                await MainActor.run {
                    isValidatingPromo = false
                    promoError = error.localizedDescription
                }
            }
        }
    }

    private func applyPromoCode() {
        guard let validation = promoValidation else { return }

        Task {
            do {
                try await APIService.shared.applyPromoCode(validation.code, platform: "ios")
                AnalyticsService.shared.trackPromoCodeApplied(code: validation.code)
            } catch {
                print("Failed to apply promo code: \(error)")
            }
        }
    }

    private func clearPromoCode() {
        promoCode = ""
        promoValidation = nil
        promoError = nil
    }
}

// MARK: - Promo Validation Result

struct PromoValidationResult {
    let valid: Bool
    let code: String
    let trialExtensionDays: Int
    let creatorName: String

    var promoDescription: String {
        // Promo codes extend trial period (discounts not supported on iOS/Android)
        if trialExtensionDays > 0 {
            return "Trial extended by \(trialExtensionDays) days!"
        }
        return "Code applied!"
    }

    var hasTrialExtension: Bool {
        return trialExtensionDays > 0
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
    let weeklyEquivalent: String?
    let discountedPrice: String?  // Shows discounted price when promo applied
    var isLifetime: Bool = false  // For one-time purchase option
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 0) {
                // Best Value Badge at top (or Lifetime badge)
                if isBestValue {
                    HStack {
                        Text("BEST VALUE")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Color.accentGreen)
                } else if isLifetime {
                    HStack {
                        Image(systemName: "infinity")
                            .font(.system(size: 10, weight: .bold))
                        Text("FOREVER")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .background(Color.purple80)
                }

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
                        Text(product.displayName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        // Show weekly price prominently for yearly plans
                        if let weeklyEquivalent = weeklyEquivalent {
                            Text("Just \(weeklyEquivalent)/week")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.purple80)
                        } else if let monthlyEquivalent = monthlyEquivalent {
                            Text("\(monthlyEquivalent)/month")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                        }
                    }

                    Spacer()

                    VStack(alignment: .trailing, spacing: 4) {
                        // Show discounted price if available
                        if let discounted = discountedPrice {
                            HStack(spacing: 6) {
                                Text(product.displayPrice)
                                    .font(.system(size: 14))
                                    .foregroundColor(.textTertiary)
                                    .strikethrough()
                                Text(discounted)
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(.accentGreen)
                            }
                        } else {
                            Text(product.displayPrice)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.textSecondary)
                        }

                        if isLifetime {
                            Text("one-time")
                                .font(.system(size: 12))
                                .foregroundColor(.textTertiary)
                        } else {
                            Text("/\(product.periodDescription)")
                                .font(.system(size: 12))
                                .foregroundColor(.textTertiary)
                        }

                        if let savingsText = savingsText {
                            Text(savingsText)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(isLifetime ? .purple80 : .accentGreen)
                        }
                    }
                }
                .padding(16)
            }
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.cardBackground)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
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
