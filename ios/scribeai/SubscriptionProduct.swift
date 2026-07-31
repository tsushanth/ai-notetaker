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
import RatingKit

// MARK: - Subscription Product IDs
enum SubscriptionProduct: String, CaseIterable {
    case monthly = "com.kreativekoala.scribeai.monthly"
    case yearly = "com.kreativekoala.scribeai.yearly"
    case lifetime = "com.kreativekoala.scribeai.lifetime1"  // Non-consumable, one-time purchase

    var displayName: String {
        switch self {
        case .monthly: return "Monthly"
        case .yearly: return "Yearly"
        case .lifetime: return "Lifetime"
        }
    }

    var description: String {
        switch self {
        case .monthly: return "Billed monthly"
        case .yearly: return "Billed yearly - Save 75%"
        case .lifetime: return "One-time purchase"
        }
    }

    var isSubscription: Bool {
        switch self {
        case .monthly, .yearly: return true
        case .lifetime: return false
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
            print("🔍 Requesting products: \(productIds)")

            let storeProducts = try await Product.products(for: productIds)

            // Log which products were NOT returned
            let returnedIds = Set(storeProducts.map { $0.id })
            let requestedIds = Set(productIds)
            let missingIds = requestedIds.subtracting(returnedIds)
            if !missingIds.isEmpty {
                print("⚠️ Products NOT returned by StoreKit: \(missingIds)")
                print("   - Check App Store Connect: Product ID must match exactly")
                print("   - Non-consumables may need to be in 'Ready to Submit' or approved status")
            }

            // Sort products: monthly first, then yearly, then lifetime
            products = storeProducts.sorted { product1, product2 in
                let order: [String: Int] = [
                    SubscriptionProduct.monthly.rawValue: 0,
                    SubscriptionProduct.yearly.rawValue: 1,
                    SubscriptionProduct.lifetime.rawValue: 2
                ]
                return (order[product1.id] ?? 99) < (order[product2.id] ?? 99)
            }

            print("✅ Loaded \(products.count) subscription products")
            for product in products {
                let productType = product.type == .nonConsumable ? "(non-consumable)" : "(subscription)"
                print("   - \(product.id): \(product.displayPrice) \(productType)")
            }

        } catch {
            print("❌ Failed to load products: \(error)")
            errorMessage = "Failed to load subscription options"
        }
    }
    
    // MARK: - Subscription Lifecycle Tracking

    /// Called when a user starts a trial subscription
    func handleTrialStart(product: Product, transaction: Transaction) {
        let trialDays = product.subscription?.introductoryOffer?.period.value ?? 7

        // Track in analytics
        AnalyticsService.shared.trackTrialStarted(
            productId: product.id,
            trialDuration: trialDays
        )

        // Schedule trial reminder notifications
        NotificationService.shared.scheduleTrialReminders()

        // Sync to server
        SubscriptionSyncService.shared.syncSubscription(
            product: product,
            transaction: transaction,
            isTrial: true
        )

        // Send event to server
        SubscriptionSyncService.shared.sendEvent(
            eventType: .trialStarted,
            productId: product.id,
            transactionId: String(transaction.id),
            originalTransactionId: String(transaction.originalID)
        )

        Task { @MainActor in RatingKit.shared.trackPurchase() }
        print("📊 Trial started: \(product.id)")
    }

    /// Called when a subscription is successfully billed (first payment after trial or direct purchase)
    func handleSuccessfulBilling(product: Product, transaction: Transaction) {
        let price = NSDecimalNumber(decimal: product.price).doubleValue
        let currency = product.priceFormatStyle.currencyCode ?? "USD"

        // Cancel trial reminder notifications (user converted)
        NotificationService.shared.cancelTrialReminders()

        // Track in analytics
        AnalyticsService.shared.trackSubscriptionBilled(
            productId: product.id,
            price: String(format: "%.2f", price),
            currency: currency
        )

        // Sync to server
        SubscriptionSyncService.shared.syncSubscription(
            product: product,
            transaction: transaction,
            isTrial: false
        )

        // Send event to server
        SubscriptionSyncService.shared.sendEvent(
            eventType: .subscriptionStarted,
            productId: product.id,
            transactionId: String(transaction.id),
            originalTransactionId: String(transaction.originalID),
            priceAmount: price,
            priceCurrency: currency
        )

        Task { @MainActor in RatingKit.shared.trackPurchase() }
        print("📊 Subscription billed: \(product.id) - \(currency) \(price)")
    }

    /// Called when subscription renews
    func handleRenewal(productId: String, transaction: Transaction) {
        // Track in analytics
        AnalyticsService.shared.trackSubscriptionRenewed(productId: productId)

        // Send event to server
        SubscriptionSyncService.shared.sendEvent(
            eventType: .subscriptionRenewed,
            productId: productId,
            transactionId: String(transaction.id),
            originalTransactionId: String(transaction.originalID)
        )

        print("📊 Subscription renewed: \(productId)")
    }

    /// Called when checking transaction status - detects cancellation/revocation
    func checkForCancellation(transaction: Transaction) {
        if transaction.revocationDate != nil {
            let isInTrial = AnalyticsService.shared.daysSinceTrialStart <= 7

            if isInTrial {
                AnalyticsService.shared.trackTrialCancelled(reason: "revoked")
                SubscriptionSyncService.shared.sendEvent(
                    eventType: .trialCancelled,
                    productId: transaction.productID,
                    transactionId: String(transaction.id),
                    originalTransactionId: String(transaction.originalID),
                    reason: "revoked"
                )
            } else {
                AnalyticsService.shared.trackSubscriptionCancelled(reason: "revoked")
                SubscriptionSyncService.shared.sendEvent(
                    eventType: .subscriptionCancelled,
                    productId: transaction.productID,
                    transactionId: String(transaction.id),
                    originalTransactionId: String(transaction.originalID),
                    reason: "revoked"
                )
            }

            print("📊 Subscription cancelled/revoked: \(transaction.productID)")
        }
    }

    /// Called when subscription expires
    func handleExpiration(transaction: Transaction) {
        let isInTrial = AnalyticsService.shared.daysSinceTrialStart <= 7

        if isInTrial {
            AnalyticsService.shared.track(.subscriptionExpired, properties: [
                "product_id": transaction.productID,
                "was_trial": true
            ])
            SubscriptionSyncService.shared.sendEvent(
                eventType: .trialExpired,
                productId: transaction.productID,
                originalTransactionId: String(transaction.originalID)
            )
        } else {
            AnalyticsService.shared.track(.subscriptionExpired, properties: [
                "product_id": transaction.productID,
                "was_trial": false
            ])
            SubscriptionSyncService.shared.sendEvent(
                eventType: .subscriptionExpired,
                productId: transaction.productID,
                originalTransactionId: String(transaction.originalID)
            )
        }

        print("📊 Subscription expired: \(transaction.productID)")
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

                // Track subscription lifecycle events
                let isNewPurchase = transaction.originalID == transaction.id

                // Check if user is actually in a trial by examining the transaction's offer type
                // This is more reliable than checking if product has trial offer configured
                let isInTrial: Bool
                if #available(iOS 17.0, *) {
                    // iOS 17+ has offerType property
                    isInTrial = transaction.offerType == .introductory
                } else {
                    // Fallback: check if product has intro offer and this is a new purchase
                    // Note: This isn't 100% accurate as user may have used trial before
                    isInTrial = product.subscription?.introductoryOffer != nil && isNewPurchase
                }

                if isNewPurchase {
                    if isInTrial {
                        // User started a trial
                        handleTrialStart(product: product, transaction: transaction)
                    } else {
                        // Direct purchase without trial (or trial not eligible)
                        handleSuccessfulBilling(product: product, transaction: transaction)
                    }
                } else {
                    // This is a renewal or restored purchase
                    handleRenewal(productId: product.id, transaction: transaction)
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

                            // Reconcile with server to catch missed webhook events
                            await reconcileWithServer(transaction: transaction)
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

    /// Reconcile subscription status with server to recover from missed webhooks
    private func reconcileWithServer(transaction: Transaction) async {
        // Determine offer type
        var offerType: String? = nil
        if #available(iOS 17.0, *) {
            switch transaction.offerType {
            case .introductory:
                offerType = "introductory"
            case .promotional:
                offerType = "promotional"
            case .code:
                offerType = "code"
            default:
                offerType = nil
            }
        }

        // Get product for price info
        let product = products.first { $0.id == transaction.productID }
        let price = product != nil ? NSDecimalNumber(decimal: product!.price).doubleValue : nil
        let currency = product?.priceFormatStyle.currencyCode

        // Determine auto-renew status (not directly available, assume true if not revoked)
        let autoRenewEnabled = transaction.revocationDate == nil

        _ = await SubscriptionSyncService.shared.reconcileSubscription(
            productId: transaction.productID,
            originalTransactionId: String(transaction.originalID),
            transactionId: String(transaction.id),
            expirationDate: transaction.expirationDate,
            purchaseDate: transaction.purchaseDate,
            isSubscribed: true,
            offerType: offerType,
            autoRenewEnabled: autoRenewEnabled,
            priceAmount: price,
            priceCurrency: currency
        )
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

                    // Check for cancellation/revocation
                    await MainActor.run {
                        self.checkForCancellation(transaction: transaction)
                    }

                    // Check for expiration
                    if let expirationDate = transaction.expirationDate, expirationDate <= Date() {
                        await MainActor.run {
                            self.handleExpiration(transaction: transaction)
                        }
                    }

                    // Check if this is a renewal (not a new purchase)
                    let isRenewal = transaction.originalID != transaction.id
                    if isRenewal, transaction.revocationDate == nil {
                        if let expirationDate = transaction.expirationDate, expirationDate > Date() {
                            await MainActor.run {
                                self.handleRenewal(productId: transaction.productID, transaction: transaction)
                            }
                        }
                    }

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

    func getLifetimeProduct() -> Product? {
        return getProduct(for: .lifetime)
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

    /// Calculate weekly equivalent price for yearly subscription
    func weeklyEquivalentPrice(for product: Product) -> String? {
        guard product.id == SubscriptionProduct.yearly.rawValue else { return nil }
        let weeklyPrice = product.price / 52
        return weeklyPrice.formatted(.currency(code: product.priceFormatStyle.currencyCode ?? "USD"))
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
