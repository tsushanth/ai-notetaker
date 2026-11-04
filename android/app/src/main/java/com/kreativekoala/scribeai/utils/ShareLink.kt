package com.kreativekoala.scribeai.utils

import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

sealed class ShareLinkResult {
    data class Success(val url: String) : ShareLinkResult()

    /** HTTP 429: the daily limit on share links is reached (not a paywall). [message] is the friendly text to show. */
    data class LimitReached(val message: String) : ShareLinkResult()

    data class Failure(val message: String) : ShareLinkResult()
}

/**
 * Creates a public share link for a note via POST /api/notes/{id}/share.
 *
 * The request runs on Dispatchers.IO. It used to be made straight from a `rememberCoroutineScope()` coroutine (main
 * thread), where OkHttp's blocking execute() throws NetworkOnMainThreadException before any request is sent, so the
 * menu item could never succeed.
 */
object ShareLink {
    const val DEFAULT_ERROR = "Failed to create share link"
    const val NETWORK_ERROR = "Could not reach the server. Check your connection and try again."

    private val JSON = "application/json".toMediaType()

    /** Pure: turn the HTTP status and body into a result. */
    fun parseResponse(httpCode: Int, body: String?): ShareLinkResult {
        val obj = try {
            JsonParser.parseString(body ?: "").asJsonObject
        } catch (e: Exception) {
            null
        }

        fun text(key: String): String? {
            val el = obj?.get(key)
            return if (el != null && el.isJsonPrimitive && el.asJsonPrimitive.isString) el.asString.trim().takeIf { it.isNotEmpty() } else null
        }

        val ok = obj?.get("success")?.let { it.isJsonPrimitive && it.asJsonPrimitive.isBoolean && it.asBoolean } == true
        if (ok) {
            val data = obj?.get("data")
            val url = if (data != null && data.isJsonObject) {
                data.asJsonObject.get("shareUrl")?.takeIf { it.isJsonPrimitive }?.asString?.trim()
            } else null
            if (!url.isNullOrEmpty()) return ShareLinkResult.Success(url)
            return ShareLinkResult.Failure(DEFAULT_ERROR)
        }
        val message = (text("error") ?: text("message"))?.takeIf { it.length <= 300 } ?: DEFAULT_ERROR
        return when (httpCode) {
            429 -> ShareLinkResult.LimitReached(FreeTierErrors.dailyLimitMessage(body))
            // Sharing is free now: an older server may still answer 403 with an upgrade message, which must not be shown.
            403 -> ShareLinkResult.Failure(DEFAULT_ERROR)
            else -> ShareLinkResult.Failure(message)
        }
    }

    suspend fun create(
        baseUrl: String,
        token: String,
        noteId: String,
        client: OkHttpClient = OkHttpClient()
    ): ShareLinkResult = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/notes/$noteId/share")
                .addHeader("Authorization", "Bearer $token")
                .post("{}".toRequestBody(JSON))
                .build()
            client.newCall(request).execute().use { response ->
                parseResponse(response.code, response.body?.string())
            }
        } catch (e: IOException) {
            ShareLinkResult.Failure(NETWORK_ERROR)
        } catch (e: IllegalArgumentException) {
            ShareLinkResult.Failure(DEFAULT_ERROR)
        }
    }

    /** Text handed to the system share sheet. */
    fun shareMessage(title: String, url: String): String {
        val name = title.trim()
        return if (name.isEmpty()) "Notes made with Scribe AI: $url" else "$name (notes made with Scribe AI): $url"
    }
}
