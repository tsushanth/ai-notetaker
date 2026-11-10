package com.kreativekoala.scribeai.utils

import com.google.gson.JsonParser

/**
 * What the recording screen does with a failed transcription request.
 *
 * The server answers HTTP 422 when it could not hear anything in the recording ("The recording is completely silent.
 * Check that the microphone is allowed ..."). That text is the useful part, so it is shown as is. Server errors (5xx)
 * and unknown bodies keep the app's own generic message, because their text can be technical.
 */
object RecordingErrors {
    /** Client errors whose server text is meant for the user. 401, 403, 404 and 429 have their own handling. */
    private val USER_FACING_CODES = setOf(400, 413, 422)

    /** The server's own message for [httpCode], or null when the caller should show its generic message. */
    fun serverMessage(httpCode: Int, body: String?): String? {
        if (httpCode !in USER_FACING_CODES) return null
        return try {
            val obj = JsonParser.parseString(body ?: "").asJsonObject
            listOf("error", "message")
                .mapNotNull { key ->
                    val el = obj.get(key)
                    if (el != null && el.isJsonPrimitive && el.asJsonPrimitive.isString) el.asString.trim() else null
                }
                .firstOrNull { it.isNotEmpty() && it.length <= 300 }
        } catch (e: Exception) {
            null
        }
    }

    /**
     * True when sending the same audio again could work: no response at all (network), a server error, or the daily
     * limit (429, later). False for 4xx answers about the audio itself (silent, too large, wrong type): retrying the
     * same file cannot change the result, so the screen goes back to a fresh recording.
     */
    fun canRetrySameAudio(httpCode: Int?): Boolean = httpCode == null || httpCode >= 500 || httpCode == 429 || httpCode == 401
}
