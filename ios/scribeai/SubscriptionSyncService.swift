//
//  SubscriptionSyncService.swift
//  scribeai
//
//  Syncs subscription state between client and server
//

import Foundation
import StoreKit
import UIKit

class SubscriptionSyncService {
    static let shared = SubscriptionSyncService()

    private let syncQueue = DispatchQueue(label: "com.scribeai.subscriptionsync", qos: .utility)

    /// Device ID for tracking trials across accounts (prevents reinstall abuse)
    var deviceId: String {
        return UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
    }

    private init() {}

    // MARK: - Sync Subscription to Server

    /// Sync current subscription state to the server after a purchase or status change
    func syncSubscription(
        product: Product,
        transaction: Transaction,
        isTrial: Bool = false
    ) {
        syncQueue.async { [weak self] in
            self?.performSync(product: product, transaction: transaction, isTrial: isTrial)
        }
    }

    private func performSync(product: Product, transaction: Transaction, isTrial: Bool) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)\(Constants.API.subscriptionSync)") else {
            print("❌ SubscriptionSync: No auth token or invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let syncData: [String: Any] = [
            "productId": product.id,
            "platform": "ios",
            "status": "active",
            "originalTransactionId": String(transaction.originalID),
            "transactionId": String(transaction.id),
            "expirationDate": transaction.expirationDate?.ISO8601Format() ?? "",
            "purchaseDate": transaction.purchaseDate.ISO8601Format(),
            "isTrial": isTrial,
            "trialEndDate": isTrial ? (transaction.expirationDate?.ISO8601Format() ?? "") : "",
            "autoRenewEnabled": true,
            "priceAmount": NSDecimalNumber(decimal: product.price).doubleValue,
            "priceCurrency": product.priceFormatStyle.currencyCode ?? "USD",
            "deviceId": deviceId
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: syncData)
        } catch {
            print("❌ SubscriptionSync: Failed to serialize data - \(error)")
            return
        }

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ SubscriptionSync: Network error - \(error.localizedDescription)")
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else { return }

            if httpResponse.statusCode == 200 {
                print("✅ SubscriptionSync: Successfully synced to server")
            } else {
                print("❌ SubscriptionSync: Server returned \(httpResponse.statusCode)")
            }
        }
        task.resume()
    }

    // MARK: - Send Subscription Event

    /// Send a subscription event to the server for tracking
    func sendEvent(
        eventType: SubscriptionEventType,
        productId: String? = nil,
        transactionId: String? = nil,
        originalTransactionId: String? = nil,
        priceAmount: Double? = nil,
        priceCurrency: String? = nil,
        reason: String? = nil
    ) {
        syncQueue.async { [weak self] in
            self?.performSendEvent(
                eventType: eventType,
                productId: productId,
                transactionId: transactionId,
                originalTransactionId: originalTransactionId,
                priceAmount: priceAmount,
                priceCurrency: priceCurrency,
                reason: reason
            )
        }
    }

    private func performSendEvent(
        eventType: SubscriptionEventType,
        productId: String?,
        transactionId: String?,
        originalTransactionId: String?,
        priceAmount: Double?,
        priceCurrency: String?,
        reason: String?
    ) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)\(Constants.API.subscriptionEvent)") else {
            print("❌ SubscriptionEvent: No auth token or invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        var eventData: [String: Any] = [
            "eventType": eventType.rawValue,
            "platform": "ios"
        ]

        if let productId = productId { eventData["productId"] = productId }
        if let transactionId = transactionId { eventData["transactionId"] = transactionId }
        if let originalTransactionId = originalTransactionId { eventData["originalTransactionId"] = originalTransactionId }
        if let priceAmount = priceAmount { eventData["priceAmount"] = priceAmount }
        if let priceCurrency = priceCurrency { eventData["priceCurrency"] = priceCurrency }
        if let reason = reason { eventData["reason"] = reason }

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: eventData)
        } catch {
            print("❌ SubscriptionEvent: Failed to serialize data - \(error)")
            return
        }

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ SubscriptionEvent: Network error - \(error.localizedDescription)")
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else { return }

            if httpResponse.statusCode == 200 {
                print("✅ SubscriptionEvent: \(eventType.rawValue) sent to server")
            } else {
                print("❌ SubscriptionEvent: Server returned \(httpResponse.statusCode)")
            }
        }
        task.resume()
    }

    // MARK: - Check Server Subscription Status

    /// Verify subscription status with the server
    func verifyWithServer(completion: @escaping (ServerSubscriptionStatus?) -> Void) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)\(Constants.API.subscriptionStatus)") else {
            completion(nil)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let data = data,
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                completion(nil)
                return
            }

            do {
                let decoder = JSONDecoder()
                decoder.keyDecodingStrategy = .convertFromSnakeCase
                let response = try decoder.decode(ServerSubscriptionResponse.self, from: data)
                completion(response.data)
            } catch {
                print("❌ SubscriptionStatus: Failed to decode response - \(error)")
                completion(nil)
            }
        }
        task.resume()
    }

    // MARK: - Track Subscription Funnel Metrics

    /// Track subscription funnel events for analytics
    func trackMetric(
        eventType: SubscriptionMetricType,
        source: String? = nil,
        metadata: [String: Any]? = nil
    ) {
        syncQueue.async { [weak self] in
            self?.performTrackMetric(eventType: eventType, source: source, metadata: metadata)
        }
    }

    private func performTrackMetric(
        eventType: SubscriptionMetricType,
        source: String?,
        metadata: [String: Any]?
    ) {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)/api/subscriptions/track") else {
            print("❌ SubscriptionMetric: No auth token or invalid URL")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        var metricData: [String: Any] = [
            "eventType": eventType.rawValue,
            "deviceId": deviceId,
            "platform": "ios"
        ]

        if let source = source { metricData["source"] = source }
        if let metadata = metadata { metricData["metadata"] = metadata }

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: metricData)
        } catch {
            print("❌ SubscriptionMetric: Failed to serialize data - \(error)")
            return
        }

        let task = URLSession.shared.dataTask(with: request) { _, response, error in
            if let error = error {
                print("❌ SubscriptionMetric: Network error - \(error.localizedDescription)")
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else { return }

            if httpResponse.statusCode == 200 {
                print("✅ SubscriptionMetric: \(eventType.rawValue) tracked")
            } else {
                print("❌ SubscriptionMetric: Server returned \(httpResponse.statusCode)")
            }
        }
        task.resume()
    }

    // MARK: - Check Trial with Device Tracking

    /// Check trial status with device ID for abuse prevention
    func checkTrialWithDevice() async -> TrialCheckResult? {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)/api/subscriptions/trial/check") else {
            print("❌ TrialCheck: No auth token or invalid URL")
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let body: [String: Any] = ["deviceId": deviceId]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                print("❌ TrialCheck: Server returned non-200")
                return nil
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let trialResponse = try decoder.decode(TrialCheckResponse.self, from: data)
            print("✅ TrialCheck: isInTrial=\(trialResponse.data.isInTrial), daysRemaining=\(trialResponse.data.daysRemaining)")
            return trialResponse.data
        } catch {
            print("❌ TrialCheck: Failed - \(error)")
            return nil
        }
    }

    // MARK: - Get Full Access Status (Server-Authoritative)

    /// Fetch comprehensive access status from server including trial and usage
    func getAccessStatus() async -> ServerAccessStatus? {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)\(Constants.API.subscriptionAccess)") else {
            print("❌ AccessStatus: No auth token or invalid URL")
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                print("❌ AccessStatus: Server returned non-200")
                return nil
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let accessResponse = try decoder.decode(ServerAccessResponse.self, from: data)
            print("✅ AccessStatus: Fetched from server - hasAccess: \(accessResponse.data.hasAccess)")
            return accessResponse.data
        } catch {
            print("❌ AccessStatus: Failed to fetch - \(error)")
            return nil
        }
    }

    // MARK: - Reconcile Subscription Status

    /// Reconcile local subscription status with server
    /// This helps recover from missed webhook events
    func reconcileSubscription(
        productId: String,
        originalTransactionId: String,
        transactionId: String,
        expirationDate: Date?,
        purchaseDate: Date?,
        isSubscribed: Bool,
        offerType: String?, // "introductory", "promotional", "code", or nil
        autoRenewEnabled: Bool,
        priceAmount: Double?,
        priceCurrency: String?
    ) async -> ReconciliationResult? {
        guard let token = KeychainService.shared.get(Constants.Keychain.accessToken),
              let url = URL(string: "\(Constants.baseURL)/api/subscriptions/reconcile") else {
            print("❌ Reconcile: No auth token or invalid URL")
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        var body: [String: Any] = [
            "productId": productId,
            "originalTransactionId": originalTransactionId,
            "transactionId": transactionId,
            "isSubscribed": isSubscribed,
            "autoRenewEnabled": autoRenewEnabled
        ]

        if let expDate = expirationDate {
            body["expirationDate"] = expDate.ISO8601Format()
        }
        if let purchDate = purchaseDate {
            body["purchaseDate"] = purchDate.ISO8601Format()
        }
        if let offer = offerType {
            body["offerType"] = offer
        }
        if let price = priceAmount {
            body["priceAmount"] = price
        }
        if let currency = priceCurrency {
            body["priceCurrency"] = currency
        }

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                print("❌ Reconcile: Server returned non-200")
                return nil
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let result = try decoder.decode(ReconciliationResponse.self, from: data)
            print("✅ Reconcile: status=\(result.data.status), trialConverted=\(result.data.trialConverted)")
            return result.data
        } catch {
            print("❌ Reconcile: Failed - \(error)")
            return nil
        }
    }
}

// MARK: - Reconciliation Models

struct ReconciliationResponse: Codable {
    let success: Bool
    let data: ReconciliationResult
}

struct ReconciliationResult: Codable {
    let subscriptionId: String
    let status: String
    let isActive: Bool
    let trialConverted: Bool
}

// MARK: - Event Types

enum SubscriptionEventType: String {
    case trialStarted = "trial_started"
    case trialConverted = "trial_converted"
    case trialCancelled = "trial_cancelled"
    case trialExpired = "trial_expired"
    case subscriptionStarted = "subscription_started"
    case subscriptionRenewed = "subscription_renewed"
    case subscriptionCancelled = "subscription_cancelled"
    case subscriptionExpired = "subscription_expired"
    case subscriptionGracePeriod = "subscription_grace_period"
    case subscriptionReactivated = "subscription_reactivated"
    case refundIssued = "refund_issued"
    case billingIssue = "billing_issue"
}

// MARK: - Response Models

struct ServerSubscriptionResponse: Codable {
    let success: Bool
    let data: ServerSubscriptionStatus
}

struct ServerSubscriptionStatus: Codable {
    let isSubscribed: Bool
    let status: String
    let productId: String?
    let platform: String?
    let expiresAt: String?
    let isTrial: Bool?
    let trialEndsAt: String?
    let autoRenewEnabled: Bool?
}

// MARK: - Access Status Models (Server-Authoritative)

struct ServerAccessResponse: Codable {
    let success: Bool
    let data: ServerAccessStatus
}

struct ServerAccessStatus: Codable {
    // Access status
    let hasAccess: Bool
    let isSubscribed: Bool
    let isInTrial: Bool
    let reason: String

    // Trial info
    let trialDaysRemaining: Int
    let trialExpiresAt: String?
    let trialExpired: Bool

    // Subscription info
    let productId: String?
    let expiresAt: String?

    // Usage info
    let usage: UsageInfo

    // Feature access
    let features: FeatureAccess
}

struct UsageInfo: Codable {
    let current: UsageCounts
    let limits: UsageLimits
    let remaining: UsageCounts
}

struct UsageCounts: Codable {
    let notes: Int
    let aiGenerations: Int
    let podcasts: Int
}

struct UsageLimits: Codable {
    let notesPerMonth: Int
    let aiGenerationsPerMonth: Int
    let podcastsPerMonth: Int
}

struct FeatureAccess: Codable {
    let canCreateNotes: Bool
    let canUseAI: Bool
    let canGeneratePodcasts: Bool
    let unlimitedAccess: Bool
}

// MARK: - Subscription Metric Types

enum SubscriptionMetricType: String {
    case appInstall = "app_install"
    case onboardingStarted = "onboarding_started"
    case onboardingCompleted = "onboarding_completed"
    case paywallViewed = "paywall_viewed"
    case trialScreenViewed = "trial_screen_viewed"
    case trialStarted = "trial_started"
    case trialSkipped = "trial_skipped"
    case purchaseInitiated = "purchase_initiated"
    case purchaseCompleted = "purchase_completed"
    case purchaseFailed = "purchase_failed"
    case purchaseCancelled = "purchase_cancelled"
    case trialReminderSent = "trial_reminder_sent"
    case trialExpired = "trial_expired"
    case subscriptionRenewed = "subscription_renewed"
    case subscriptionCancelled = "subscription_cancelled"
    case churn = "churn"
}

// MARK: - Trial Check Models

struct TrialCheckResponse: Codable {
    let success: Bool
    let data: TrialCheckResult
}

struct TrialCheckResult: Codable {
    let isInTrial: Bool
    let daysRemaining: Int
    let expiresAt: String?
    let trialExpired: Bool
    let deviceTrialUsed: Bool?
}
