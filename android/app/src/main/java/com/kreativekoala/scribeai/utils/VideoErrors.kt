package com.kreativekoala.scribeai.utils

import androidx.annotation.StringRes
import com.google.gson.JsonParser
import com.kreativekoala.scribeai.R
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * Why a YouTube link did not become a note. [serverMessage] is the server's own explanation and is shown as it is
 * (it is written for users, in English); when there is none, [textRes] says what happened.
 */
data class VideoFailure(
    /** The server's error code, or a short app code. Used for analytics, never shown. */
    val code: String,
    val status: Int? = null,
    val serverMessage: String? = null,
    @StringRes val textRes: Int = 0,
    val textArg: Int? = null,
) {
    /** Not a failure: the server is still writing the transcript and will save the note itself. */
    val isPending: Boolean get() = code == VideoErrors.PENDING

    fun message(text: (Int, Array<Any>) -> String): String =
        serverMessage ?: text(textRes, textArg?.let { arrayOf<Any>(it) } ?: emptyArray())
}

object VideoErrors {
    const val PENDING = "TRANSCRIPT_PENDING"

    /** An unsuccessful answer from POST /api/uploads/video-url. */
    fun fromResponse(status: Int, body: String?): VideoFailure {
        val serverCode = try {
            JsonParser.parseString(body ?: "").asJsonObject.get("code")?.asString?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
        // Same rules as for limit messages: short, and never one that pushes an upgrade.
        val serverText = FreeTierErrors.dailyLimitMessage(body) { "" }.ifEmpty { null }
        val code = serverCode ?: "http_$status"
        return when {
            status == 401 -> VideoFailure("unauthorized", status, textRes = R.string.error_session_expired)
            // A 400 without a code is the link check; its text ("Validation error") tells the user nothing.
            status == 400 && serverCode == null ->
                VideoFailure("bad_link", status, textRes = R.string.error_youtube_link)
            serverText != null -> VideoFailure(code, status, serverMessage = serverText)
            status == 429 -> VideoFailure(code, status, textRes = R.string.error_daily_limit)
            else -> VideoFailure(code, status, textRes = R.string.error_video_process_code, textArg = status)
        }
    }

    /** The request got no answer. */
    fun fromException(e: Throwable): VideoFailure = when (e) {
        is InterruptedIOException -> VideoFailure("timeout", textRes = R.string.error_network_timeout)
        is UnknownHostException, is ConnectException ->
            VideoFailure("no_connection", textRes = R.string.error_network_no_connection)
        is SSLException -> VideoFailure("ssl", textRes = R.string.error_network_ssl)
        is IOException -> VideoFailure("network", textRes = R.string.error_network_generic)
        else -> VideoFailure("app_error", textRes = R.string.error_video_process)
    }
}
