package com.kreativekoala.scribeai.recording

import android.content.Context
import android.os.Build
import android.util.Log
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.AuthManager
import java.io.File
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/** Wiring for the recording code: where files live, where events go, which token to use. */
object RecordingEnv {
    private const val TAG = "RecordingEnv"

    @Volatile private var storeInstance: PendingRecordingStore? = null

    fun store(context: Context): PendingRecordingStore =
        storeInstance ?: synchronized(this) {
            storeInstance ?: PendingRecordingStore(File(context.applicationContext.filesDir, "recordings")).also { storeInstance = it }
        }

    fun telemetry(context: Context): RecordingTelemetry {
        val app = context.applicationContext
        return RecordingTelemetry(
            sink = AnalyticsEventSink(app),
            common = {
                mapOf(
                    "sdk_int" to Build.VERSION.SDK_INT,
                    "manufacturer" to Build.MANUFACTURER.lowercase().replace(Regex("[^a-z0-9]"), "").take(30),
                    "version_code" to BuildConfig.VERSION_CODE
                )
            },
            log = { Log.w(TAG, it) }
        )
    }

    fun api(context: Context): RecordingApi =
        HttpRecordingApi(BuildConfig.BASE_URL, token = { RecordingAuth.token(context.applicationContext) })
}

/**
 * Sends events through the app's AnalyticsService. A background process started only to upload (no activity yet) has
 * no analytics session, so those events are queued in a small file and replayed the next time the app opens.
 */
class AnalyticsEventSink(private val context: Context) : EventSink {
    override fun send(name: String, props: Map<String, Any>) {
        if (AnalyticsService.isReady()) {
            AnalyticsService.trackEvent(name, props)
        } else {
            EventQueue.append(context, name, props)
        }
    }

    override fun flush() { if (AnalyticsService.isReady()) AnalyticsService.flush() }
}

/** Events waiting for an analytics session. Capped; oldest dropped first. */
object EventQueue {
    private const val MAX_LINES = 200

    private fun file(context: Context) = File(context.applicationContext.filesDir, "recordings/events.queue.jsonl")

    @Synchronized
    fun append(context: Context, name: String, props: Map<String, Any>) {
        try {
            val f = file(context)
            f.parentFile?.mkdirs()
            val line = JSONObject().put("n", name).put("p", JSONObject(props)).toString()
            val lines = (if (f.exists()) f.readLines() else emptyList()) + line
            f.writeText(lines.takeLast(MAX_LINES).joinToString("\n") + "\n")
        } catch (e: Exception) {
            Log.w("EventQueue", "could not queue event", e)
        }
    }

    @Synchronized
    fun drain(context: Context) {
        try {
            val f = file(context)
            if (!f.exists()) return
            val lines = f.readLines().filter { it.isNotBlank() }
            f.delete()
            for (l in lines) {
                val o = JSONObject(l)
                val p = o.getJSONObject("p")
                val map = HashMap<String, Any>()
                p.keys().forEach { k -> map[k] = p.get(k) }
                AnalyticsService.trackEvent(o.getString("n"), map)
            }
        } catch (e: Exception) {
            Log.w("EventQueue", "could not replay queued events", e)
        }
    }
}

/**
 * Bearer token for background sending.
 *
 * With the app's own AuthManager (registered at app start) the token is refreshed when needed. A process started
 * only by the scheduler has no AuthManager yet; then the stored token is used as is and never refreshed: a second
 * component refreshing would rotate the refresh token out from under the app and sign the user out. If the stored
 * token is expired the send waits until the app is opened.
 */
object RecordingAuth {
    @Volatile private var shared: AuthManager? = null
    @Volatile private var readOnly: AuthManager? = null

    fun register(authManager: AuthManager) { shared = authManager }

    suspend fun token(context: Context): String? {
        shared?.let { return it.getFreshToken() }
        val am = readOnly ?: AuthManager(context.applicationContext).also { readOnly = it }
        withTimeoutOrNull(3_000) { am.authToken.filterNotNull().first() } ?: return null
        return if (am.needsTokenRefresh()) null else am.getCurrentToken()
    }
}
