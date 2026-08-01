package com.kreativekoala.scribeai.utils

import android.content.Context
import android.widget.Toast
import com.kreativekoala.scribeai.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Helper for integration exports (Google Drive, Notion, Slack)
 */
object IntegrationHelper {
    private val client = OkHttpClient()

    /**
     * Export a note to a third-party provider
     * @param endpoint e.g. "google-drive/export", "notion/export", "slack/share"
     */
    suspend fun exportToProvider(context: Context, token: String, noteId: String, endpoint: String) {
        withContext(Dispatchers.IO) {
            try {
                val url = "${BuildConfig.BASE_URL.trimEnd('/')}/api/integrations/$endpoint/$noteId"
                val request = Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer $token")
                    .post("{}".toRequestBody("application/json".toMediaType()))
                    .build()

                val response = client.newCall(request).execute()
                val body = response.body?.string()
                val json = JSONObject(body ?: "{}")

                withContext(Dispatchers.Main) {
                    when (response.code) {
                        200 -> {
                            val providerName = endpoint.substringBefore("/").replace("-", " ")
                                .replaceFirstChar { it.uppercase() }
                            Toast.makeText(context, "Sent to $providerName!", Toast.LENGTH_SHORT).show()
                            AnalyticsService.trackEvent("integration_export_completed", mapOf(
                                "note_id" to noteId,
                                "provider" to endpoint.substringBefore("/")
                            ))
                        }
                        400 -> {
                            val error = json.optString("error", "Integration not connected. Connect in Settings.")
                            Toast.makeText(context, error, Toast.LENGTH_LONG).show()
                        }
                        403 -> {
                            Toast.makeText(context, "Premium subscription required", Toast.LENGTH_SHORT).show()
                        }
                        else -> {
                            Toast.makeText(context, "Export failed. Please try again.", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
