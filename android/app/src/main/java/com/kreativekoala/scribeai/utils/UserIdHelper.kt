package com.kreativekoala.scribeai.utils

import android.util.Base64
import android.util.Log
import org.json.JSONObject

object UserIdHelper {
    private const val TAG = "UserIdHelper"

    /**
     * Extract user ID from JWT token
     * This ensures consistent userId across the app
     */
    fun extractUserIdFromToken(token: String): String {
        return try {
            val parts = token.split(".")
            if (parts.size != 3) {
                Log.e(TAG, "Invalid token format, using hash as fallback")
                return token.hashCode().toString()
            }

            // Decode the payload (second part)
            val payload = String(
                Base64.decode(
                    parts[1],
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
                )
            )
            val json = JSONObject(payload)

            // Try different possible user ID fields
            val userId = json.optString("sub")  // Standard JWT "subject" claim
                .takeIf { it.isNotEmpty() }
                ?: json.optString("user_id")
                    .takeIf { it.isNotEmpty() }
                ?: json.optString("id")
                    .takeIf { it.isNotEmpty() }
                ?: token.hashCode().toString()  // Fallback to token hash

            Log.d(TAG, "✅ Extracted userId: $userId")
            userId
        } catch (e: Exception) {
            Log.e(TAG, "Error extracting userId from token, using hash", e)
            token.hashCode().toString()
        }
    }
}