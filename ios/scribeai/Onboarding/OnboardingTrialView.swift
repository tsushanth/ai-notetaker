//
//  OnboardingTrialView.swift
//  scribeai
//
//  Trial offer screen with payment collection
//

import SwiftUI
import StoreKit

struct OnboardingTrialView: View {
    @ObservedObject private var manager = OnboardingManager.shared
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
    @State private var screenOpenTime: Date = Date()

    var body: some View {
        VStack(spacing: 0) {
            // Personalized Header based on user type
            VStack(spacing: 8) {
                Text(personalizedHeadline)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.textPrimary)
                    .multilineTextAlignment(.center)

                Text("free for 7 days.")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.accentGreen)
                    .underline()

                // No charge today emphasis (only for subscriptions with trial)
                if !isLifetimeSelected {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.shield.fill")
                            .foregroundColor(.accentGreen)
                        Text("No charge today")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.accentGreen)
                    }
                    .padding(.top, 4)
                }
            }
            .padding(.top, 32)
            .padding(.horizontal, 24)

            Spacer()

            // Timeline (only show for subscriptions with trial)
            if !isLifetimeSelected {
                VStack(alignment: .leading, spacing: 0) {
                    Text("How your free trial works:")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textSecondary)
                        .padding(.bottom, 24)

                    // Today
                    TimelineItem(
                        icon: "checkmark.square.fill",
                        iconColor: .accentGreen,
                        title: "Today - Free trial starts",
                        subtitle: "Enjoy full access free for 7 days",
                        isLast: false
                    )

                    // Day 5
                    TimelineItem(
                        icon: "bell.badge.fill",
                        iconColor: .blue,
                        title: trialReminderDate,
                        subtitle: "We'll send a reminder - cancel before this if you don't want to continue",
                        isLast: false
                    )

                    // Day 7
                    TimelineItem(
                        icon: "creditcard.fill",
                        iconColor: .purple80,
                        title: trialEndDate,
                        subtitle: "First charge only if you haven't canceled",
                        isLast: true
                    )
                }
                .padding(.horizontal, 24)
            } else {
                // Lifetime benefits
                VStack(alignment: .leading, spacing: 16) {
                    Text("What you get:")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textSecondary)

                    VStack(alignment: .leading, spacing: 12) {
                        LifetimeBenefitRow(icon: "infinity", text: "Unlimited access forever")
                        LifetimeBenefitRow(icon: "dollarsign.circle", text: "No recurring charges")
                        LifetimeBenefitRow(icon: "arrow.up.circle", text: "All future updates included")
                        LifetimeBenefitRow(icon: "star.circle", text: "Premium features unlocked")
                    }
                }
                .padding(.horizontal, 24)
            }

            Spacer()

            // Pricing
            if let product = selectedProduct ?? storeManager.getYearlyProduct() {
                VStack(spacing: 8) {
                    if isLifetimeSelected {
                        Text("One-time payment")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)

                        Text(product.displayPrice)
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.textPrimary)

                        Text("Pay once, use forever")
                            .font(.system(size: 13))
                            .foregroundColor(.accentGreen)
                    } else {
                        Text("7 days free, then \(product.displayPrice)/\(product.periodDescription)")
                            .font(.system(size: 14))
                            .foregroundColor(.textSecondary)

                        if let weeklyPrice = storeManager.weeklyPriceString(for: product) {
                            Text("Only \(weeklyPrice) / week")
                                .font(.system(size: 28, weight: .bold))
                                .foregroundColor(.textPrimary)
                        }
                    }
                }
                .padding(.bottom, 24)
            }

            // Plan selector (compact)
            HStack(spacing: 8) {
                if let yearly = storeManager.getYearlyProduct() {
                    PlanPill(
                        title: "Yearly",
                        price: yearly.displayPrice,
                        weeklyPrice: storeManager.weeklyPriceString(for: yearly),
                        isSelected: selectedProduct?.id == yearly.id || selectedProduct == nil,
                        isBestValue: true
                    ) {
                        selectedProduct = yearly
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "yearly",
                            price: yearly.displayPrice,
                            source: "onboarding_trial"
                        )
                    }
                }

                if let monthly = storeManager.getMonthlyProduct() {
                    PlanPill(
                        title: "Monthly",
                        price: monthly.displayPrice,
                        weeklyPrice: storeManager.weeklyPriceString(for: monthly),
                        isSelected: selectedProduct?.id == monthly.id,
                        isBestValue: false
                    ) {
                        selectedProduct = monthly
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "monthly",
                            price: monthly.displayPrice,
                            source: "onboarding_trial"
                        )
                    }
                }

                if let lifetime = storeManager.getLifetimeProduct() {
                    PlanPill(
                        title: "Lifetime",
                        price: lifetime.displayPrice,
                        weeklyPrice: nil,
                        isSelected: selectedProduct?.id == lifetime.id,
                        isBestValue: false,
                        badge: "FOREVER"
                    ) {
                        selectedProduct = lifetime
                        AnalyticsService.shared.trackPlanSelected(
                            planType: "lifetime",
                            price: lifetime.displayPrice,
                            source: "onboarding_trial"
                        )
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)

            // Promo code section
            promoCodeSection
                .padding(.horizontal, 24)
                .padding(.bottom, 16)

            // Start Trial / Purchase Button
            Button {
                startTrial()
            } label: {
                HStack {
                    if isPurchasing {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text(isLifetimeSelected ? "Get Lifetime Access" : "Start your free 7-day trial")
                            .font(.system(size: 18, weight: .semibold))
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(isLifetimeSelected ? Color.purple80 : Color.accentGreen)
                .foregroundColor(.white)
                .cornerRadius(16)
            }
            .disabled(isPurchasing)
            .padding(.horizontal, 24)

            // Web discount option
            webDiscountSection
                .padding(.horizontal, 24)
                .padding(.top, 12)

            // Reassurance message
            VStack(spacing: 8) {
                if isLifetimeSelected {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.purple80)
                        Text("One-time purchase - no subscription")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.textSecondary)
                    }
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "bell.badge")
                            .font(.system(size: 14))
                            .foregroundColor(.accentGreen)
                        Text("We'll remind you 2 days before your trial ends")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.textSecondary)
                    }

                    HStack(spacing: 6) {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 14))
                            .foregroundColor(.accentGreen)
                        Text("Cancel anytime in App Store settings - no charge")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.textSecondary)
                    }
                }
            }
            .padding(.top, 12)
            .padding(.horizontal, 24)

            // App Store badge
            HStack(spacing: 6) {
                Image(systemName: "applelogo")
                    .font(.system(size: 12))
                Text("Secure payment via App Store")
                    .font(.system(size: 13))
            }
            .foregroundColor(.textTertiary)
            .padding(.top, 12)

            // Terms
            VStack(spacing: 4) {
                HStack(spacing: 8) {
                    if let termsURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/") {
                        Link("Terms of Service", destination: termsURL)
                    }
                    Text("•")
                    if let privacyURL = URL(string: "https://scribeai.online/privacy") {
                        Link("Privacy Policy", destination: privacyURL)
                    }
                }
                .font(.system(size: 12))
                .foregroundColor(.textTertiary)
            }
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            screenOpenTime = Date()
            if selectedProduct == nil {
                selectedProduct = storeManager.getYearlyProduct()
            }
            AnalyticsService.shared.trackPaywallViewed(source: "onboarding")
            // Track trial screen view for funnel metrics
            SubscriptionSyncService.shared.trackMetric(eventType: .trialScreenViewed, source: "onboarding")
        }
    }

    // MARK: - Computed Properties
    private var isLifetimeSelected: Bool {
        guard let selected = selectedProduct else { return false }
        return selected.id == SubscriptionProduct.lifetime.rawValue
    }

    // MARK: - Personalized Content
    private var personalizedHeadline: String {
        guard let userType = manager.selectedUserType else {
            return "Try ScribeAI Pro"
        }

        switch userType {
        case .undergraduateStudent, .graduateStudent:
            return "Ace your exams with AI"
        case .highSchoolStudent:
            return "Study smarter, not harder"
        case .middleSchoolStudent:
            return "Make learning fun with AI"
        case .professional:
            return "Never miss an action item"
        case .educator:
            return "Save hours on lesson prep"
        case .other:
            return "Transform how you learn"
        }
    }

    // MARK: - Date Helpers
    private var trialReminderDate: String {
        let date = Calendar.current.date(byAdding: .day, value: 5, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return "\(formatter.string(from: date)) - Email reminder"
    }

    private var trialEndDate: String {
        let date = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, yyyy"
        return "\(formatter.string(from: date)) - Become a member"
    }

    // MARK: - Actions
    private func startTrial() {
        // If already subscribed, skip directly to next step
        if storeManager.isSubscribed {
            manager.nextStep()
            return
        }

        guard let product = selectedProduct ?? storeManager.getYearlyProduct() else { return }

        isPurchasing = true

        // Track purchase initiated
        SubscriptionSyncService.shared.trackMetric(
            eventType: .purchaseInitiated,
            source: "onboarding",
            metadata: ["productId": product.id]
        )

        Task {
            do {
                try await storeManager.purchase(product)
                await MainActor.run {
                    isPurchasing = false
                    // Track successful purchase/trial start
                    SubscriptionSyncService.shared.trackMetric(
                        eventType: .purchaseCompleted,
                        source: "onboarding",
                        metadata: ["productId": product.id]
                    )
                    SubscriptionSyncService.shared.trackMetric(
                        eventType: .trialStarted,
                        source: "onboarding",
                        metadata: ["productId": product.id]
                    )
                    // Double-check subscription status updated
                    if storeManager.isSubscribed {
                        manager.nextStep()
                    } else {
                        // Force advance anyway since purchase succeeded
                        manager.nextStep()
                    }
                }
            } catch PurchaseError.purchaseCancelled {
                await MainActor.run {
                    isPurchasing = false
                    // Track cancelled purchase
                    SubscriptionSyncService.shared.trackMetric(
                        eventType: .purchaseCancelled,
                        source: "onboarding",
                        metadata: ["productId": product.id]
                    )
                }
            } catch {
                await MainActor.run {
                    isPurchasing = false
                    // Track failed purchase
                    SubscriptionSyncService.shared.trackMetric(
                        eventType: .purchaseFailed,
                        source: "onboarding",
                        metadata: ["productId": product.id, "error": error.localizedDescription]
                    )
                    // Check if already subscribed (e.g., restored or previous purchase)
                    if storeManager.isSubscribed {
                        manager.nextStep()
                    } else {
                        errorMessage = error.localizedDescription
                        showError = true
                    }
                }
            }
        }
    }

    // MARK: - Web Discount Section
    private var webDiscountSection: some View {
        VStack(spacing: 8) {
            // Web subscription link
            Link(destination: URL(string: "https://scribeai.online/subscription")!) {
                HStack {
                    Image(systemName: "globe")
                        .font(.system(size: 14))
                        .foregroundColor(.accentGreen)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Subscribe on Web")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.textPrimary)

                        HStack(spacing: 4) {
                            Text("$69.99")
                                .font(.system(size: 11))
                                .foregroundColor(.textTertiary)
                                .strikethrough()

                            Text("$48.99/yr")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.accentGreen)
                        }
                    }

                    Spacer()

                    Text("30% OFF")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.accentGreen)
                        .cornerRadius(4)

                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10))
                        .foregroundColor(.accentGreen)
                }
                .padding(10)
                .background(Color.accentGreen.opacity(0.1))
                .cornerRadius(10)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.accentGreen.opacity(0.3), lineWidth: 1)
                )
            }
            .simultaneousGesture(TapGesture().onEnded {
                AnalyticsService.shared.trackWebDiscountClicked(
                    source: "onboarding_trial",
                    currentSelectedPlan: selectedProduct?.id
                )
            })

            // Platform availability
            HStack(spacing: 12) {
                HStack(spacing: 4) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 11))
                    Text("Desktop")
                        .font(.system(size: 11))
                }

                HStack(spacing: 4) {
                    Image(systemName: "iphone")
                        .font(.system(size: 11))
                    Text("iPhone")
                        .font(.system(size: 11))
                }

                HStack(spacing: 4) {
                    Image(systemName: "ipad")
                        .font(.system(size: 11))
                    Text("iPad")
                        .font(.system(size: 11))
                }

                HStack(spacing: 4) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 11))
                    Text("Android")
                        .font(.system(size: 11))
                }
            }
            .foregroundColor(.textTertiary)
        }
    }

    // MARK: - Promo Code Section
    private var promoCodeSection: some View {
        VStack(spacing: 8) {
            if !showPromoCode {
                Button(action: {
                    withAnimation { showPromoCode = true }
                    AnalyticsService.shared.trackPromoCodeExpanded(source: "onboarding_trial")
                }) {
                    HStack(spacing: 6) {
                        Image(systemName: "tag.fill")
                            .font(.system(size: 14))
                        Text("Have a promo code?")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(.purple80)
                }
            } else {
                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        ZStack(alignment: .leading) {
                            // Placeholder text with visible color
                            if promoCode.isEmpty {
                                Text("Enter promo code")
                                    .font(.system(size: 16))
                                    .foregroundColor(.textTertiary)
                                    .padding(.horizontal, 12)
                            }

                            TextField("", text: $promoCode)
                                .font(.system(size: 16))
                                .foregroundColor(.textPrimary)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                        }
                        .background(Color.cardBackground)
                        .cornerRadius(8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(promoError != nil ? Color.red : (promoValidation != nil ? Color.accentGreen : Color.borderColor), lineWidth: 1)
                        )

                        Button(action: validatePromoCode) {
                            if isValidatingPromo {
                                ProgressView()
                                    .tint(.white)
                                    .frame(width: 60, height: 36)
                            } else {
                                Text("Apply")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(width: 60, height: 36)
                            }
                        }
                        .background(promoCode.isEmpty ? Color.gray : Color.purple80)
                        .cornerRadius(8)
                        .disabled(promoCode.isEmpty || isValidatingPromo)
                    }

                    // Validation result or error
                    if let validation = promoValidation {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Image(systemName: "gift.fill")
                                    .foregroundColor(.accentGreen)
                                Text(validation.promoDescription)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.accentGreen)
                            }
                            if !validation.creatorName.isEmpty {
                                Text("via \(validation.creatorName)")
                                    .font(.system(size: 12))
                                    .foregroundColor(.textTertiary)
                            }
                        }
                    } else if let error = promoError {
                        HStack(spacing: 6) {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(.red)
                        }
                    }

                    // Hide button
                    Button(action: {
                        withAnimation {
                            showPromoCode = false
                            promoCode = ""
                            promoValidation = nil
                            promoError = nil
                        }
                    }) {
                        Text("Hide")
                            .font(.system(size: 13))
                            .foregroundColor(.textTertiary)
                    }
                }
            }
        }
    }

    // MARK: - Promo Code Validation
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
                        // Apply the promo code
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
        Task {
            do {
                try await APIService.shared.applyPromoCode(promoCode.uppercased(), platform: "ios")
                AnalyticsService.shared.trackPromoCodeApplied(code: promoCode.uppercased())
            } catch {
                // Silently fail - validation succeeded, apply is optional
                print("Failed to apply promo code: \(error)")
            }
        }
    }
}

// MARK: - Timeline Item
struct TimelineItem: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            // Icon and line
            VStack(spacing: 0) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(iconColor)

                if !isLast {
                    Rectangle()
                        .fill(Color.textTertiary.opacity(0.3))
                        .frame(width: 2)
                        .frame(height: 40)
                }
            }

            // Content
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundColor(.textSecondary)
            }
            .padding(.bottom, isLast ? 0 : 16)

            Spacer()
        }
    }
}

// MARK: - Lifetime Benefit Row
struct LifetimeBenefitRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(.purple80)
                .frame(width: 24)

            Text(text)
                .font(.system(size: 15))
                .foregroundColor(.textPrimary)
        }
    }
}

// MARK: - Plan Pill
struct PlanPill: View {
    let title: String
    let price: String
    let weeklyPrice: String?
    let isSelected: Bool
    let isBestValue: Bool
    var badge: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                if isBestValue {
                    Text("BEST VALUE")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentGreen)
                        .cornerRadius(4)
                } else if let badge = badge {
                    Text(badge)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.purple80)
                        .cornerRadius(4)
                }

                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.textPrimary)

                Text(price)
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)

                if let weekly = weeklyPrice {
                    Text("\(weekly)/wk")
                        .font(.system(size: 11))
                        .foregroundColor(.purple80)
                } else if badge != nil {
                    Text("One-time")
                        .font(.system(size: 11))
                        .foregroundColor(.purple80)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.purple80 : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    ZStack {
        Color.darkBackground.ignoresSafeArea()
        OnboardingTrialView()
    }
}
