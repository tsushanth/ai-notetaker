//
//  FirebaseAnalyticsHelper.swift
//  scribeai
//
//  Firebase Analytics wrapper for tracking DAU/MAU, uninstalls, and key events.
//  Firebase Analytics is free and unlimited.
//
//  Key benefits:
//  - Automatic DAU/MAU tracking
//  - Built-in funnel analysis in Firebase Console
//  - Crashlytics integration
//  - User segmentation
//

import Foundation
import FirebaseCore
import FirebaseAnalytics

class FirebaseAnalyticsHelper {
    static let shared = FirebaseAnalyticsHelper()

    private var isInitialized = false

    private init() {}

    // MARK: - Initialization

    /// Initialize Firebase Analytics. Call once in App init or AppDelegate.
    func initialize() {
        FirebaseApp.configure()
        isInitialized = true
        print("🔥 Firebase Analytics initialized")
    }

    // MARK: - User Properties

    /// Set user ID for cross-device tracking
    func setUserId(_ userId: String?) {
        guard isInitialized else { return }
        Analytics.setUserID(userId)
    }

    /// Set user properties for segmentation
    func setUserProperty(name: String, value: String?) {
        guard isInitialized else { return }
        Analytics.setUserProperty(value, forName: name)
    }

    // MARK: - Standard Events

    /// Log app open - helps with DAU calculation
    func logAppOpen() {
        logEvent(AnalyticsEventAppOpen)
    }

    /// Log screen view
    func logScreenView(screenName: String, screenClass: String? = nil) {
        var params: [String: Any] = [AnalyticsParameterScreenName: screenName]
        if let screenClass = screenClass {
            params[AnalyticsParameterScreenClass] = screenClass
        }
        logEvent(AnalyticsEventScreenView, parameters: params)
    }

    /// Log sign up
    func logSignUp(method: String) {
        logEvent(AnalyticsEventSignUp, parameters: [AnalyticsParameterMethod: method])
    }

    /// Log login
    func logLogin(method: String) {
        logEvent(AnalyticsEventLogin, parameters: [AnalyticsParameterMethod: method])
    }

    // MARK: - Custom Events

    /// Log note created
    func logNoteCreated(sourceType: String) {
        logEvent("note_created", parameters: ["source_type": sourceType])
    }

    /// Log AI content generated
    func logContentGenerated(contentType: String, noteId: String? = nil) {
        var params: [String: Any] = ["content_type": contentType]
        if let noteId = noteId {
            params["note_id"] = noteId
        }
        logEvent("content_generated", parameters: params)
    }

    /// Log subscription events
    func logSubscriptionStarted(productId: String, isTrial: Bool) {
        logEvent("subscription_started", parameters: [
            "product_id": productId,
            "is_trial": isTrial
        ])
    }

    func logSubscriptionCancelled(productId: String, reason: String? = nil) {
        var params: [String: Any] = ["product_id": productId]
        if let reason = reason {
            params["reason"] = reason
        }
        logEvent("subscription_cancelled", parameters: params)
    }

    // MARK: - Review Events

    /// Log review prompt shown
    func logReviewPromptShown() {
        logEvent("review_prompt_shown")
    }

    /// Log review prompt response
    func logReviewPromptResponse(_ response: String) {
        logEvent("review_prompt_response", parameters: ["response": response])
    }

    // MARK: - Retention Events

    /// Log sign out attempt (before retention screen)
    func logSignOutAttempted() {
        logEvent("signout_attempted")
    }

    /// Log sign out cancelled (user stayed)
    func logSignOutCancelled() {
        logEvent("signout_cancelled")
    }

    /// Log sign out completed
    func logSignOutCompleted() {
        logEvent("signout_completed")
    }

    /// Log delete account attempt
    func logDeleteAccountAttempted() {
        logEvent("delete_account_attempted")
    }

    /// Log delete account cancelled (user stayed)
    func logDeleteAccountCancelled() {
        logEvent("delete_account_cancelled")
    }

    /// Log delete account completed with reason
    func logDeleteAccountCompleted(reason: String, notesCount: Int) {
        logEvent("delete_account_completed", parameters: [
            "reason": reason,
            "notes_count": notesCount
        ])
    }

    // MARK: - Core Logging

    private func logEvent(_ name: String, parameters: [String: Any]? = nil) {
        guard isInitialized else {
            print("⚠️ Firebase Analytics not initialized, skipping event: \(name)")
            return
        }

        Analytics.logEvent(name, parameters: parameters)

        #if DEBUG
        print("🔥 Firebase: \(name)")
        #endif
    }
}
