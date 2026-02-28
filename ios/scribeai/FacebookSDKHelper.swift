//
//  FacebookSDKHelper.swift
//  scribeai
//
//  Facebook SDK integration for Meta Ads attribution and CAPI.
//

import Foundation
import UIKit
import FacebookCore
import AppTrackingTransparency

/// Facebook SDK wrapper for install attribution and event tracking.
final class FacebookSDKHelper {
    static let shared = FacebookSDKHelper()

    private var isInitialized = false

    private init() {}

    /// Initialize Facebook SDK. Call once at app launch.
    func initialize() {
        Settings.shared.isAutoLogAppEventsEnabled = true
        Settings.shared.isAdvertiserIDCollectionEnabled = true
        ApplicationDelegate.shared.initializeSDK()
        isInitialized = true
        print("[Facebook] SDK initialized")
    }

    /// Handle URL for Facebook SDK (for deferred deep linking).
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegate.shared.application(app, open: url, options: options)
    }

    /// Request App Tracking Transparency permission for IDFA access.
    func requestTrackingPermission() {
        if #available(iOS 14, *) {
            ATTrackingManager.requestTrackingAuthorization { status in
                switch status {
                case .authorized:
                    print("[Facebook] ATT authorized — IDFA available")
                    Settings.shared.isAdvertiserTrackingEnabled = true
                case .denied:
                    print("[Facebook] ATT denied — limited attribution")
                    Settings.shared.isAdvertiserTrackingEnabled = false
                case .notDetermined:
                    print("[Facebook] ATT not determined")
                case .restricted:
                    print("[Facebook] ATT restricted")
                @unknown default:
                    break
                }
            }
        }
    }

    // MARK: - Standard Events

    /// Log app launch event.
    func logAppLaunch() {
        guard isInitialized else { return }
        AppEvents.shared.logEvent(.init("app_launch"))
    }

    /// Log purchase event for CAPI.
    func logPurchase(amount: Double, currency: String, parameters: [AppEvents.ParameterName: Any]? = nil) {
        guard isInitialized else { return }
        AppEvents.shared.logPurchase(amount: amount, currency: currency, parameters: parameters)
    }

    /// Log subscription started.
    func logSubscriptionStarted(productId: String, price: Double, currency: String) {
        guard isInitialized else { return }
        AppEvents.shared.logEvent(.subscribe, parameters: [
            .contentID: productId,
            .currency: currency,
            .init("value"): price
        ])
    }

    /// Log trial started.
    func logTrialStarted(productId: String) {
        guard isInitialized else { return }
        AppEvents.shared.logEvent(.startTrial, parameters: [
            .contentID: productId
        ])
    }

    /// Log sign up completed.
    func logSignUp(method: String) {
        guard isInitialized else { return }
        AppEvents.shared.logEvent(.completedRegistration, parameters: [
            .registrationMethod: method
        ])
    }

    /// Log custom event.
    func logEvent(_ eventName: String, parameters: [String: Any]? = nil) {
        guard isInitialized else { return }
        if let params = parameters {
            let fbParams = params.reduce(into: [AppEvents.ParameterName: Any]()) { result, pair in
                result[AppEvents.ParameterName(pair.key)] = pair.value
            }
            AppEvents.shared.logEvent(AppEvents.Name(eventName), parameters: fbParams)
        } else {
            AppEvents.shared.logEvent(AppEvents.Name(eventName))
        }
    }

    /// Set user ID for attribution.
    func setUserId(_ userId: String?) {
        guard isInitialized else { return }
        if let userId = userId {
            AppEvents.shared.userID = userId
        } else {
            AppEvents.shared.userID = nil
        }
    }
}
