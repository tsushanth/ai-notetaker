//
//  SubscriptionProduct.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati on 11/29/25.
//


//
//  StoreKitManager.swift
//  scribeai
//
//  Created by Sushanth Tiruvaipati
//  StoreKit 2 implementation for subscription management
//

import Foundation
import StoreKit

// MARK: - Subscription Product IDs
enum SubscriptionProduct: String, CaseIterable {
    case monthly = "com.kreativekoala.scribeai.monthly"
    case yearly = "com.kreativekoala.scribeai.yearly"
    
    var displayName: String {
        switch self {
        case .monthly: return "Monthly"
        case .yearly: return "Yearly"
        }
    }
    
    var description: String {
        switch self {
        case .monthly: return "Billed monthly"
        case .yearly: return "Billed yearly - Save 75%"
        }
    }
}

// MARK: - Subscription State
enum SubscriptionState: Equatable {
    case unknown
    case notSubscribed
    case subscribed(productId: String, expirationDate: Date?)
    case expired
    
    var isSubscribed: Bool {
        if case .subscribed = self {
            return true
        }
        return false
    }
}

// MARK: - Purchase Error
enum PurchaseError: LocalizedError {
    case productNotFound
    case purchaseFailed
    case purchaseCancelled
    case purchasePending
    case verificationFailed
    case unknown
    
    var errorDescription: String? {
        switch self {
        case .productNotFound:
            return "Subscription product not found"
        case .purchaseFailed:
            return "Purchase failed. Please try again."
        case .purchaseCancelled:
            return "Purchase was cancelled"
        case .purchasePending:
            return "Purchase is pending approval"
        case .verificationFailed:
            return "Could not verify purchase"
        case .unknown:
            return "An unknown error occurred"
        }
    }
}

// MARK: - StoreKit Manager
@MainActor
class StoreKitManager: ObservableObject {
    static let shared = StoreKitManager()
    
    // Published properties
    @Published private(set) var products: [Product] = []
    @Published private(set) var subscriptionState: SubscriptionState = .unknown
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    
    // Transaction listener task
    private var updateListenerTask: Task<Void, Error>?
    
    private init() {
        // Start listening for transactions
        updateListenerTask = listenForTransactions()
        
        // Load products on init
        Task {
            await loadProducts()
            await updateSubscriptionStatus()
        }
    }
    
    deinit {
        updateListenerTask?.cancel()
    }
    
    // MARK: - Load Products

    func loadProducts() async {
        isLoading = true
        defer { isLoading = false }

        do {
            // Add timeout to prevent hanging when StoreKit is unavailable
            try await withTimeout(seconds: 10) {
                await self.fetchProducts()
            }
        } catch {
            print("❌ Failed to load products (timeout or error): \(error)")
            errorMessage = "Failed to load subscription options"
        }
    }

    private func fetchProducts() async {
        do {
            let productIds = SubscriptionProduct.allCases.map { $0.rawValue }
            let storeProducts = try await Product.products(for: productIds)

            // Sort products: monthly first, then yearly
            products = storeProducts.sorted { product1, product2 in
                let order: [String: Int] = [
                    SubscriptionProduct.monthly.rawValue: 0,
                    SubscriptionProduct.yearly.rawValue: 1
                ]
                return (order[product1.id] ?? 99) < (order[product2.id] ?? 99)
            }

            print("✅ Loaded \(products.count) subscription products")
            for product in products {
                print("   - \(product.id): \(product.displayPrice)")
            }

        } catch {
            print("❌ Failed to load products: \(error)")
            errorMessage = "Failed to load subscription options"
        }
    }
    
    // Add these calls to your existing StoreKitManager

    // When trial starts:
    func handleTrialStart(product: Product) {
        let trialDays = product.subscription?.introductoryOffer?.period.value ?? 7
        AnalyticsService.shared.trackTrialStarted(
            productId: product.id,
            trialDuration: trialDays
        )
        StoreReviewHelper.shared.recordSubscriptionEvent()
    }

    // When subscription is billed:
    func handleSuccessfulBilling(product: Product, transaction: Transaction) {
        AnalyticsService.shared.trackSubscriptionBilled(
            productId: product.id,
            price: "0.00",
            currency: product.priceFormatStyle.currencyCode ?? "USD"
        )
    }

    // When subscription renews:
    func handleRenewal(productId: String) {
        AnalyticsService.shared.trackSubscriptionRenewed(productId: productId)
    }

    // When checking transaction status - detect cancellation:
    func checkForCancellation(transaction: Transaction) {
        if transaction.revocationDate != nil {
            if AnalyticsService.shared.daysSinceTrialStart <= 7 {
                AnalyticsService.shared.trackTrialCancelled(reason: "revoked")
            } else {
                AnalyticsService.shared.trackSubscriptionCancelled(reason: "revoked")
            }
        }
    }
    
    // MARK: - Purchase
    
    func purchase(_ product: Product) async throws {
        isLoading = true
        defer { isLoading = false }
        
        print("🛒 Starting purchase for: \(product.id)")
        
        do {
            let result = try await product.purchase()
            
            switch result {
            case .success(let verification):
                // Verify the transaction
                let transaction = try checkVerified(verification)

                print("✅ Purchase successful: \(transaction.productID)")

                // Finish the transaction first
                await transaction.finish()

                // Small delay to ensure transaction is processed
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

                // Update subscription status
                await updateSubscriptionStatus()

                // If status didn't update, set it directly based on the verified transaction
                if !isSubscribed {
                    print("⚠️ Status not updated, setting directly from transaction")
                    if let expirationDate = transaction.expirationDate, expirationDate > Date() {
                        subscriptionState = .subscribed(
                            productId: transaction.productID,
                            expirationDate: expirationDate
                        )
                    }
                }
                
            case .userCancelled:
                print("⚠️ User cancelled purchase")
                throw PurchaseError.purchaseCancelled
                
            case .pending:
                print("⏳ Purchase pending")
                throw PurchaseError.purchasePending
                
            @unknown default:
                throw PurchaseError.unknown
            }
            
        } catch let error as PurchaseError {
            throw error
        } catch {
            print("❌ Purchase error: \(error)")
            throw PurchaseError.purchaseFailed
        }
    }
    
    // MARK: - Restore Purchases
    
    func restorePurchases() async {
        isLoading = true
        defer { isLoading = false }
        
        print("🔄 Restoring purchases...")
        
        do {
            try await AppStore.sync()
            await updateSubscriptionStatus()
            print("✅ Purchases restored")
        } catch {
            print("❌ Failed to restore purchases: \(error)")
            errorMessage = "Failed to restore purchases"
        }
    }
    
    // MARK: - Update Subscription Status

    func updateSubscriptionStatus() async {
        print("🔍 Checking subscription status...")

        // Use a timeout to prevent hanging when StoreKit is unavailable
        do {
            try await withTimeout(seconds: 5) {
                await self.checkEntitlements()
            }
        } catch {
            print("⚠️ Subscription check timed out, defaulting to not subscribed")
            subscriptionState = .notSubscribed
        }
    }

    private func checkEntitlements() async {
        // Check for active subscription
        for await result in Transaction.currentEntitlements {
            do {
                let transaction = try checkVerified(result)

                // Check if it's one of our subscription products
                if SubscriptionProduct.allCases.map({ $0.rawValue }).contains(transaction.productID) {
                    // Check if subscription is still valid
                    if let expirationDate = transaction.expirationDate {
                        if expirationDate > Date() {
                            subscriptionState = .subscribed(
                                productId: transaction.productID,
                                expirationDate: expirationDate
                            )
                            print("✅ Active subscription: \(transaction.productID), expires: \(expirationDate)")
                            return
                        } else {
                            print("⚠️ Subscription expired: \(transaction.productID)")
                        }
                    }
                }
            } catch {
                print("❌ Transaction verification failed: \(error)")
            }
        }

        // No active subscription found
        subscriptionState = .notSubscribed
        print("ℹ️ No active subscription")
    }

    /// Timeout helper for async operations
    private func withTimeout<T>(seconds: Double, operation: @escaping () async -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                await operation()
            }

            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw CancellationError()
            }

            guard let result = try await group.next() else {
                throw CancellationError()
            }

            group.cancelAll()
            return result
        }
    }
    
    // MARK: - Transaction Listener
    
    private func listenForTransactions() -> Task<Void, Error> {
        return Task.detached {
            for await result in Transaction.updates {
                do {
                    let transaction = try await self.checkVerified(result)
                    
                    // Update subscription status on main actor
                    await MainActor.run {
                        Task {
                            await self.updateSubscriptionStatus()
                        }
                    }
                    
                    // Finish the transaction
                    await transaction.finish()
                    
                } catch {
                    print("❌ Transaction update error: \(error)")
                }
            }
        }
    }
    
    // MARK: - Verification
    
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw PurchaseError.verificationFailed
        case .verified(let safe):
            return safe
        }
    }
    
    // MARK: - Helper Methods
    
    func getProduct(for subscriptionProduct: SubscriptionProduct) -> Product? {
        return products.first { $0.id == subscriptionProduct.rawValue }
    }
    
    func getMonthlyProduct() -> Product? {
        return getProduct(for: .monthly)
    }
    
    func getYearlyProduct() -> Product? {
        return getProduct(for: .yearly)
    }
    
    var isSubscribed: Bool {
        return subscriptionState.isSubscribed
    }
    
    var currentSubscriptionProductId: String? {
        if case .subscribed(let productId, _) = subscriptionState {
            return productId
        }
        return nil
    }
    
    var subscriptionExpirationDate: Date? {
        if case .subscribed(_, let date) = subscriptionState {
            return date
        }
        return nil
    }
    
    /// Calculate monthly equivalent price for yearly subscription
    func monthlyEquivalentPrice(for product: Product) -> String? {
        guard product.id == SubscriptionProduct.yearly.rawValue else { return nil }
        let monthlyPrice = product.price / 12
        return monthlyPrice.formatted(.currency(code: product.priceFormatStyle.currencyCode ?? "USD"))
    }
    
    /// Calculate savings percentage for yearly vs monthly
    func savingsPercentage() -> Int? {
        guard let monthly = getMonthlyProduct(),
              let yearly = getYearlyProduct() else { return nil }
        
        let yearlyMonthlyEquivalent = yearly.price / 12
        let savings = (1 - (yearlyMonthlyEquivalent / monthly.price)) * 100
        let savingsDouble = NSDecimalNumber(decimal: savings).doubleValue
        return Int(savingsDouble.rounded())
    }
}

// MARK: - Product Extension for Display
extension Product {
    var periodDescription: String {
        guard let subscription = self.subscription else { return "" }
        
        switch subscription.subscriptionPeriod.unit {
        case .month:
            return subscription.subscriptionPeriod.value == 1 ? "month" : "\(subscription.subscriptionPeriod.value) months"
        case .year:
            return subscription.subscriptionPeriod.value == 1 ? "year" : "\(subscription.subscriptionPeriod.value) years"
        case .week:
            return subscription.subscriptionPeriod.value == 1 ? "week" : "\(subscription.subscriptionPeriod.value) weeks"
        case .day:
            return subscription.subscriptionPeriod.value == 1 ? "day" : "\(subscription.subscriptionPeriod.value) days"
        @unknown default:
            return ""
        }
    }
}
