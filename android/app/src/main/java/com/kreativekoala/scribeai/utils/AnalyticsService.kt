package com.kreativekoala.scribeai.utils

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import com.kreativekoala.scribeai.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Analytics service for tracking user events and funnel metrics
 * Matches iOS AnalyticsService implementation
 */
object AnalyticsService {

    private const val TAG = "AnalyticsService"
    private const val PREFS_NAME = "analytics_prefs"

    // Preference keys
    private object Keys {
        const val USER_ID = "analytics_user_id"
        const val INSTALL_DATE = "analytics_install_date"
        const val FIRST_VALUE_DATE = "analytics_first_value_date"
        const val TRIAL_START_DATE = "analytics_trial_start_date"
        const val TRIAL_PRODUCT_ID = "analytics_trial_product_id"
        const val SUBSCRIPTION_START_DATE = "analytics_subscription_start_date"
        const val CANCEL_DATE = "analytics_cancel_date"
        const val BILLED_SUCCESSFULLY = "analytics_billed_successfully"
        const val SUCCESS_ACTIONS_COUNT = "analytics_success_actions"
        const val PENDING_EVENTS = "analytics_pending_events"
        const val SESSION_COUNT = "analytics_session_count"
        const val TOTAL_APP_TIME = "analytics_total_app_time"
        const val LAST_SESSION_DATE = "analytics_last_session_date"
    }

    /**
     * Event types matching iOS implementation
     */
    enum class Event(val eventName: String) {
        // App lifecycle
        APP_INSTALL("app_install"),
        APP_LAUNCH("app_launch"),
        SESSION_START("session_start"),
        SESSION_END("session_end"),

        // User journey
        REACHED_VALUE("reached_value"),
        PAYWALL_VIEWED("paywall_viewed"),

        // Subscription events
        TRIAL_STARTED("trial_started"),
        TRIAL_CANCELLED("trial_cancelled"),
        SUBSCRIPTION_BILLED("subscription_billed"),
        SUBSCRIPTION_RENEWED("subscription_renewed"),
        SUBSCRIPTION_CANCELLED("subscription_cancelled"),
        SUBSCRIPTION_EXPIRED("subscription_expired"),

        // Content creation
        NOTE_CREATED("note_created"),
        NOTE_VIEWED("note_viewed"),
        NOTE_DELETED("note_deleted"),
        CONTENT_UPLOADED("content_uploaded"),
        YOUTUBE_PROCESSED("youtube_processed"),
        RECORDING_STARTED("recording_started"),
        RECORDING_PROCESSED("recording_processed"),
        PDF_PROCESSED("pdf_processed"),
        AUDIO_RECORDED("audio_recorded"),
        DOCUMENT_SCANNED("document_scanned"),

        // AI Feature - Quiz
        QUIZ_TAB_VIEWED("quiz_tab_viewed"),
        QUIZ_GENERATE_STARTED("quiz_generate_started"),
        QUIZ_GENERATED("quiz_generated"),
        QUIZ_QUESTION_ANSWERED("quiz_question_answered"),
        QUIZ_COMPLETED("quiz_completed"),
        QUIZ_RESTARTED("quiz_restarted"),

        // AI Feature - Flashcards
        FLASHCARDS_TAB_VIEWED("flashcards_tab_viewed"),
        FLASHCARDS_GENERATE_STARTED("flashcards_generate_started"),
        FLASHCARDS_GENERATED("flashcards_generated"),
        FLASHCARD_FLIPPED("flashcard_flipped"),
        FLASHCARD_SWIPED("flashcard_swiped"),
        FLASHCARDS_COMPLETED("flashcards_completed"),

        // AI Feature - Podcast
        PODCAST_TAB_VIEWED("podcast_tab_viewed"),
        PODCAST_GENERATE_STARTED("podcast_generate_started"),
        PODCAST_GENERATED("podcast_generated"),
        PODCAST_PLAY_STARTED("podcast_play_started"),
        PODCAST_PLAY_PAUSED("podcast_play_paused"),
        PODCAST_PLAY_COMPLETED("podcast_play_completed"),
        PODCAST_SKIPPED("podcast_skipped"),

        // AI Feature - Chat
        CHAT_TAB_VIEWED("chat_tab_viewed"),
        CHAT_MESSAGE_SENT("chat_message_sent"),
        CHAT_USED("chat_used"),
        CHAT_SUGGESTION_USED("chat_suggestion_used"),

        // AI Feature - Summary/Diagram
        SUMMARY_TAB_VIEWED("summary_tab_viewed"),
        SUMMARY_GENERATED("summary_generated"),
        DIAGRAM_GENERATED("diagram_generated"),

        // AI Feature - Mind Map
        MINDMAP_TAB_VIEWED("mindmap_tab_viewed"),
        MINDMAP_GENERATED("mindmap_generated"),

        // Feature discovery
        FEATURE_DISCOVERED("feature_discovered"),
        TAB_SWITCHED("tab_switched"),

        // Errors
        PROCESSING_ERROR("processing_error"),
        PAYMENT_ERROR("payment_error"),
        FEATURE_BLOCKED("feature_blocked"),

        // Onboarding
        ONBOARDING_STARTED("onboarding_started"),
        ONBOARDING_STEP_COMPLETED("onboarding_step_completed"),
        ONBOARDING_COMPLETED("onboarding_completed"),
        ONBOARDING_SKIPPED("onboarding_skipped"),
        TRIAL_SKIPPED("trial_skipped"),

        // Promo codes
        PROMO_CODE_APPLIED("promo_code_applied")
    }

    // Dedicated coroutine scope for background analytics
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Short-timeout client for analytics
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()

    private var prefs: SharedPreferences? = null
    private var authManager: AuthManager? = null
    private var appContext: Context? = null

    // Event buffer for batching
    private val eventBuffer = mutableListOf<JSONObject>()
    private val bufferLimit = 10

    // Session tracking
    private var sessionStartTime: Long? = null

    // Date formatter
    private val isoFormatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    /**
     * Initialize the service with required dependencies
     * Should be called once during app startup
     */
    fun initialize(context: Context, authManager: AuthManager) {
        this.appContext = context.applicationContext
        this.authManager = authManager
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // Generate user ID if not exists
        if (prefs?.getString(Keys.USER_ID, null) == null) {
            prefs?.edit()?.putString(Keys.USER_ID, UUID.randomUUID().toString())?.apply()
        }

        // Record install date if first launch
        if (prefs?.getLong(Keys.INSTALL_DATE, 0) == 0L) {
            prefs?.edit()?.putLong(Keys.INSTALL_DATE, System.currentTimeMillis())?.apply()
            track(Event.APP_INSTALL)
        }

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📊 AnalyticsService initialized")
        }
    }

    // MARK: - Core Tracking (Fire and Forget)

    /**
     * Track event - completely non-blocking
     */
    fun track(event: Event, properties: Map<String, Any>? = null) {
        scope.launch {
            try {
                val eventData = buildEventData(event, properties)
                bufferEvent(eventData)

                if (BuildConfig.DEBUG) {
                    Log.d(TAG, "📊 ${event.eventName}")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to track event: ${e.message}")
            }
        }
    }

    private fun buildEventData(event: Event, properties: Map<String, Any>?): JSONObject {
        return JSONObject().apply {
            put("event", event.eventName)
            put("timestamp", isoFormatter.format(Date()))
            put("user_id", prefs?.getString(Keys.USER_ID, "unknown") ?: "unknown")
            put("app_version", getAppVersion())
            put("days_since_install", daysSinceInstall)
            put("has_reached_value", hasReachedValue)
            put("success_actions_count", successActionsCount)

            if (properties != null) {
                put("properties", JSONObject(properties))
            }
        }
    }

    // MARK: - Event Buffering

    private fun bufferEvent(eventData: JSONObject) {
        synchronized(eventBuffer) {
            eventBuffer.add(eventData)

            if (eventBuffer.size >= bufferLimit) {
                flushBuffer()
            }
        }
    }

    private fun flushBuffer() {
        synchronized(eventBuffer) {
            if (eventBuffer.isEmpty()) return

            val eventsToSend = eventBuffer.toList()
            eventBuffer.clear()

            sendEventsBatch(eventsToSend)
        }
    }

    /**
     * Force flush events (call on app background)
     */
    fun flush() {
        scope.launch {
            flushBuffer()
        }
    }

    // MARK: - Network (Non-blocking with timeout)

    private fun sendEventsBatch(events: List<JSONObject>) {
        scope.launch {
            try {
                val token = authManager?.getFreshToken()
                if (token == null) {
                    // Queue for later
                    persistEvents(events)
                    return@launch
                }

                val url = "${BuildConfig.BASE_URL}/api/analytics/batch"

                val eventsArray = JSONArray().apply {
                    events.forEach { put(it) }
                }

                val body = JSONObject().apply {
                    put("events", eventsArray)
                }

                val request = Request.Builder()
                    .url(url)
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer $token")
                    .addHeader("Content-Type", "application/json")
                    .build()

                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        // Silently queue for retry
                        persistEvents(events)
                    } else if (BuildConfig.DEBUG) {
                        Log.d(TAG, "📊 ${events.size} events sent successfully")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send events: ${e.message}")
                persistEvents(events)
            }
        }
    }

    // MARK: - Persistence (for offline/retry)

    private fun persistEvents(events: List<JSONObject>) {
        try {
            val pending = loadPendingEvents().toMutableList()
            pending.addAll(events)

            // Keep only last 200 events
            val trimmed = if (pending.size > 200) pending.takeLast(200) else pending

            val jsonArray = JSONArray().apply {
                trimmed.forEach { put(it) }
            }

            prefs?.edit()?.putString(Keys.PENDING_EVENTS, jsonArray.toString())?.apply()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to persist events: ${e.message}")
        }
    }

    private fun loadPendingEvents(): List<JSONObject> {
        return try {
            val json = prefs?.getString(Keys.PENDING_EVENTS, null) ?: return emptyList()
            val array = JSONArray(json)
            (0 until array.length()).map { array.getJSONObject(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * Call when user authenticates to flush pending events
     */
    fun flushPendingEvents() {
        scope.launch {
            val pending = loadPendingEvents()
            if (pending.isEmpty()) return@launch

            prefs?.edit()?.remove(Keys.PENDING_EVENTS)?.apply()
            sendEventsBatch(pending)
        }
    }

    // MARK: - Funnel Tracking Methods (All Non-blocking)

    fun trackReachedValue(contentType: String) {
        scope.launch {
            val isFirst = prefs?.getLong(Keys.FIRST_VALUE_DATE, 0) == 0L

            if (isFirst) {
                prefs?.edit()?.putLong(Keys.FIRST_VALUE_DATE, System.currentTimeMillis())?.apply()
                track(Event.REACHED_VALUE, mapOf(
                    "content_type" to contentType,
                    "days_to_value" to daysSinceInstall
                ))
            }

            val count = (prefs?.getInt(Keys.SUCCESS_ACTIONS_COUNT, 0) ?: 0) + 1
            prefs?.edit()?.putInt(Keys.SUCCESS_ACTIONS_COUNT, count)?.apply()

            // Record successful action and check if we should prompt for review
            InAppReviewHelper.recordSuccessfulAction()

            // Delay slightly then check for review prompt
            kotlinx.coroutines.delay(1500)
            InAppReviewHelper.checkAndShowPromptIfEligible()
        }
    }

    fun trackPaywallViewed(source: String) {
        track(Event.PAYWALL_VIEWED, mapOf(
            "source" to source,
            "days_since_install" to daysSinceInstall,
            "success_actions" to successActionsCount
        ))
    }

    fun trackTrialStarted(productId: String, trialDurationDays: Int) {
        scope.launch {
            prefs?.edit()?.apply {
                putLong(Keys.TRIAL_START_DATE, System.currentTimeMillis())
                putString(Keys.TRIAL_PRODUCT_ID, productId)
            }?.apply()
        }

        track(Event.TRIAL_STARTED, mapOf(
            "product_id" to productId,
            "trial_duration_days" to trialDurationDays,
            "days_since_install" to daysSinceInstall,
            "success_actions" to successActionsCount
        ))
    }

    fun trackSubscriptionBilled(productId: String, price: String, currency: String) {
        scope.launch {
            prefs?.edit()?.apply {
                putLong(Keys.SUBSCRIPTION_START_DATE, System.currentTimeMillis())
                putBoolean(Keys.BILLED_SUCCESSFULLY, true)
            }?.apply()
        }

        track(Event.SUBSCRIPTION_BILLED, mapOf(
            "product_id" to productId,
            "price" to price,
            "currency" to currency,
            "days_since_trial_start" to daysSinceTrialStart,
            "days_since_install" to daysSinceInstall
        ))
    }

    fun trackSubscriptionRenewed(productId: String) {
        track(Event.SUBSCRIPTION_RENEWED, mapOf(
            "product_id" to productId,
            "months_subscribed" to monthsSubscribed
        ))
    }

    fun trackTrialCancelled(reason: String? = null) {
        scope.launch {
            prefs?.edit()?.putLong(Keys.CANCEL_DATE, System.currentTimeMillis())?.apply()
        }

        track(Event.TRIAL_CANCELLED, mapOf(
            "days_in_trial" to daysSinceTrialStart,
            "reason" to (reason ?: "unknown"),
            "success_actions" to successActionsCount
        ))
    }

    fun trackSubscriptionCancelled(reason: String? = null) {
        scope.launch {
            prefs?.edit()?.putLong(Keys.CANCEL_DATE, System.currentTimeMillis())?.apply()
        }

        track(Event.SUBSCRIPTION_CANCELLED, mapOf(
            "months_subscribed" to monthsSubscribed,
            "reason" to (reason ?: "unknown")
        ))
    }

    // MARK: - Content Events

    fun trackNoteCreated(sourceType: String) {
        track(Event.NOTE_CREATED, mapOf("source_type" to sourceType))
        trackReachedValue("note_$sourceType")
    }

    fun trackYoutubeProcessed() {
        track(Event.YOUTUBE_PROCESSED)
    }

    fun trackRecordingStarted() {
        track(Event.RECORDING_STARTED)
    }

    fun trackRecordingProcessed(durationSeconds: Int) {
        track(Event.RECORDING_PROCESSED, mapOf("duration_seconds" to durationSeconds))
    }

    fun trackPdfProcessed(pageCount: Int = 0) {
        track(Event.PDF_PROCESSED, mapOf("page_count" to pageCount))
    }

    fun trackQuizGenerated(questionCount: Int) {
        track(Event.QUIZ_GENERATED, mapOf("question_count" to questionCount))
        trackReachedValue("quiz")
    }

    fun trackFlashcardsGenerated(cardCount: Int) {
        track(Event.FLASHCARDS_GENERATED, mapOf("card_count" to cardCount))
        trackReachedValue("flashcards")
    }

    fun trackPodcastGenerated(durationSeconds: Int) {
        track(Event.PODCAST_GENERATED, mapOf("duration_seconds" to durationSeconds))
        trackReachedValue("podcast")
    }

    fun trackChatUsed() {
        track(Event.CHAT_USED)
    }

    // MARK: - Quiz Events

    fun trackQuizTabViewed(noteId: String) {
        track(Event.QUIZ_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackQuizGenerateStarted(noteId: String) {
        track(Event.QUIZ_GENERATE_STARTED, mapOf("note_id" to noteId))
    }

    fun trackQuizQuestionAnswered(questionIndex: Int, isCorrect: Boolean, totalQuestions: Int) {
        track(Event.QUIZ_QUESTION_ANSWERED, mapOf(
            "question_index" to questionIndex,
            "is_correct" to isCorrect,
            "total_questions" to totalQuestions
        ))
    }

    fun trackQuizCompleted(score: Int, total: Int, percentageCorrect: Int) {
        track(Event.QUIZ_COMPLETED, mapOf(
            "score" to score,
            "total" to total,
            "percentage_correct" to percentageCorrect
        ))
        trackReachedValue("quiz_completed")
    }

    fun trackQuizRestarted() {
        track(Event.QUIZ_RESTARTED)
    }

    // MARK: - Flashcard Events

    fun trackFlashcardsTabViewed(noteId: String) {
        track(Event.FLASHCARDS_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackFlashcardsGenerateStarted(noteId: String) {
        track(Event.FLASHCARDS_GENERATE_STARTED, mapOf("note_id" to noteId))
    }

    fun trackFlashcardFlipped(cardIndex: Int, totalCards: Int) {
        track(Event.FLASHCARD_FLIPPED, mapOf(
            "card_index" to cardIndex,
            "total_cards" to totalCards
        ))
    }

    fun trackFlashcardSwiped(cardIndex: Int, direction: String) {
        track(Event.FLASHCARD_SWIPED, mapOf(
            "card_index" to cardIndex,
            "direction" to direction
        ))
    }

    fun trackFlashcardsCompleted(totalCards: Int, totalFlips: Int) {
        track(Event.FLASHCARDS_COMPLETED, mapOf(
            "total_cards" to totalCards,
            "total_flips" to totalFlips
        ))
        trackReachedValue("flashcards_completed")
    }

    // MARK: - Podcast Events

    fun trackPodcastTabViewed(noteId: String) {
        track(Event.PODCAST_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackPodcastGenerateStarted(noteId: String) {
        track(Event.PODCAST_GENERATE_STARTED, mapOf("note_id" to noteId))
    }

    fun trackPodcastPlayStarted(podcastId: String, duration: Int) {
        track(Event.PODCAST_PLAY_STARTED, mapOf(
            "podcast_id" to podcastId,
            "duration_seconds" to duration
        ))
    }

    fun trackPodcastPlayPaused(podcastId: String, currentPosition: Int, duration: Int) {
        val percentPlayed = if (duration > 0) (currentPosition * 100 / duration) else 0
        track(Event.PODCAST_PLAY_PAUSED, mapOf(
            "podcast_id" to podcastId,
            "current_position_seconds" to currentPosition,
            "duration_seconds" to duration,
            "percent_played" to percentPlayed
        ))
    }

    fun trackPodcastPlayCompleted(podcastId: String, duration: Int) {
        track(Event.PODCAST_PLAY_COMPLETED, mapOf(
            "podcast_id" to podcastId,
            "duration_seconds" to duration
        ))
        trackReachedValue("podcast_completed")
    }

    fun trackPodcastSkipped(direction: String, skipSeconds: Int) {
        track(Event.PODCAST_SKIPPED, mapOf(
            "direction" to direction,
            "skip_seconds" to skipSeconds
        ))
    }

    // MARK: - Chat Events

    fun trackChatTabViewed(noteId: String) {
        track(Event.CHAT_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackChatMessageSent(noteId: String, messageLength: Int) {
        track(Event.CHAT_MESSAGE_SENT, mapOf(
            "note_id" to noteId,
            "message_length" to messageLength
        ))
    }

    fun trackChatSuggestionUsed(noteId: String, suggestionIndex: Int) {
        track(Event.CHAT_SUGGESTION_USED, mapOf(
            "note_id" to noteId,
            "suggestion_index" to suggestionIndex
        ))
    }

    // MARK: - Summary/Diagram Events

    fun trackSummaryTabViewed(noteId: String) {
        track(Event.SUMMARY_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackSummaryGenerated(noteId: String, summaryLength: Int) {
        track(Event.SUMMARY_GENERATED, mapOf(
            "note_id" to noteId,
            "summary_length" to summaryLength
        ))
        trackReachedValue("summary")
    }

    fun trackDiagramGenerated(noteId: String, diagramType: String) {
        track(Event.DIAGRAM_GENERATED, mapOf(
            "note_id" to noteId,
            "diagram_type" to diagramType
        ))
        trackReachedValue("diagram")
    }

    // MARK: - Mind Map Events

    fun trackMindMapTabViewed(noteId: String) {
        track(Event.MINDMAP_TAB_VIEWED, mapOf("note_id" to noteId))
    }

    fun trackMindMapGenerated(noteId: String, nodeCount: Int) {
        track(Event.MINDMAP_GENERATED, mapOf(
            "note_id" to noteId,
            "node_count" to nodeCount
        ))
        trackReachedValue("mindmap")
    }

    // MARK: - Note Events

    fun trackNoteViewed(noteId: String, sourceType: String) {
        track(Event.NOTE_VIEWED, mapOf(
            "note_id" to noteId,
            "source_type" to sourceType
        ))
    }

    fun trackNoteDeleted(noteId: String) {
        track(Event.NOTE_DELETED, mapOf("note_id" to noteId))
    }

    // MARK: - Tab & Feature Discovery Events

    fun trackTabSwitched(fromTab: String, toTab: String, noteId: String) {
        track(Event.TAB_SWITCHED, mapOf(
            "from_tab" to fromTab,
            "to_tab" to toTab,
            "note_id" to noteId
        ))
    }

    fun trackFeatureDiscovered(feature: String, source: String) {
        track(Event.FEATURE_DISCOVERED, mapOf(
            "feature" to feature,
            "source" to source
        ))
    }

    fun trackFeatureBlocked(feature: String, reason: String) {
        track(Event.FEATURE_BLOCKED, mapOf(
            "feature" to feature,
            "reason" to reason
        ))
    }

    // MARK: - Session Events

    /**
     * Called when app becomes active
     */
    fun startSession() {
        sessionStartTime = System.currentTimeMillis()
        val sessionNumber = (prefs?.getInt(Keys.SESSION_COUNT, 0) ?: 0) + 1
        prefs?.edit()?.apply {
            putInt(Keys.SESSION_COUNT, sessionNumber)
            putLong(Keys.LAST_SESSION_DATE, System.currentTimeMillis())
        }?.apply()

        track(Event.SESSION_START, mapOf(
            "session_number" to sessionNumber,
            "days_since_install" to daysSinceInstall
        ))

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📊 Session #$sessionNumber started")
        }
    }

    /**
     * Called when app enters background
     */
    fun endSession() {
        val startTime = sessionStartTime ?: return

        val sessionDuration = (System.currentTimeMillis() - startTime) / 1000

        // Update total app time
        val totalTime = (prefs?.getLong(Keys.TOTAL_APP_TIME, 0) ?: 0) + sessionDuration
        prefs?.edit()?.putLong(Keys.TOTAL_APP_TIME, totalTime)?.apply()

        track(Event.SESSION_END, mapOf(
            "session_duration_seconds" to sessionDuration,
            "total_app_time_minutes" to (totalTime / 60)
        ))

        sessionStartTime = null

        // Flush events on session end
        flush()

        if (BuildConfig.DEBUG) {
            Log.d(TAG, "📊 Session ended. Duration: ${sessionDuration}s, Total: ${totalTime / 60}m")
        }
    }

    /**
     * Track app launch (called once per cold start)
     */
    fun trackAppLaunch() {
        track(Event.APP_LAUNCH, mapOf(
            "session_count" to (prefs?.getInt(Keys.SESSION_COUNT, 0) ?: 0),
            "total_app_time_minutes" to ((prefs?.getLong(Keys.TOTAL_APP_TIME, 0) ?: 0) / 60),
            "days_since_install" to daysSinceInstall
        ))
    }

    // MARK: - Error Events

    fun trackProcessingError(type: String, message: String) {
        track(Event.PROCESSING_ERROR, mapOf(
            "error_type" to type,
            "error_message" to message.take(200)
        ))
    }

    fun trackPaymentError(message: String) {
        track(Event.PAYMENT_ERROR, mapOf(
            "error_message" to message.take(200)
        ))
    }

    // MARK: - Computed Properties

    val hasReachedValue: Boolean
        get() = (prefs?.getLong(Keys.FIRST_VALUE_DATE, 0) ?: 0) > 0

    val isSubscribed: Boolean
        get() = prefs?.getBoolean(Keys.BILLED_SUCCESSFULLY, false) ?: false

    val successActionsCount: Int
        get() = prefs?.getInt(Keys.SUCCESS_ACTIONS_COUNT, 0) ?: 0

    val daysSinceInstall: Int
        get() {
            val installDate = prefs?.getLong(Keys.INSTALL_DATE, 0) ?: 0
            if (installDate == 0L) return 0
            return ((System.currentTimeMillis() - installDate) / (1000 * 60 * 60 * 24)).toInt()
        }

    val daysSinceTrialStart: Int
        get() {
            val trialDate = prefs?.getLong(Keys.TRIAL_START_DATE, 0) ?: 0
            if (trialDate == 0L) return -1
            return ((System.currentTimeMillis() - trialDate) / (1000 * 60 * 60 * 24)).toInt()
        }

    val monthsSubscribed: Int
        get() {
            val subDate = prefs?.getLong(Keys.SUBSCRIPTION_START_DATE, 0) ?: 0
            if (subDate == 0L) return 0
            return ((System.currentTimeMillis() - subDate) / (1000L * 60 * 60 * 24 * 30)).toInt()
        }

    val totalSessionCount: Int
        get() = prefs?.getInt(Keys.SESSION_COUNT, 0) ?: 0

    val totalAppTimeMinutes: Long
        get() = (prefs?.getLong(Keys.TOTAL_APP_TIME, 0) ?: 0) / 60

    // MARK: - Device Info

    private fun getAppVersion(): String {
        return try {
            val context = appContext ?: return "Unknown"
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "Unknown"
        } catch (e: Exception) {
            "Unknown"
        }
    }

    // MARK: - Debug

    fun printFunnelMetrics() {
        if (BuildConfig.DEBUG) {
            Log.d(TAG, """
                📊 FUNNEL METRICS:
                ==================
                Days since install: $daysSinceInstall
                Reached value: $hasReachedValue
                Success actions: $successActionsCount
                Billed successfully: $isSubscribed
                Months subscribed: $monthsSubscribed
                Pending events: ${loadPendingEvents().size}

                SESSION METRICS:
                ================
                Total sessions: $totalSessionCount
                Total app time: $totalAppTimeMinutes minutes
            """.trimIndent())
        }
    }

    // MARK: - Onboarding Events

    fun trackOnboardingStarted() {
        track(Event.ONBOARDING_STARTED, mapOf(
            "days_since_install" to daysSinceInstall
        ))
    }

    fun trackOnboardingStepCompleted(stepIndex: Int, stepName: String, selection: String? = null) {
        val properties = mutableMapOf<String, Any>(
            "step" to stepIndex,
            "step_name" to stepName
        )
        if (selection != null) {
            properties["selection"] = selection
        }
        track(Event.ONBOARDING_STEP_COMPLETED, properties)
    }

    fun trackOnboardingCompleted(userType: String?, useCases: List<String>) {
        track(Event.ONBOARDING_COMPLETED, mapOf(
            "user_type" to (userType ?: "not_selected"),
            "use_cases" to useCases,
            "days_since_install" to daysSinceInstall
        ))
    }

    fun trackOnboardingSkipped(atStep: Int, stepName: String) {
        track(Event.ONBOARDING_SKIPPED, mapOf(
            "at_step" to atStep,
            "step_name" to stepName
        ))
    }

    fun trackTrialSkipped() {
        track(Event.TRIAL_SKIPPED, mapOf(
            "days_since_install" to daysSinceInstall
        ))
    }

    fun trackPromoCodeApplied(code: String) {
        track(Event.PROMO_CODE_APPLIED, mapOf(
            "code" to code,
            "days_since_install" to daysSinceInstall
        ))
    }

    fun resetForTesting() {
        if (BuildConfig.DEBUG) {
            scope.launch {
                prefs?.edit()?.apply {
                    remove(Keys.INSTALL_DATE)
                    remove(Keys.FIRST_VALUE_DATE)
                    remove(Keys.TRIAL_START_DATE)
                    remove(Keys.TRIAL_PRODUCT_ID)
                    remove(Keys.SUBSCRIPTION_START_DATE)
                    remove(Keys.CANCEL_DATE)
                    remove(Keys.BILLED_SUCCESSFULLY)
                    remove(Keys.SUCCESS_ACTIONS_COUNT)
                    remove(Keys.PENDING_EVENTS)
                    remove(Keys.SESSION_COUNT)
                    remove(Keys.TOTAL_APP_TIME)
                    remove(Keys.LAST_SESSION_DATE)
                }?.apply()

                synchronized(eventBuffer) {
                    eventBuffer.clear()
                }
                sessionStartTime = null

                Log.d(TAG, "🧪 Analytics reset for testing")
            }
        }
    }
}
