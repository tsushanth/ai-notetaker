package com.kreativekoala.scribeai.utils

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Smart, user-friendly in-app review prompts using Google Play In-App Review API.
 * Shows a soft prompt first ("Enjoying Scribe AI?"), then triggers the native review flow
 * only when user responds positively.
 */
object InAppReviewHelper {
    private const val TAG = "InAppReviewHelper"
    private const val PREFS_NAME = "review_helper_prefs"

    // Preference keys
    private const val KEY_SUCCESS_ACTIONS = "successful_actions_count"
    private const val KEY_USER_RATED = "user_has_rated"
    private const val KEY_USER_DECLINED = "user_declined_review"
    private const val KEY_LAST_PROMPT_TIME = "last_review_prompt_time"
    private const val KEY_LAST_ERROR_TIME = "last_critical_error_time"

    // State for showing soft prompt
    private val _showSoftPrompt = MutableStateFlow(false)
    val showSoftPrompt: StateFlow<Boolean> = _showSoftPrompt.asStateFlow()

    private var prefs: SharedPreferences? = null

    fun initialize(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        Log.d(TAG, "InAppReviewHelper initialized")
    }

    /**
     * Call when user successfully creates content (note, quiz, flashcard, etc.)
     */
    fun recordSuccessfulAction() {
        val currentCount = prefs?.getInt(KEY_SUCCESS_ACTIONS, 0) ?: 0
        prefs?.edit()?.putInt(KEY_SUCCESS_ACTIONS, currentCount + 1)?.apply()
        Log.d(TAG, "Successful action recorded: ${currentCount + 1}")
    }

    /**
     * Call when a critical error occurs
     */
    fun recordCriticalError() {
        prefs?.edit()?.putLong(KEY_LAST_ERROR_TIME, System.currentTimeMillis())?.apply()
        Log.d(TAG, "Critical error recorded")
    }

    /**
     * Check if we should show the soft prompt and show it if eligible
     */
    fun checkAndShowPromptIfEligible() {
        if (shouldShowPrompt()) {
            _showSoftPrompt.value = true
            FirebaseAnalyticsHelper.logReviewPromptShown()
            Log.d(TAG, "Showing soft review prompt")
        }
    }

    private fun shouldShowPrompt(): Boolean {
        val prefs = prefs ?: return false

        // 1. User already rated - never prompt again
        if (prefs.getBoolean(KEY_USER_RATED, false)) {
            Log.d(TAG, "Skip: User already rated")
            return false
        }

        // 2. User declined before - respect their choice (retry after 30 days)
        if (prefs.getBoolean(KEY_USER_DECLINED, false)) {
            val lastPromptTime = prefs.getLong(KEY_LAST_PROMPT_TIME, 0)
            val daysSince = (System.currentTimeMillis() - lastPromptTime) / (1000 * 60 * 60 * 24)
            if (daysSince < 30) {
                Log.d(TAG, "Skip: User declined $daysSince days ago (need 30)")
                return false
            } else {
                // Reset declined status for retry
                prefs.edit().putBoolean(KEY_USER_DECLINED, false).apply()
                Log.d(TAG, "Retry eligible: 30+ days since decline")
            }
        }

        // 3. At least 1 successful action (show after first success!)
        val successActions = prefs.getInt(KEY_SUCCESS_ACTIONS, 0)
        if (successActions < 1) {
            Log.d(TAG, "Skip: No successful actions yet")
            return false
        }

        // 4. No critical errors in last 2 hours
        val lastErrorTime = prefs.getLong(KEY_LAST_ERROR_TIME, 0)
        val hoursSinceError = (System.currentTimeMillis() - lastErrorTime) / (1000 * 60 * 60)
        if (lastErrorTime > 0 && hoursSinceError < 2) {
            Log.d(TAG, "Skip: Critical error ${hoursSinceError}h ago")
            return false
        }

        // 5. At least 7 days since last prompt (if previously prompted)
        val lastPromptTime = prefs.getLong(KEY_LAST_PROMPT_TIME, 0)
        if (lastPromptTime > 0) {
            val daysSince = (System.currentTimeMillis() - lastPromptTime) / (1000 * 60 * 60 * 24)
            if (daysSince < 7) {
                Log.d(TAG, "Skip: Last prompt was $daysSince days ago (need 7)")
                return false
            }
        }

        Log.d(TAG, "All conditions met for review prompt!")
        return true
    }

    /**
     * User tapped "Yes, I love it!" - launch Google Play review flow
     */
    fun userRespondedPositive(activity: Activity) {
        _showSoftPrompt.value = false
        prefs?.edit()?.putLong(KEY_LAST_PROMPT_TIME, System.currentTimeMillis())?.apply()

        // Track response
        FirebaseAnalyticsHelper.logReviewPromptResponse("positive")

        // Launch the native Google Play review flow
        launchReviewFlow(activity)

        // Assume they'll rate (we can't know for sure)
        prefs?.edit()?.putBoolean(KEY_USER_RATED, true)?.apply()
        Log.d(TAG, "User responded positive, launching review flow")
    }

    /**
     * User tapped "Not yet"
     */
    fun userRespondedNegative() {
        _showSoftPrompt.value = false
        prefs?.edit()
            ?.putBoolean(KEY_USER_DECLINED, true)
            ?.putLong(KEY_LAST_PROMPT_TIME, System.currentTimeMillis())
            ?.apply()
        FirebaseAnalyticsHelper.logReviewPromptResponse("negative")
        Log.d(TAG, "User declined review prompt")
    }

    /**
     * User dismissed without responding
     */
    fun userDismissed() {
        _showSoftPrompt.value = false
        prefs?.edit()?.putLong(KEY_LAST_PROMPT_TIME, System.currentTimeMillis())?.apply()
        FirebaseAnalyticsHelper.logReviewPromptResponse("dismissed")
        Log.d(TAG, "User dismissed review prompt")
    }

    /**
     * Launch the Google Play In-App Review flow
     */
    private fun launchReviewFlow(activity: Activity) {
        val reviewManager = ReviewManagerFactory.create(activity)
        val requestFlow = reviewManager.requestReviewFlow()

        requestFlow.addOnCompleteListener { request ->
            if (request.isSuccessful) {
                val reviewInfo = request.result
                val flow = reviewManager.launchReviewFlow(activity, reviewInfo)
                flow.addOnCompleteListener {
                    Log.d(TAG, "Review flow completed")
                }
            } else {
                Log.e(TAG, "Failed to request review flow: ${request.exception?.message}")
            }
        }
    }

    /**
     * Reset for testing
     */
    fun resetForTesting() {
        prefs?.edit()?.clear()?.apply()
        _showSoftPrompt.value = false
        Log.d(TAG, "InAppReviewHelper reset for testing")
    }

    fun printDebugInfo() {
        val prefs = prefs ?: return
        Log.d(TAG, """
            InAppReviewHelper Debug:
            - Success actions: ${prefs.getInt(KEY_SUCCESS_ACTIONS, 0)}
            - User rated: ${prefs.getBoolean(KEY_USER_RATED, false)}
            - User declined: ${prefs.getBoolean(KEY_USER_DECLINED, false)}
            - Last prompt: ${prefs.getLong(KEY_LAST_PROMPT_TIME, 0)}
        """.trimIndent())
    }
}
