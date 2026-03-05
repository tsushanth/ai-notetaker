package com.kreativekoala.scribeai.utils

import android.content.Context
import android.os.Bundle
import android.util.Log
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.analytics.ktx.analytics
import com.google.firebase.ktx.Firebase

/**
 * Firebase Analytics wrapper for tracking DAU/MAU, uninstalls, and key events.
 * Firebase Analytics is free and unlimited.
 *
 * Key benefits:
 * - Automatic DAU/MAU tracking
 * - Uninstall tracking via app_remove event (Android only)
 * - Built-in funnel analysis in Firebase Console
 * - Crashlytics integration
 */
object FirebaseAnalyticsHelper {
    private const val TAG = "FirebaseAnalytics"

    private var firebaseAnalytics: FirebaseAnalytics? = null
    private var isInitialized = false

    /**
     * Initialize Firebase Analytics. Call once in Application or MainActivity.
     */
    fun initialize(context: Context) {
        try {
            firebaseAnalytics = Firebase.analytics
            isInitialized = true
            Log.d(TAG, "Firebase Analytics initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Firebase Analytics: ${e.message}")
        }
    }

    /**
     * Set user ID for cross-device tracking
     */
    fun setUserId(userId: String?) {
        firebaseAnalytics?.setUserId(userId)
    }

    /**
     * Set user properties for segmentation
     */
    fun setUserProperty(name: String, value: String?) {
        firebaseAnalytics?.setUserProperty(name, value)
    }

    // MARK: - Standard Events

    /**
     * Log app open - helps with DAU calculation
     */
    fun logAppOpen() {
        logEvent(FirebaseAnalytics.Event.APP_OPEN)
    }

    /**
     * Log screen view
     */
    fun logScreenView(screenName: String, screenClass: String? = null) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.SCREEN_NAME, screenName)
            screenClass?.let { putString(FirebaseAnalytics.Param.SCREEN_CLASS, it) }
        }
        logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params)
    }

    /**
     * Log sign up
     */
    fun logSignUp(method: String) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        }
        logEvent(FirebaseAnalytics.Event.SIGN_UP, params)
    }

    /**
     * Log login
     */
    fun logLogin(method: String) {
        val params = Bundle().apply {
            putString(FirebaseAnalytics.Param.METHOD, method)
        }
        logEvent(FirebaseAnalytics.Event.LOGIN, params)
    }

    // MARK: - Custom Events

    /**
     * Log note created
     */
    fun logNoteCreated(sourceType: String) {
        val params = Bundle().apply {
            putString("source_type", sourceType)
        }
        logEvent("note_created", params)
    }

    /**
     * Log AI content generated
     */
    fun logContentGenerated(contentType: String, noteId: String? = null) {
        val params = Bundle().apply {
            putString("content_type", contentType)
            noteId?.let { putString("note_id", it) }
        }
        logEvent("content_generated", params)
    }

    fun logPaywallViewed(source: String? = null) {
        val params = Bundle().apply {
            source?.let { putString("source", it) }
        }
        logEvent("paywall_viewed", params)
    }

    fun logPurchaseCompleted(productId: String, revenue: Double? = null) {
        val params = Bundle().apply {
            putString("product_id", productId)
            revenue?.let { putDouble(FirebaseAnalytics.Param.VALUE, it) }
            putString(FirebaseAnalytics.Param.CURRENCY, "USD")
        }
        logEvent(FirebaseAnalytics.Event.PURCHASE, params)
    }

    /**
     * Log subscription events
     */
    fun logSubscriptionStarted(productId: String, isTrial: Boolean) {
        val params = Bundle().apply {
            putString("product_id", productId)
            putBoolean("is_trial", isTrial)
        }
        logEvent("subscription_started", params)
    }

    fun logSubscriptionCancelled(productId: String, reason: String? = null) {
        val params = Bundle().apply {
            putString("product_id", productId)
            reason?.let { putString("reason", it) }
        }
        logEvent("subscription_cancelled", params)
    }

    // MARK: - Review Events

    /**
     * Log review prompt shown
     */
    fun logReviewPromptShown() {
        logEvent("review_prompt_shown")
    }

    /**
     * Log review prompt response
     */
    fun logReviewPromptResponse(response: String) {
        val params = Bundle().apply {
            putString("response", response) // "positive", "negative", "dismissed"
        }
        logEvent("review_prompt_response", params)
    }

    // MARK: - Retention Events

    /**
     * Log sign out attempt (before retention screen)
     */
    fun logSignOutAttempted() {
        logEvent("signout_attempted")
    }

    /**
     * Log sign out cancelled (user stayed)
     */
    fun logSignOutCancelled() {
        logEvent("signout_cancelled")
    }

    /**
     * Log sign out completed
     */
    fun logSignOutCompleted() {
        logEvent("signout_completed")
    }

    /**
     * Log delete account attempt
     */
    fun logDeleteAccountAttempted() {
        logEvent("delete_account_attempted")
    }

    /**
     * Log delete account cancelled (user stayed)
     */
    fun logDeleteAccountCancelled() {
        logEvent("delete_account_cancelled")
    }

    /**
     * Log delete account completed with reason
     */
    fun logDeleteAccountCompleted(reason: String, notesCount: Int) {
        val params = Bundle().apply {
            putString("reason", reason)
            putInt("notes_count", notesCount)
        }
        logEvent("delete_account_completed", params)
    }

    // MARK: - Core Logging

    private fun logEvent(eventName: String, params: Bundle? = null) {
        if (!isInitialized) {
            Log.w(TAG, "Firebase Analytics not initialized, skipping event: $eventName")
            return
        }

        try {
            firebaseAnalytics?.logEvent(eventName, params)
            Log.d(TAG, "Logged event: $eventName")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to log event $eventName: ${e.message}")
        }
    }
}
