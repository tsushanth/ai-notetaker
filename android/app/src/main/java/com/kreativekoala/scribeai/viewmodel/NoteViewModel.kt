package com.kreativekoala.scribeai.viewmodel

import android.content.ContentValues.TAG
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.data.local.NoteCacheRepository as LocalNoteRepository
import com.kreativekoala.scribeai.data.local.toNote
import com.kreativekoala.scribeai.data.models.*
import com.kreativekoala.scribeai.data.repository.NoteRepository
import com.kreativekoala.scribeai.utils.ErrorReportingService
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.utils.UserIdHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

sealed class NoteUiState {
    object Loading : NoteUiState()
    data class Success(
        val notes: List<Note>,
        val hasMoreNotes: Boolean = false,
        val totalNotes: Int = 0
    ) : NoteUiState()
    data class Error(val message: String) : NoteUiState()
}

sealed class NoteDetailState {
    object Loading : NoteDetailState()
    data class Success(val note: Note) : NoteDetailState()
    data class Error(val message: String) : NoteDetailState()
}

sealed class UploadState {
    object Idle : UploadState()
    object Loading : UploadState()
    object Success : UploadState()
    data class Error(val message: String) : UploadState()
}

class NoteViewModel(
    private val localRepository: LocalNoteRepository,
    private val subscriptionManager: SubscriptionManager
) : ViewModel() {

    companion object {
        const val FREE_NOTE_LIMIT = 1 // User can create 1 free notebook (0-indexed)
    }

    private val repository = NoteRepository()

    private val _uiState = MutableStateFlow<NoteUiState>(NoteUiState.Loading)
    val uiState: StateFlow<NoteUiState> = _uiState.asStateFlow()

    private val _noteDetailState = MutableStateFlow<NoteDetailState>(NoteDetailState.Loading)
    val noteDetailState: StateFlow<NoteDetailState> = _noteDetailState.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()

    private val _uploadState = MutableStateFlow<UploadState>(UploadState.Idle)
    val uploadState: StateFlow<UploadState> = _uploadState.asStateFlow()

    // Pagination state
    private var currentPage = 1
    private val pageSize = 20
    private var hasMoreNotes = true
    private var totalNotes = 0

    private val _shouldShowPaywall = MutableStateFlow(false)
    val shouldShowPaywall: StateFlow<Boolean> = _shouldShowPaywall.asStateFlow()

    private val client = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val baseUrl = "https://ai-notetaker-backend-917362189743.us-central1.run.app"

    private val _currentNote = MutableStateFlow<Note?>(null)
    val currentNote: StateFlow<Note?> = _currentNote.asStateFlow()

    private var currentUserId: String? = null

    /**
     * Load notes from cache first, then fetch from server if needed
     */
    fun loadNotes(token: String, page: Int = 1, forceRefresh: Boolean = false) {
        Log.d(TAG, "🔴 loadNotes() CALLED - forceRefresh: $forceRefresh")
        Log.d(TAG, "🔴 Call stack: ${Thread.currentThread().stackTrace.take(10).joinToString("\n")}")

        viewModelScope.launch {
            try {
                val userId = extractUserId(token)
                currentUserId = userId

                if (!forceRefresh) {
                    // Load from cache first for instant display
                    try {
                        val cachedNotes = localRepository.getAllNotes(userId).firstOrNull() ?: emptyList()
                        if (cachedNotes.isNotEmpty()) {
                            _uiState.value = NoteUiState.Success(
                                cachedNotes.map { it.toNote() }
                            )
                            Log.d(TAG, "📦 Loaded ${cachedNotes.size} notes from cache")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error loading from cache", e)
                    }
                }

                // Then fetch from server in background
                fetchNotesFromServer(token, userId, page)

            } catch (e: Exception) {
                Log.e(TAG, "Error loading notes", e)
                _uiState.value = NoteUiState.Error(e.message ?: "Failed to load notes")
            }
        }
    }

    /**
     * Fetch notes from server and update cache
     */
    private suspend fun fetchNotesFromServer(token: String, userId: String, page: Int) {
        try {
            _isRefreshing.value = true

            repository.getNotes(token, page, pageSize).fold(
                onSuccess = { response ->
                    val serverNotes = response.data ?: emptyList()

                    // Update pagination state
                    hasMoreNotes = response.pagination?.hasMore ?: false
                    totalNotes = response.pagination?.total ?: serverNotes.size
                    currentPage = response.pagination?.page ?: 1

                    // Get existing local-only notes (tutorial) BEFORE caching
                    val cachedNotes = localRepository.getAllNotes(userId).firstOrNull() ?: emptyList()
                    val tutorialNotes = cachedNotes.filter { it.id.startsWith("tutorial_") }

                    // Update cache with server notes only
                    localRepository.cacheNotes(userId, serverNotes)

                    // Merge tutorial notes with server notes for display
                    val allNotes = (tutorialNotes.map { it.toNote() } + serverNotes)
                        .distinctBy { it.id }
                        .sortedByDescending { it.createdAt }

                    // Update UI with merged list and pagination info
                    _uiState.value = NoteUiState.Success(
                        notes = allNotes,
                        hasMoreNotes = hasMoreNotes,
                        totalNotes = totalNotes
                    )

                    Log.d(TAG, "✅ Fetched ${serverNotes.size} server notes + ${tutorialNotes.size} tutorial notes (total: $totalNotes, hasMore: $hasMoreNotes)")
                },
                onFailure = { exception ->
                    Log.e(TAG, "Error fetching from server", exception)

                    val errorMessage = exception.message?.lowercase() ?: ""
                    val isEmptyStateError = errorMessage.contains("no notes") ||
                            errorMessage.contains("not found") ||
                            errorMessage.contains("empty") ||
                            errorMessage.contains("404")

                    val isNetworkError = errorMessage.contains("unable to resolve host") ||
                            errorMessage.contains("failed to connect") ||
                            errorMessage.contains("timeout") ||
                            errorMessage.contains("network error") ||
                            errorMessage.contains("connection failed")

                    when {
                        isEmptyStateError -> {
                            hasMoreNotes = false
                            totalNotes = 0
                            _uiState.value = NoteUiState.Success(emptyList(), hasMoreNotes = false, totalNotes = 0)
                            Log.d(TAG, "✅ User has no notes yet (showing empty state)")
                        }
                        isNetworkError && _uiState.value is NoteUiState.Success -> {
                            Log.w(TAG, "⚠️ Network error but keeping cached data visible")
                        }
                        _uiState.value is NoteUiState.Loading -> {
                            _uiState.value = NoteUiState.Error(exception.message ?: "Failed to fetch notes")
                        }
                        else -> {
                            Log.w(TAG, "⚠️ Error occurred but keeping current state")
                        }
                    }
                }
            )
        } finally {
            _isRefreshing.value = false
        }
    }

    /**
     * Load more notes (pagination)
     */
    fun loadMoreNotes(token: String) {
        if (!hasMoreNotes || _isLoadingMore.value || _isRefreshing.value) {
            Log.d(TAG, "⏭️ Skipping loadMoreNotes - hasMore: $hasMoreNotes, isLoadingMore: ${_isLoadingMore.value}")
            return
        }

        viewModelScope.launch {
            try {
                _isLoadingMore.value = true
                val nextPage = currentPage + 1

                Log.d(TAG, "📄 Loading more notes - page: $nextPage")

                repository.getNotes(token, nextPage, pageSize).fold(
                    onSuccess = { response ->
                        val newNotes = response.data ?: emptyList()

                        // Update pagination state
                        hasMoreNotes = response.pagination?.hasMore ?: false
                        totalNotes = response.pagination?.total ?: totalNotes
                        currentPage = nextPage

                        // Get current notes and append new ones (avoiding duplicates)
                        val currentState = _uiState.value
                        if (currentState is NoteUiState.Success) {
                            val existingIds = currentState.notes.map { it.id }.toSet()
                            val filteredNewNotes = newNotes.filter { it.id !in existingIds }
                            val allNotes = currentState.notes + filteredNewNotes

                            _uiState.value = NoteUiState.Success(
                                notes = allNotes,
                                hasMoreNotes = hasMoreNotes,
                                totalNotes = totalNotes
                            )

                            Log.d(TAG, "✅ Loaded ${filteredNewNotes.size} more notes (page $nextPage, total: ${allNotes.size})")
                        }
                    },
                    onFailure = { exception ->
                        Log.e(TAG, "❌ Failed to load more notes", exception)
                        // Don't change UI state, just log the error
                    }
                )
            } finally {
                _isLoadingMore.value = false
            }
        }
    }

    /**
     * Load single note by ID (with cache)
     */
    fun loadNoteById(token: String, noteId: String) {
        // Set loading immediately (before launching coroutine) to prevent stale data flash
        _noteDetailState.value = NoteDetailState.Loading

        viewModelScope.launch {
            try {
                Log.d(TAG, "Loading note: $noteId")

                // Try cache first - only for THIS note ID
                val cachedNote = localRepository.getNoteById(noteId)
                if (cachedNote != null) {
                    _currentNote.value = cachedNote
                    _noteDetailState.value = NoteDetailState.Success(cachedNote)
                    Log.d(TAG, "📦 Loaded note from cache: ${cachedNote.id}")
                    Log.d(TAG, "📦 Cache - hasFormattedContent: ${cachedNote.hasFormattedContent}, formattingStatus: ${cachedNote.formattingStatus}, formattedContent length: ${cachedNote.formattedContent?.length ?: 0}")
                }

                // Fetch fresh data from server
                repository.getNote(token, noteId).fold(
                    onSuccess = { note ->
                        // Update cache
                        val userId = extractUserId(token)
                        localRepository.addNote(userId, note)

                        _currentNote.value = note
                        _noteDetailState.value = NoteDetailState.Success(note)
                        Log.d(TAG, "✅ Note loaded from server: ${note.id} - ${note.title}")
                        Log.d(TAG, "✅ Server - hasFormattedContent: ${note.hasFormattedContent}, formattingStatus: ${note.formattingStatus}, formattedContent length: ${note.formattedContent?.length ?: 0}")
                    },
                    onFailure = { exception ->
                        // If we have cached data, keep showing it
                        if (cachedNote == null) {
                            val error = exception.message ?: "Failed to load note"
                            _noteDetailState.value = NoteDetailState.Error(error)
                            Log.e(TAG, "❌ Error loading note: $error")
                        } else {
                            Log.w(TAG, "⚠️ Failed to fetch fresh data, using cache")
                        }
                    }
                )
            } catch (e: Exception) {
                val error = e.message ?: "Unknown error"
                _noteDetailState.value = NoteDetailState.Error(error)
                Log.e(TAG, "❌ Error loading note", e)
            }
        }
    }

    /**
     * Check if user can create a new note
     * Returns true if allowed, false if paywall should be shown
     */
    suspend fun canCreateNote(userId: String): Boolean {
        // Check if user is subscribed
        if (subscriptionManager.isSubscribed()) {
            return true
        }

        // Check note count for free users
        val noteCount = localRepository.getNoteCount(userId)
        Log.d(TAG, "📊 Free user has $noteCount notebooks (limit: ${FREE_NOTE_LIMIT + 1})")
        return noteCount <= FREE_NOTE_LIMIT
    }

    /**
     * Check and show paywall if needed before creating note
     */
    suspend fun checkPaywallBeforeCreate(userId: String): Boolean {
        return if (canCreateNote(userId)) {
            true
        } else {
            _shouldShowPaywall.value = true
            false
        }
    }

    /**
     * Dismiss paywall
     */
    fun dismissPaywall() {
        _shouldShowPaywall.value = false
    }

    /**
     * Get note count (for UI display)
     */
    suspend fun getNoteCount(userId: String): Int {
        return localRepository.getNoteCount(userId)
    }

    /**
     * Upload a scanned document with OCR extracted text
     */
    fun uploadScannedDocument(
        pdfFile: File,
        extractedText: String,
        authToken: String,
        onSuccess: (Note) -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val userId = extractUserId(authToken)

                // Check paywall
                if (!checkPaywallBeforeCreate(userId)) {
                    withContext(Dispatchers.Main) {
                        onError("Please upgrade to create more notebooks")
                    }
                    return@launch
                }

                Log.d(TAG, "Uploading scanned document: ${pdfFile.name}")
                _uploadState.value = UploadState.Loading

                val cleanToken = authToken.removePrefix("Bearer ").trim()

                // Validate token format
                val tokenParts = cleanToken.split(".")
                if (tokenParts.size != 3) {
                    withContext(Dispatchers.Main) {
                        _uploadState.value = UploadState.Error("Invalid token format")
                        onError("Invalid token format")
                    }
                    return@launch
                }

                // Create multipart request body
                val requestBody = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(
                        "file",
                        pdfFile.name,
                        pdfFile.asRequestBody("application/pdf".toMediaTypeOrNull())
                    )
                    .addFormDataPart("extractedText", extractedText)
                    .addFormDataPart("sourceType", "scan")
                    .build()

                val request = Request.Builder()
                    .url("$baseUrl/api/uploads/scan")
                    .post(requestBody)
                    .addHeader("Authorization", "Bearer $cleanToken")
                    .build()

                Log.d(TAG, "Making request to: ${request.url}")
                Log.d(TAG, "File size: ${pdfFile.length()} bytes")

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d(TAG, "Response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorMessage = try {
                        val errorJson = JSONObject(responseBody ?: "{}")
                        errorJson.optString("error", "Failed to upload scanned document")
                    } catch (e: Exception) {
                        "Failed to upload scanned document (${response.code})"
                    }

                    Log.e(TAG, "Upload failed: $errorMessage")
                    withContext(Dispatchers.Main) {
                        _uploadState.value = UploadState.Error(errorMessage)
                        onError(errorMessage)
                    }
                    return@launch
                }

                // Parse successful response
                val responseJson = JSONObject(responseBody ?: "{}")
                val noteJson = responseJson.optJSONObject("note")

                if (noteJson != null) {
                    val note = Note(
                        id = noteJson.optString("id", ""),
                        userId = noteJson.optString("userId", ""),
                        title = noteJson.optString("title", "Scanned Document"),
                        content = noteJson.optString("content", ""),
                        sourceType = noteJson.optString("sourceType", "scan"),
                        createdAt = noteJson.optString("createdAt", ""),
                        updatedAt = noteJson.optString("updatedAt", "")
                    )

                    // Add to cache
                    localRepository.addNote(userId, note)

                    Log.d(TAG, "✅ Scanned document uploaded successfully")
                    withContext(Dispatchers.Main) {
                        _uploadState.value = UploadState.Success
                        onSuccess(note)
                        loadNotes(authToken)
                    }
                } else {
                    val note = Note(
                        id = responseJson.optString("noteId", ""),
                        userId = "",
                        title = "Scanned Document",
                        content = extractedText,
                        sourceType = "scan",
                        createdAt = "",
                        updatedAt = ""
                    )

                    localRepository.addNote(userId, note)

                    withContext(Dispatchers.Main) {
                        _uploadState.value = UploadState.Success
                        onSuccess(note)
                        loadNotes(authToken)
                    }
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error uploading scanned document", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.SCAN_DOCUMENT, e)
                withContext(Dispatchers.Main) {
                    val errorMessage = e.message ?: "Unknown error occurred"
                    _uploadState.value = UploadState.Error(errorMessage)
                    onError(errorMessage)
                }
            }
        }
    }

    /**
     * Process YouTube video URL
     */
    fun processVideoUrl(
        token: String,
        url: String,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val userId = extractUserId(token)

                // Check paywall
                if (!checkPaywallBeforeCreate(userId)) {
                    withContext(Dispatchers.Main) {
                        onError("Please upgrade to create more notebooks")
                    }
                    return@launch
                }

                Log.d(TAG, "Processing video URL: $url")

                val cleanToken = token.removePrefix("Bearer ").trim()

                // Validate token format
                val tokenParts = cleanToken.split(".")
                if (tokenParts.size != 3) {
                    withContext(Dispatchers.Main) {
                        onError("Invalid token format")
                    }
                    return@launch
                }

                // Create request body
                val json = JSONObject().apply {
                    put("url", url)
                }

                val requestBody = json.toString()
                    .toRequestBody("application/json; charset=utf-8".toMediaType())

                val request = Request.Builder()
                    .url("$baseUrl/api/uploads/video-url")
                    .post(requestBody)
                    .addHeader("Authorization", "Bearer $cleanToken")
                    .addHeader("Content-Type", "application/json")
                    .build()

                Log.d(TAG, "Making request to: ${request.url}")

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d(TAG, "Response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorMessage = try {
                        val errorJson = JSONObject(responseBody ?: "{}")
                        errorJson.optString("error", "Failed to process video")
                    } catch (e: Exception) {
                        "Failed to process video (${response.code})"
                    }

                    Log.e(TAG, "Request failed: $errorMessage")
                    withContext(Dispatchers.Main) {
                        onError(errorMessage)
                    }
                    return@launch
                }

                Log.d(TAG, "✅ Video processed successfully")
                withContext(Dispatchers.Main) {
                    onSuccess()
                    loadNotes(token)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error processing video", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.YOUTUBE_LINK, e)
                withContext(Dispatchers.Main) {
                    onError(e.message ?: "Unknown error occurred")
                }
            }
        }
    }

    /**
     * Upload PDF
     */
    fun uploadPDF(
        token: String,
        pdfFile: File,
        title: String? = null,
        onSuccess: (Note) -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            try {
                val userId = extractUserId(token)

                // Check paywall
                if (!checkPaywallBeforeCreate(userId)) {
                    onError("Please upgrade to create more notebooks")
                    return@launch
                }

                repository.uploadPDF(token, pdfFile, title).fold(
                    onSuccess = { note ->
                        // Add to cache
                        viewModelScope.launch {
                            localRepository.addNote(userId, note)
                        }

                        onSuccess(note)
                        loadNotes(token)
                    },
                    onFailure = { exception ->
                        ErrorReportingService.reportError(ErrorReportingService.UserFlow.UPLOAD_PDF, exception)
                        onError(exception.message ?: "Failed to upload PDF")
                    }
                )
            } catch (e: Exception) {
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.UPLOAD_PDF, e)
                onError(e.message ?: "Error uploading PDF")
            }
        }
    }

    /**
     * Upload and transcribe audio recording
     */
    fun uploadAudio(
        token: String,
        audioFile: File,
        title: String,
        onSuccess: (Note) -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            try {
                val userId = extractUserId(token)

                // Check paywall
                if (!checkPaywallBeforeCreate(userId)) {
                    onError("Please upgrade to create more notebooks")
                    return@launch
                }

                Log.d(TAG, "📤 Step 1: Uploading audio: ${audioFile.name}, size: ${audioFile.length()} bytes")

                if (!audioFile.exists()) {
                    Log.e(TAG, "❌ Audio file doesn't exist: ${audioFile.absolutePath}")
                    onError("Audio file not found")
                    return@launch
                }

                if (audioFile.length() == 0L) {
                    Log.e(TAG, "❌ Audio file is empty")
                    onError("Audio file is empty")
                    return@launch
                }

                // Step 1: Upload the recording
                val uploadResult = repository.uploadRecording(token, audioFile, title)

                uploadResult.fold(
                    onSuccess = { uploadResponse ->
                        if (uploadResponse.success && uploadResponse.data != null) {
                            val recording = uploadResponse.data
                            Log.d(TAG, "✅ Step 1 complete: Audio uploaded, recording_id: ${recording.id}")

                            // Step 2: Transcribe the recording
                            val transcribeResult = repository.transcribeRecording(token, recording.id)

                            transcribeResult.fold(
                                onSuccess = { transcriptionResponse ->
                                    if (transcriptionResponse.success && transcriptionResponse.data != null) {
                                        val transcription = transcriptionResponse.data
                                        Log.d(TAG, "✅ Step 2 complete: Transcription successful")

                                        // Check if a note was created/linked
                                        if (!transcription.noteId.isNullOrEmpty()) {
                                            // Step 3: Load the note
                                            repository.getNote(token, transcription.noteId).fold(
                                                onSuccess = { note ->
                                                    // Add to cache
                                                    viewModelScope.launch {
                                                        localRepository.addNote(userId, note)
                                                    }

                                                    Log.d(TAG, "✅ Note loaded: ${note.id}")
                                                    _currentNote.value = note
                                                    loadNotes(token)
                                                    onSuccess(note)
                                                },
                                                onFailure = { error ->
                                                    Log.e(TAG, "❌ Failed to load note: ${error.message}", error)
                                                    onError("Transcription completed but failed to load note: ${error.message}")
                                                }
                                            )
                                        } else {
                                            Log.w(TAG, "⚠️ No note_id returned from transcription")
                                            onError("Transcription completed but no note was created")
                                        }
                                    } else {
                                        val errorMsg = transcriptionResponse.error ?: "Transcription failed"
                                        Log.e(TAG, "❌ $errorMsg")
                                        onError(errorMsg)
                                    }
                                },
                                onFailure = { error ->
                                    val errorMsg = error.message ?: "Transcription failed"
                                    Log.e(TAG, "❌ Transcription failed: $errorMsg", error)
                                    onError("Upload successful but transcription failed: $errorMsg")
                                }
                            )
                        } else {
                            val errorMsg = uploadResponse.error ?: "Upload failed: No data returned"
                            Log.e(TAG, "❌ $errorMsg")
                            onError(errorMsg)
                        }
                    },
                    onFailure = { error ->
                        val errorMsg = error.message ?: "Unknown error occurred"
                        Log.e(TAG, "❌ Audio upload failed: $errorMsg", error)
                        ErrorReportingService.reportError(ErrorReportingService.UserFlow.RECORD_AUDIO, error)
                        onError(errorMsg)
                    }
                )
            } catch (e: Exception) {
                val errorMsg = "Error uploading audio: ${e.message}"
                Log.e(TAG, "❌ Exception during audio upload", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.RECORD_AUDIO, e)
                onError(errorMsg)
            }
        }
    }

    /**
     * Create note
     */
    fun createNote(
        token: String,
        request: CreateNoteRequest,
        onSuccess: (Note) -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            try {
                val userId = extractUserId(token)

                // Check paywall
                if (!checkPaywallBeforeCreate(userId)) {
                    onError("Please upgrade to create more notebooks")
                    return@launch
                }

                repository.createNote(token, request).fold(
                    onSuccess = { note ->
                        // Add to cache immediately (optimistic)
                        viewModelScope.launch {
                            localRepository.addNote(userId, note)
                        }

                        onSuccess(note)
                        loadNotes(token)
                    },
                    onFailure = { exception ->
                        onError(exception.message ?: "Failed to create note")
                    }
                )
            } catch (e: Exception) {
                onError(e.message ?: "Error creating note")
            }
        }
    }

    /**
     * Delete note
     */
    fun deleteNote(
        token: String,
        noteId: String,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            try {
                // Delete from cache immediately
                localRepository.deleteNote(noteId)

                // Delete from server
                repository.deleteNote(token, noteId).fold(
                    onSuccess = {
                        Log.d(TAG, "✅ Note deleted from server")
                        onSuccess()
                        loadNotes(token)
                    },
                    onFailure = { exception ->
                        Log.e(TAG, "Failed to delete from server", exception)
                        onError(exception.message ?: "Failed to delete note")
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error deleting note", e)
                onError(e.message ?: "Failed to delete note")
            }
        }
    }

    /**
     * Load note detail (existing method for compatibility)
     */
    fun loadNoteDetail(token: String, noteId: String) {
        loadNoteById(token, noteId)
    }

    /**
     * Update note title
     */
    fun updateNoteTitle(
        token: String,
        noteId: String,
        newTitle: String,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        viewModelScope.launch {
            try {
                repository.updateNote(token, noteId, UpdateNoteRequest(title = newTitle)).fold(
                    onSuccess = { updatedNote ->
                        Log.d(TAG, "✅ Note title updated")
                        // Update local cache
                        localRepository.updateNoteTitle(noteId, newTitle)
                        // Update current note state
                        _noteDetailState.value = NoteDetailState.Success(updatedNote)
                        onSuccess()
                    },
                    onFailure = { exception ->
                        Log.e(TAG, "Failed to update note title", exception)
                        onError(exception.message ?: "Failed to update title")
                    }
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error updating note title", e)
                onError(e.message ?: "Failed to update title")
            }
        }
    }

    /**
     * Refresh notes (pull-to-refresh)
     */
    fun refreshNotes(token: String) {
        loadNotes(token, forceRefresh = true)
    }

    /**
     * Reset upload state
     */
    fun resetUploadState() {
        _uploadState.value = UploadState.Idle
    }

    /**
     * Clear cache on logout
     */
    fun clearCache(userId: String) {
        viewModelScope.launch {
            Log.d(TAG, "🗑️ Clearing cache for user: $userId")
            localRepository.clearCache(userId)
            _uiState.value = NoteUiState.Loading  // Reset to loading state
            _currentNote.value = null
            currentUserId = null
        }
    }

    /**
     * Extract user ID from token (simple implementation)
     * In production, decode JWT properly
     */
    private fun extractUserId(token: String): String {
        return UserIdHelper.extractUserIdFromToken(token)
    }
}

/**
 * Factory for creating NoteViewModel with dependencies
 */
class NoteViewModelFactory(
    private val localRepository: LocalNoteRepository,
    private val subscriptionManager: SubscriptionManager
) : androidx.lifecycle.ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(NoteViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return NoteViewModel(localRepository, subscriptionManager) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}