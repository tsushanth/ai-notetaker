package com.kreativekoala.scribeai.utils

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import com.kreativekoala.scribeai.data.api.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

enum class ExportFormat(val extension: String, val mimeType: String) {
    PDF("pdf", "application/pdf"),
    DOCX("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
}

sealed class ExportResult {
    data class Success(val fileUri: Uri, val mimeType: String) : ExportResult()
    data class Error(val message: String) : ExportResult()
    data object PremiumRequired : ExportResult()
}

object ExportManager {
    private const val TAG = "ExportManager"

    /**
     * Download an exported file from the backend and return a shareable URI
     */
    suspend fun exportNote(
        context: Context,
        token: String,
        noteId: String,
        noteTitle: String,
        format: ExportFormat
    ): ExportResult = withContext(Dispatchers.IO) {
        try {
            val api = RetrofitClient.apiService

            val response = when (format) {
                ExportFormat.PDF -> api.exportNotePdf("Bearer $token", noteId)
                ExportFormat.DOCX -> api.exportNoteDocx("Bearer $token", noteId)
            }

            when (response.code()) {
                200 -> {
                    val body = response.body() ?: return@withContext ExportResult.Error("Empty response")

                    // Create exports cache directory
                    val exportDir = File(context.cacheDir, "exports")
                    if (!exportDir.exists()) exportDir.mkdirs()

                    // Clean filename
                    val safeTitle = noteTitle
                        .replace(Regex("[^a-zA-Z0-9 _-]"), "")
                        .take(50)
                        .trim()
                    val fileName = "$safeTitle - Scribe AI.${format.extension}"
                    val file = File(exportDir, fileName)

                    // Write to file
                    body.byteStream().use { input ->
                        file.outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }

                    // Get shareable URI via FileProvider
                    val uri = FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        file
                    )

                    AnalyticsService.trackEvent("export_completed", mapOf(
                        "note_id" to noteId,
                        "format" to format.extension
                    ))

                    ExportResult.Success(uri, format.mimeType)
                }
                403 -> {
                    Log.w(TAG, "Export blocked - premium required")
                    ExportResult.PremiumRequired
                }
                else -> {
                    val errorBody = response.errorBody()?.string()
                    Log.e(TAG, "Export failed: HTTP ${response.code()} - $errorBody")
                    ExportResult.Error("Export failed (HTTP ${response.code()})")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Export error", e)
            AnalyticsService.trackEvent("export_failed", mapOf(
                "note_id" to noteId,
                "format" to format.extension,
                "error" to (e.message ?: "unknown")
            ))
            ExportResult.Error(e.message ?: "Export failed")
        }
    }

    /**
     * Create a share intent for an exported file
     */
    fun createShareIntent(uri: Uri, mimeType: String, noteTitle: String): Intent {
        return Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, noteTitle)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}
