package com.kreativekoala.scribeai.utils

import com.google.gson.JsonParser
import com.kreativekoala.scribeai.R

/**
 * The server answers HTTP 429 when a free-tier daily backstop is hit (voice transcription or AI
 * generation). That is NOT a paywall: the message must be plain and must not tell the user to upgrade.
 */
object FreeTierErrors {
    // A daily-limit message must never push an upgrade: ignore server text that does.
    private val UPSELL_WORDS = listOf("upgrade", "subscri", "premium")

    /** Localized default message for a daily-limit response. */
    fun defaultMessage(): String = AppStrings.get(R.string.error_daily_limit)

    /** Server message from a JSON error body ({"error": "..."} or {"message": "..."}), else [fallback]. */
    fun dailyLimitMessage(errorBody: String?, fallback: () -> String = ::defaultMessage): String {
        val fromServer = try {
            val obj = JsonParser.parseString(errorBody ?: "").asJsonObject
            listOf("error", "message")
                .mapNotNull { key ->
                    val el = obj.get(key)
                    if (el != null && el.isJsonPrimitive && el.asJsonPrimitive.isString) el.asString.trim() else null
                }
                .firstOrNull { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
        val usable = fromServer != null && fromServer.length <= 300 &&
            UPSELL_WORDS.none { fromServer.contains(it, ignoreCase = true) }
        return if (usable) fromServer!! else fallback()
    }

    /** Thrown for a 429 so callers can show the message as is, without a "failed" prefix. */
    class DailyLimitException(message: String) : Exception(message)
}
