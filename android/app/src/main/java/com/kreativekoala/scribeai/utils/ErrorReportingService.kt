package com.kreativekoala.scribeai.utils

import android.content.Context
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
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Service for reporting user journey errors to the backend
 * Matches iOS ErrorReportingService implementation
 */
object ErrorReportingService {

    private const val TAG = "ErrorReportingService"

    /**
     * User journey flows that can be reported
     */
    enum class UserFlow(val displayName: String) {
        // Auth flows
        SIGN_IN("Sign In"),
        SIGN_UP("Sign Up"),
        SIGN_IN_WITH_GOOGLE("Sign In with Google"),
        SIGN_OUT("Sign Out"),

        // Content creation flows
        RECORD_AUDIO("Record Audio"),
        UPLOAD_PDF("Upload PDF"),
        SCAN_DOCUMENT("Scan Document"),
        YOUTUBE_LINK("YouTube Link"),
        UPLOAD_SLIDESHOW("Upload Slideshow"),

        // AI generation flows
        GENERATE_SUMMARY("Generate Summary"),
        GENERATE_QUIZ("Generate Quiz"),
        GENERATE_FLASHCARDS("Generate Flashcards"),
        GENERATE_PODCAST("Generate Podcast"),
        GENERATE_DIAGRAM("Generate Diagram"),
        GENERATE_INFOGRAPHIC("Generate Infographic"),
        CHAT_WITH_NOTE("Chat with Note"),

        // Subscription flows
        PURCHASE("Purchase Subscription"),
        RESTORE_PURCHASES("Restore Purchases"),

        // Other flows
        FETCH_NOTES("Fetch Notes"),
        DELETE_NOTE("Delete Note"),
        TRANSCRIPTION("Transcription")
    }

    // Dedicated coroutine scope for background error reporting
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Short-timeout client for error reporting
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private var authManager: AuthManager? = null
    private var appContext: Context? = null

    /**
     * Initialize the service with required dependencies
     * Should be called once during app startup
     */
    fun initialize(context: Context, authManager: AuthManager) {
        this.appContext = context.applicationContext
        this.authManager = authManager
    }

    /**
     * Report an error that occurred during a user journey
     * Runs completely in background - never blocks UI
     *
     * @param flow The user flow where the error occurred
     * @param error The exception that occurred
     * @param additionalInfo Any additional context
     */
    fun reportError(flow: UserFlow, error: Throwable, additionalInfo: String? = null) {
        val errorMessage = buildString {
            append(error.message ?: error.javaClass.simpleName)
            if (additionalInfo != null) {
                append(" | Additional: $additionalInfo")
            }
        }
        reportError(flow, errorMessage)
    }

    /**
     * Report an error with a custom error message
     * Runs completely in background - never blocks UI
     *
     * @param flow The user flow where the error occurred
     * @param errorMessage Custom error message
     * @param additionalInfo Any additional context
     */
    fun reportError(flow: UserFlow, errorMessage: String, additionalInfo: String? = null) {
        // Fire and forget - run in background
        scope.launch {
            try {
                sendErrorReport(flow, errorMessage, additionalInfo)
            } catch (e: Exception) {
                // Don't throw - just log locally
                Log.w(TAG, "Failed to send error report: ${e.message}")
            }
        }
    }

    private suspend fun sendErrorReport(flow: UserFlow, errorMessage: String, additionalInfo: String?) {
        val url = "${BuildConfig.BASE_URL.trimEnd('/')}/api/alerts/error"

        // Build full error message
        val fullErrorMessage = buildString {
            append(errorMessage)
            if (additionalInfo != null) {
                append(" | $additionalInfo")
            }
        }

        // Get device info
        val deviceInfo = JSONObject().apply {
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("osVersion", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
            put("appVersion", getAppVersion())
        }

        // Build request body
        val body = JSONObject().apply {
            put("flow", flow.displayName)
            put("error", fullErrorMessage)
            put("deviceInfo", deviceInfo)
        }

        // Build request
        val requestBuilder = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .addHeader("Content-Type", "application/json")

        // Add auth token if available
        authManager?.getCurrentToken()?.let { token ->
            requestBuilder.addHeader("Authorization", "Bearer $token")
        }

        val request = requestBuilder.build()

        // Execute request
        client.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                Log.d(TAG, "📧 Error reported successfully for flow: ${flow.displayName}")
            } else {
                Log.w(TAG, "⚠️ Failed to report error, status: ${response.code}")
            }
        }
    }

    private fun getAppVersion(): String {
        return try {
            val context = appContext ?: return "Unknown"
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "Unknown"
        } catch (e: Exception) {
            "Unknown"
        }
    }
}
