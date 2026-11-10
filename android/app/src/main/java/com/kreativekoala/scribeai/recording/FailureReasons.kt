package com.kreativekoala.scribeai.recording

import com.google.gson.JsonParser

/** Why a recording could not become a note, in terms the screen can explain in plain language. */
enum class FailureKind(val retryable: Boolean) {
    /** The file held only zeros: the microphone delivered nothing. */
    SILENT(false),
    /** Sound was recorded but no speech was found. */
    NO_SPEECH(false),
    /** No speech found and the detected language is not English: likely unsupported or unclear. */
    LANGUAGE(false),
    TOO_SHORT(false),
    TOO_LARGE(false),
    DAILY_LIMIT(false),
    /** The transcription service had a problem; trying again may work. */
    SERVICE(true),
    NETWORK(true),
    AUTH(true),
    UNKNOWN(false)
}

/** A failure with the server's code (for analytics) and, for unknown 4xx answers, the server's own sentence. */
data class Failure(val kind: FailureKind, val code: String? = null, val serverText: String? = null)

/**
 * Turns what the backend says into a [Failure]. Two sources:
 *  - the HTTP answer of POST /api/recordings/transcribe: `{"error": "...", "code": "NO_SPEECH"}`;
 *  - the stored row (GET /api/recordings/:id): `status: "failed"` and `error_message: "NO_SPEECH: audio 12s, detected
 *    language en (confidence 0.9), file 1.1 MB, level silent (all samples zero) ..."` (format since 2026-10-29).
 * Both are parsed defensively; anything unexpected becomes UNKNOWN/SERVICE and is never shown as raw server text
 * unless it is a short client-error sentence.
 */
object FailureReasons {
    private val DURATION = Regex("""audio\s+(?:(\d+)m)?(\d+(?:\.\d+)?)s""")
    private val LANGUAGE = Regex("""detected language\s+([a-z]{2,3}(?:-[A-Za-z]+)?)""")

    fun fromHttp(httpCode: Int?, body: String?): Failure {
        if (httpCode == null) return Failure(FailureKind.NETWORK)
        val code = jsonString(body, "code")?.uppercase()
        val text = jsonString(body, "error") ?: jsonString(body, "message")
        return when {
            httpCode == 429 -> Failure(FailureKind.DAILY_LIMIT, code, text?.takeIf { it.length <= 300 })
            httpCode == 401 || httpCode == 403 -> Failure(FailureKind.AUTH, code)
            httpCode == 413 -> Failure(FailureKind.TOO_LARGE, code)
            code == "NO_SPEECH" || httpCode == 422 -> fromNoSpeech(code ?: "NO_SPEECH", text, null)
            httpCode >= 500 || code in SERVICE_CODES -> Failure(FailureKind.SERVICE, code)
            httpCode in 400..499 -> Failure(FailureKind.UNKNOWN, code, text?.takeIf { it.isNotBlank() && it.length <= 300 })
            else -> Failure(FailureKind.UNKNOWN, code)
        }
    }

    /** [errorMessage] is the row's error_message ("CODE: facts"); null or blank gives UNKNOWN. */
    fun fromStoredError(errorMessage: String?): Failure {
        val msg = errorMessage?.trim().orEmpty()
        if (msg.isEmpty()) return Failure(FailureKind.UNKNOWN)
        val code = msg.substringBefore(':', "").trim().takeIf { it.matches(Regex("[A-Z_]{3,40}")) }
        return when {
            code == "NO_SPEECH" || msg.startsWith("The recording is completely silent") -> fromNoSpeech(code ?: "NO_SPEECH", msg, msg)
            code in SERVICE_CODES || code == "INTERNAL_ERROR" -> Failure(FailureKind.SERVICE, code)
            else -> Failure(FailureKind.UNKNOWN, code)
        }
    }

    private val SERVICE_CODES = setOf("PROVIDER_ERROR", "PROVIDER_TIMEOUT", "DOWNLOAD_FAILED", "EMPTY_FILE", "RECORD_UPDATE_FAILED", "INTERNAL_ERROR")

    private fun fromNoSpeech(code: String, text: String?, facts: String?): Failure {
        val t = text.orEmpty()
        val f = facts ?: t
        val silent = t.contains("completely silent", ignoreCase = true) || f.contains("level silent", ignoreCase = true) || f.contains("all samples zero", ignoreCase = true)
        if (silent) return Failure(FailureKind.SILENT, code)
        val seconds = DURATION.find(f)?.let {
            (it.groupValues[1].toIntOrNull() ?: 0) * 60.0 + (it.groupValues[2].toDoubleOrNull() ?: 0.0)
        }
        if (seconds != null && seconds < 3.0) return Failure(FailureKind.TOO_SHORT, code)
        val lang = LANGUAGE.find(f)?.groupValues?.get(1)?.lowercase()
        if (lang != null && !lang.startsWith("en")) return Failure(FailureKind.LANGUAGE, code)
        return Failure(FailureKind.NO_SPEECH, code)
    }

    private fun jsonString(body: String?, key: String): String? = try {
        val el = JsonParser.parseString(body ?: "").asJsonObject.get(key)
        if (el != null && el.isJsonPrimitive && el.asJsonPrimitive.isString) el.asString.trim().takeIf { it.isNotEmpty() } else null
    } catch (e: Exception) {
        null
    }
}
