package com.kreativekoala.scribeai.utils

import com.kreativekoala.scribeai.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Process-lifetime store for in-flight "start learning session" requests.
 *
 * The Learn tab lives inside a `when(selectedTab)` block, so its Composable
 * (and any coroutine scope tied to that Composable) is destroyed the moment
 * the user taps a different tab. Without somewhere outside the Composable
 * to hold the work, the in-flight POST gets cancelled and the user loses
 * the session even though the backend may have already created one.
 *
 * This singleton:
 *   - keeps per-note state alive across tab switches
 *   - dedupes concurrent "Start Learning" taps on the same note
 *   - lets the Composable simply observe the StateFlow and render whichever
 *     state the request is currently in
 */
object LearnSessionManager {

    sealed class State {
        object Idle : State()
        object Starting : State()
        data class Ready(val sessionId: String) : State()
        data class Failed(val message: String) : State()
    }

    private val states = mutableMapOf<String, MutableStateFlow<State>>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient()

    /** Observe the current state for a given note. */
    fun stateFor(noteId: String): StateFlow<State> =
        states.getOrPut(noteId) { MutableStateFlow<State>(State.Idle) }.asStateFlow()

    /** Reset state — used when the user explicitly leaves an errored session. */
    fun reset(noteId: String) {
        states[noteId]?.value = State.Idle
    }

    /**
     * Begin (or rejoin) the start-session request for a note. No-op if a
     * request is already in flight or has already completed for this note.
     */
    fun startIfNeeded(noteId: String, authToken: String) {
        val flow = states.getOrPut(noteId) { MutableStateFlow<State>(State.Idle) }
        when (flow.value) {
            is State.Starting, is State.Ready -> return
            else -> Unit
        }
        flow.value = State.Starting
        scope.launch {
            try {
                val request = Request.Builder()
                    .url("${BuildConfig.BASE_URL.trimEnd('/')}/api/learn/$noteId/start")
                    .addHeader("Authorization", "Bearer $authToken")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()
                val response = client.newCall(request).execute()
                val body = response.body?.string() ?: "{}"
                val json = JSONObject(body)
                if (json.optBoolean("success")) {
                    val sessionId = json.optJSONObject("data")
                        ?.optJSONObject("session")
                        ?.optString("id")
                    if (sessionId.isNullOrEmpty()) {
                        flow.value = State.Failed("Couldn't start the lesson. Please try again.")
                    } else {
                        flow.value = State.Ready(sessionId)
                    }
                } else {
                    flow.value = State.Failed(
                        json.optString("error", "Couldn't start the lesson. Please try again.")
                    )
                }
            } catch (e: Exception) {
                flow.value = State.Failed(e.message ?: "Connection error")
            }
        }
    }
}
