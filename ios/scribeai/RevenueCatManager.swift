//
//  RevenueCatManager.swift
//  scribeai
//
//  RevenueCat integration for subscription management and experimentation
//

import Foundation
import RevenueCat

// MARK: - RevenueCat Manager

@MainActor
final class RevenueCatManager: ObservableObject {

    // MARK: - Singleton

    static let shared = RevenueCatManager()

    // MARK: - Published Properties

    @Published private(set) var customerInfo: CustomerInfo?
    @Published private(set) var isPremium: Bool = false
    @Published private(set) var packages: [Package] = []
    @Published private(set) var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var showError: Bool = false

    // MARK: - Constants

    /// RevenueCat Apple platform API key
    /// Get this from: RC Dashboard > Project Settings > API Keys > Apple
    private static let apiKey = "appl_NBCWDmwGCyKQuzJQPjqHUlauPHZ"

    /// Entitlement identifier for premium access
    private static let premiumEntitlementID = "premium"

    // MARK: - Initialization

    private init() {}

    // MARK: - Configuration

    /// Configure RevenueCat SDK - call this at app launch
    func configure() async {
        #if DEBUG
        Purchases.logLevel = .debug
        #else
        Purchases.logLevel = .warn
        #endif

        Purchases.configure(withAPIKey: Self.apiKey)

        // Set customer attributes for segmentation
        Purchases.shared.attribution.setAttributes([
            "$appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "app_name": "ScribeAI",
            "platform": "ios"
        ])

        // Listen for customer info updates
        Purchases.shared.delegate = RevenueCatDelegateHandler.shared

        // Fetch initial state
        await refreshCustomerInfo()
        await loadOfferings()

        print("[RevenueCat] Configured successfully")
    }

    // MARK: - Customer Info

    func refreshCustomerInfo() async {
        do {
            let info = try await Purchases.shared.customerInfo()
            self.customerInfo = info
            self.isPremium = info.entitlements[Self.premiumEntitlementID]?.isActive == true
            print("[RevenueCat] Customer info refreshed. Premium: \(isPremium)")
        } catch {
            print("[RevenueCat] Failed to get customer info: \(error)")
        }
    }

    // MARK: - Offerings

    func loadOfferings() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let offerings = try await Purchases.shared.offerings()

            if let current = offerings.current {
                self.packages = current.availablePackages
                print("[RevenueCat] Loaded \(packages.count) packages from '\(current.identifier)' offering")
                for package in packages {
                    print("[RevenueCat] - \(package.identifier): \(package.localizedPriceString)")
                }
            } else {
                print("[RevenueCat] No current offering available")
            }
        } catch {
            print("[RevenueCat] Failed to load offerings: \(error)")
            errorMessage = "Failed to load subscription options"
            showError = true
        }
    }

    // MARK: - Purchases

    func purchase(_ package: Package) async throws {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await Purchases.shared.purchase(package: package)

            if result.userCancelled {
                print("[RevenueCat] User cancelled purchase")
                throw RevenueCatPurchaseError.userCancelled
            }

            self.customerInfo = result.customerInfo
            self.isPremium = result.customerInfo.entitlements[Self.premiumEntitlementID]?.isActive == true

            print("[RevenueCat] Purchase successful: \(package.identifier)")
        } catch let error as RevenueCatPurchaseError {
            throw error
        } catch {
            print("[RevenueCat] Purchase failed: \(error)")
            errorMessage = error.localizedDescription
            showError = true
            throw RevenueCatPurchaseError.purchaseFailed(error.localizedDescription)
        }
    }

    func restorePurchases() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let info = try await Purchases.shared.restorePurchases()
            self.customerInfo = info
            self.isPremium = info.entitlements[Self.premiumEntitlementID]?.isActive == true

            if isPremium {
                print("[RevenueCat] Restored premium subscription")
            } else {
                print("[RevenueCat] No active subscription found")
                errorMessage = "No active subscription found"
                showError = true
            }
        } catch {
            print("[RevenueCat] Restore failed: \(error)")
            errorMessage = "Failed to restore: \(error.localizedDescription)"
            showError = true
        }
    }

    // MARK: - Helper Properties

    var weeklyPackage: Package? {
        packages.first { $0.packageType == .weekly }
    }

    var monthlyPackage: Package? {
        packages.first { $0.packageType == .monthly }
    }

    var threeMonthPackage: Package? {
        packages.first { $0.packageType == .threeMonth }
    }

    var sixMonthPackage: Package? {
        packages.first { $0.packageType == .sixMonth }
    }

    var annualPackage: Package? {
        packages.first { $0.packageType == .annual }
    }

    var lifetimePackage: Package? {
        packages.first { $0.packageType == .lifetime }
    }

    // MARK: - User Identity

    func setUserID(_ userID: String) async {
        do {
            let (info, _) = try await Purchases.shared.logIn(userID)
            self.customerInfo = info
            self.isPremium = info.entitlements[Self.premiumEntitlementID]?.isActive == true
            print("[RevenueCat] User ID set: \(userID)")
        } catch {
            print("[RevenueCat] Failed to set user ID: \(error)")
        }
    }

    func clearUserID() async {
        do {
            let info = try await Purchases.shared.logOut()
            self.customerInfo = info
            self.isPremium = info.entitlements[Self.premiumEntitlementID]?.isActive == true
            print("[RevenueCat] User logged out")
        } catch {
            print("[RevenueCat] Failed to log out: \(error)")
        }
    }

    /// Update state from delegate callback
    func updateFromDelegate(customerInfo: CustomerInfo) {
        self.customerInfo = customerInfo
        let isPremium = customerInfo.entitlements[Self.premiumEntitlementID]?.isActive == true
        self.isPremium = isPremium
        print("[RevenueCat] Customer info updated via delegate. Premium: \(isPremium)")
    }
}

// MARK: - Purchase Error

enum RevenueCatPurchaseError: LocalizedError {
    case userCancelled
    case purchaseFailed(String)
    case productNotFound

    var errorDescription: String? {
        switch self {
        case .userCancelled:
            return "Purchase was cancelled"
        case .purchaseFailed(let message):
            return "Purchase failed: \(message)"
        case .productNotFound:
            return "Product not found"
        }
    }
}

// MARK: - Purchases Delegate

private class RevenueCatDelegateHandler: NSObject, PurchasesDelegate {
    static let shared = RevenueCatDelegateHandler()

    func purchases(_ purchases: Purchases, receivedUpdated customerInfo: CustomerInfo) {
        Task { @MainActor in
            RevenueCatManager.shared.updateFromDelegate(customerInfo: customerInfo)
        }
    }
}
