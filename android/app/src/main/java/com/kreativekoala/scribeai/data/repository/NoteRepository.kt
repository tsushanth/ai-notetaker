package com.kreativekoala.scribeai.data.repository

import android.util.Log
import com.kreativekoala.scribeai.BuildConfig.BASE_URL
import com.kreativekoala.scribeai.data.api.NetworkError
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.*
import com.kreativekoala.scribeai.viewmodel.ChatMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

class NoteRepository {

    companion object {
        private const val TAG = "NoteRepository"
    }

    private val apiService = RetrofitClient.apiService

    /**
     * Parse exception into user-friendly error message
     */
    private fun parseError(e: Exception): String {
        val networkError = RetrofitClient.parseNetworkError(e)
        return networkError.message
    }

    suspend fun getNotes(token: String, page: Int = 1, limit: Int = 20): Result<NotesListResponse> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "📡 Fetching notes - page: $page, limit: $limit")

                val response = apiService.getNotes("Bearer $token", page, limit)

                if (response.isSuccessful && response.body() != null) {
                    val body = response.body()!!
                    Log.d(TAG, "✅ Notes fetched: ${body.data?.size ?: 0} notes (page: $page, total: ${body.pagination?.total ?: 0})")
                    Result.success(body)
                } else {
                    val errorBody = response.errorBody()?.string()
                    val errorMessage = when (response.code()) {
                        401 -> "Session expired. Please log in again."
                        403 -> "Access denied. Please log in again."
                        404 -> "Notes not found."
                        500, 502, 503, 504 -> "Server error. Please try again later."
                        else -> "Failed to load notes (${response.code()})"
                    }
                    Log.e(TAG, "❌ getNotes failed: $errorMessage - $errorBody")
                    Result.failure(Exception(errorMessage))
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ getNotes exception: ${e.javaClass.simpleName} - ${e.message}")
                Result.failure(Exception(parseError(e)))
            }
        }
    }
    
    suspend fun getNote(token: String, noteId: String): Result<Note> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.getNote("Bearer $token", noteId)
                if (response.isSuccessful && response.body()?.data != null) {
                    Result.success(response.body()!!.data!!)
                } else {
                    Result.failure(Exception("Failed to fetch note"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun createNote(token: String, request: CreateNoteRequest): Result<Note> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.createNote("Bearer $token", request)
                if (response.isSuccessful && response.body()?.data != null) {
                    Result.success(response.body()!!.data!!)
                } else {
                    Result.failure(Exception("Failed to create note"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun deleteNote(token: String, noteId: String): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.deleteNote("Bearer $token", noteId)
                if (response.isSuccessful) {
                    Result.success(true)
                } else {
                    Result.failure(Exception("Failed to delete note"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    /**
     * Upload audio recording
     */
    suspend fun uploadRecording(
        token: String,
        audioFile: File,
        title: String
    ): Result<RecordingResponse> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d("NoteRepository", "Uploading recording: ${audioFile.name}, size: ${audioFile.length()}")

                // Determine MIME type based on file extension
                val mimeType = when {
                    audioFile.name.endsWith(".m4a", ignoreCase = true) -> "audio/m4a"
                    audioFile.name.endsWith(".mp4", ignoreCase = true) -> "audio/mp4"
                    audioFile.name.endsWith(".aac", ignoreCase = true) -> "audio/aac"
                    audioFile.name.endsWith(".mp3", ignoreCase = true) -> "audio/mpeg"
                    audioFile.name.endsWith(".wav", ignoreCase = true) -> "audio/wav"
                    audioFile.name.endsWith(".webm", ignoreCase = true) -> "audio/webm"
                    else -> "audio/mp4" // Default fallback
                }

                Log.d("NoteRepository", "Using MIME type: $mimeType")

                // Create request body for the file with correct MIME type
                val requestFile = audioFile.asRequestBody(mimeType.toMediaTypeOrNull())
                val audioPart = MultipartBody.Part.createFormData(
                    "audio",
                    audioFile.name,
                    requestFile
                )

                // Create request body for title
                val titleBody = title.toRequestBody("text/plain".toMediaTypeOrNull())

                // Make API call
                val response = apiService.uploadRecording(
                    token = "Bearer $token",
                    audio = audioPart,
                    noteId = null,
                    title = titleBody
                )

                if (response.isSuccessful && response.body() != null) {
                    Log.d("NoteRepository", "Recording uploaded successfully: ${response.body()?.data?.id}")
                    Result.success(response.body()!!)
                } else {
                    val errorBody = response.errorBody()?.string()
                    Log.e("NoteRepository", "Upload failed: ${response.code()} - $errorBody")
                    Result.failure(Exception(errorBody ?: "Upload failed"))
                }
            } catch (e: Exception) {
                Log.e("NoteRepository", "Exception uploading recording", e)
                Result.failure(e)
            }
        }
    }

    /**
     * Transcribe recording
     */
    suspend fun transcribeRecording(
        token: String,
        recordingId: String
    ): Result<TranscriptionResponse> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d("NoteRepository", "Transcribing recording: $recordingId")

                val response = apiService.transcribeRecording(
                    token = "Bearer $token",
                    request = mapOf("recording_id" to recordingId)
                )

                if (response.isSuccessful && response.body() != null) {
                    Log.d("NoteRepository", "Transcription successful")
                    Result.success(response.body()!!)
                } else {
                    val errorBody = response.errorBody()?.string()
                    Log.e("NoteRepository", "Transcription failed: ${response.code()} - $errorBody")
                    Result.failure(Exception(errorBody ?: "Transcription failed"))
                }
            } catch (e: Exception) {
                Log.e("NoteRepository", "Exception during transcription", e)
                Result.failure(e)
            }
        }
    }

    
    suspend fun uploadPDF(token: String, pdfFile: File, title: String? = null): Result<Note> {
        return withContext(Dispatchers.IO) {
            try {
                val requestFile = pdfFile.asRequestBody("application/pdf".toMediaTypeOrNull())
                val body = MultipartBody.Part.createFormData("file", pdfFile.name, requestFile)
                
                val titleBody = title?.toRequestBody("text/plain".toMediaTypeOrNull())
                
                val response = apiService.uploadPDF("Bearer $token", body, titleBody)
                if (response.isSuccessful && response.body()?.data != null) {
                    Result.success(response.body()!!.data!!)
                } else {
                    Result.failure(Exception("Failed to upload PDF"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
    
    suspend fun generateAIContent(
        token: String,
        noteId: String,
        contentType: String,
        options: AIOptions? = null
    ): Result<AIContentData> {
        return withContext(Dispatchers.IO) {
            try {
                val request = GenerateAIRequest(noteId, contentType, options)
                val response = when (contentType) {
                    "summary" -> apiService.generateSummary("Bearer $token", request)
                    "quiz" -> apiService.generateQuiz("Bearer $token", request)
                    "flashcards" -> apiService.generateFlashcards("Bearer $token", request)
                    "podcast" -> apiService.generatePodcast("Bearer $token", request)
                    "diagram" -> apiService.generateDiagram("Bearer $token", request)
                    else -> return@withContext Result.failure(Exception("Invalid content type"))
                }
                
                if (response.isSuccessful && response.body()?.data != null) {
                    Result.success(response.body()!!.data!!)
                } else {
                    Result.failure(Exception("Failed to generate AI content"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun startPodcastGeneration(
        token: String,
        request: GenerateAIRequest
    ): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.startPodcastGeneration("Bearer $token", request)
                if (response.isSuccessful) {
                    Result.success(Unit)
                } else {
                    Result.failure(Exception("Failed to start generation"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun getPodcastStatus(
        token: String,
        noteId: String
    ): Result<PodcastStatus> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.getPodcastStatus("Bearer $token", noteId)
                if (response.isSuccessful && response.body()?.data != null) {
                    Result.success(response.body()!!.data!!)
                } else {
                    Result.failure(Exception("Failed to get status"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    suspend fun getNoteWithAIContent(token: String, noteId: String): Result<NoteDetailResponse> {
        return withContext(Dispatchers.IO) {
            try {
                val response = apiService.getNoteWithAIContent("Bearer $token", noteId)
                if (response.isSuccessful && response.body() != null) {
                    Result.success(response.body()!!)
                } else {
                    Result.failure(Exception("Failed to fetch note with AI content"))
                }
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }


    suspend fun chatWithNote(
        token: String,
        noteId: String,
        question: String,
        conversationHistory: List<ChatMessage> = emptyList(),
        language: String = "english"
    ): Result<ChatResponse> = withContext(Dispatchers.IO) {
        try {
            val requestBody = ChatRequest(
                note_id = noteId,
                question = question,
                language = language,
                conversation_history = conversationHistory.map {
                    ChatHistoryItem(it.text, it.isUser)
                }
            )

            val response = apiService.chatWithNote("Bearer $token", requestBody)

            if (response.isSuccessful && response.body()?.data != null) {
                Result.success(response.body()!!.data!!)
            } else {
                val errorBody = response.errorBody()?.string()
                Log.e("NoteRepository", "Chat failed: ${response.code()} - $errorBody")
                Result.failure(Exception(errorBody ?: "Failed to chat with note"))
            }
        } catch (e: Exception) {
            Log.e("NoteRepository", "Error in chat", e)
            Result.failure(e)
        }
    }
}
