package com.kreativekoala.scribeai.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.data.models.AIContentData
import com.kreativekoala.scribeai.data.models.AIOptions
import com.kreativekoala.scribeai.data.models.GenerateAIRequest
import com.kreativekoala.scribeai.data.repository.NoteRepository
import com.kreativekoala.scribeai.utils.ErrorReportingService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

sealed class AIContentState {
    object Idle : AIContentState()
    object Loading : AIContentState()
    data class Success(val content: AIContentData) : AIContentState()
    data class Error(val message: String) : AIContentState()
}

class AIViewModel : ViewModel() {

    private val repository = NoteRepository()

    private val _summaryState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val summaryState: StateFlow<AIContentState> = _summaryState.asStateFlow()

    private val _quizState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val quizState: StateFlow<AIContentState> = _quizState.asStateFlow()

    private val _flashcardsState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val flashcardsState: StateFlow<AIContentState> = _flashcardsState.asStateFlow()

    private val _podcastState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val podcastState: StateFlow<AIContentState> = _podcastState.asStateFlow()

    private val _diagramState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val diagramState: StateFlow<AIContentState> = _diagramState.asStateFlow()

    fun generateSummary(token: String, noteId: String, length: String = "medium", language: String = "english") {
        viewModelScope.launch {
            _summaryState.value = AIContentState.Loading
            val options = AIOptions(length = length, language = language)
            repository.generateAIContent(token, noteId, "summary", options).fold(
                onSuccess = { content ->
                    _summaryState.value = AIContentState.Success(content)
                },
                onFailure = { exception ->
                    ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_SUMMARY, exception)
                    _summaryState.value = AIContentState.Error(exception.message ?: "Failed to generate summary")
                }
            )
        }
    }

    fun generateQuiz(token: String, noteId: String, difficulty: String = "medium", numQuestions: Int = 5, language: String = "english") {
        viewModelScope.launch {
            _quizState.value = AIContentState.Loading
            val options = AIOptions(difficulty = difficulty, numQuestions = numQuestions, language = language)
            repository.generateAIContent(token, noteId, "quiz", options).fold(
                onSuccess = { content ->
                    _quizState.value = AIContentState.Success(content)
                },
                onFailure = { exception ->
                    ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_QUIZ, exception)
                    _quizState.value = AIContentState.Error(exception.message ?: "Failed to generate quiz")
                }
            )
        }
    }

    fun generateFlashcards(token: String, noteId: String, numCards: Int = 10, language: String = "english") {
        viewModelScope.launch {
            _flashcardsState.value = AIContentState.Loading
            val options = AIOptions(numCards = numCards, language = language)
            repository.generateAIContent(token, noteId, "flashcards", options).fold(
                onSuccess = { content ->
                    _flashcardsState.value = AIContentState.Success(content)
                },
                onFailure = { exception ->
                    ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_FLASHCARDS, exception)
                    _flashcardsState.value = AIContentState.Error(exception.message ?: "Failed to generate flashcards")
                }
            )
        }
    }

    fun generatePodcast(token: String, noteId: String, generateAudio: Boolean = true, language: String = "english") {
        viewModelScope.launch {
            _podcastState.value = AIContentState.Loading

            val options = AIOptions(
                length = "medium",
                style = "conversational",
                generateAudio = generateAudio,
                language = language
            )

            try {
                // Start generation
                val request = GenerateAIRequest(noteId, "podcast", options)
                repository.startPodcastGeneration(token, request)

                // Poll for completion every 5 seconds, up to 2 minutes
                repeat(24) { attempt ->
                    delay(5000) // Wait 5 seconds

                    val statusResult = repository.getPodcastStatus(token, noteId)
                    statusResult.fold(
                        onSuccess = { status ->
                            when (status.status) {
                                "ready" -> {
                                    // Convert to AIContentData
                                    val content = AIContentData(
                                        id = status.id ?: "",
                                        noteId = status.note_id ?: noteId,
                                        script = status.script,
                                        audioUrl = status.audio_url
                                    )
                                    _podcastState.value = AIContentState.Success(content)
                                    return@launch
                                }
                                "generating" -> {
                                    // Continue polling
                                }
                                "not_found" -> {
                                    // Continue polling (might not be saved yet)
                                }
                            }
                        },
                        onFailure = {
                            // Continue polling on error
                        }
                    )
                }

                // Timeout after 2 minutes
                _podcastState.value = AIContentState.Error("Generation is taking longer than expected. Please try again.")

            } catch (e: Exception) {
                _podcastState.value = AIContentState.Error(e.message ?: "Failed to start podcast generation")
            }
        }
    }

    /**
     * Load existing AI content for a note
     */
    fun loadExistingContent(token: String, noteId: String) {
        viewModelScope.launch {
            try {
                val result = repository.getNoteWithAIContent(token, noteId)
                result.fold(
                    onSuccess = { noteDetail ->
                        // Extract AI content from the note detail
                        val aiContentList = noteDetail.data?.aiContent ?: emptyList()

                        // Group by content type and load the most recent of each
                        val summary = aiContentList
                            .filter { it.contentType == "summary" }
                            .maxByOrNull { it.createdAt }

                        val podcast = aiContentList
                            .filter { it.contentType == "podcast" }
                            .maxByOrNull { it.createdAt }

                        val quiz = aiContentList
                            .filter { it.contentType == "quiz" }
                            .maxByOrNull { it.createdAt }

                        val flashcards = aiContentList
                            .filter { it.contentType == "flashcards" }
                            .maxByOrNull { it.createdAt }

                        // Update states
                        summary?.let {
                            _summaryState.value = AIContentState.Success(it.content)
                        }

                        podcast?.let {
                            _podcastState.value = AIContentState.Success(it.content)
                        }

                        quiz?.let {
                            _quizState.value = AIContentState.Success(it.content)
                        }

                        flashcards?.let {
                            _flashcardsState.value = AIContentState.Success(it.content)
                        }
                    },
                    onFailure = {
                        // Silently fail - just means no content exists yet
                        Log.e("AIViewModel", "Failed to load AI content", it)
                    }
                )
            } catch (e: Exception) {
                Log.e("AIViewModel", "Error loading AI content", e)
            }
        }
    }

    fun generateDiagram(token: String, noteId: String, style: String = "flowchart", language: String = "english") {
        viewModelScope.launch {
            _diagramState.value = AIContentState.Loading
            val options = AIOptions(style = style, language = language)
            repository.generateAIContent(token, noteId, "diagram", options).fold(
                onSuccess = { content ->
                    _diagramState.value = AIContentState.Success(content)
                },
                onFailure = { exception ->
                    _diagramState.value = AIContentState.Error(exception.message ?: "Failed to generate diagram")
                }
            )
        }
    }

    /**
     * Chat with note content
     * Returns the AI's response as a string
     */
    suspend fun chatWithNote(
        authToken: String,
        noteId: String,
        question: String,
        conversationHistory: List<ChatMessage> = emptyList(),
        language: String = "english"
    ): String = withContext(Dispatchers.IO) {
        try {
            val result = repository.chatWithNote(authToken, noteId, question, conversationHistory, language)
            result.fold(
                onSuccess = { response ->
                    response.answer
                },
                onFailure = { exception ->
                    throw exception
                }
            )
        } catch (e: Exception) {
            Log.e("AIViewModel", "Error in chat", e)
            throw e
        }
    }

    fun resetState(contentType: String) {
        when (contentType) {
            "summary" -> _summaryState.value = AIContentState.Idle
            "quiz" -> _quizState.value = AIContentState.Idle
            "flashcards" -> _flashcardsState.value = AIContentState.Idle
            "podcast" -> _podcastState.value = AIContentState.Idle
            "diagram" -> _diagramState.value = AIContentState.Idle
        }
    }
}

data class ChatMessage(
    val id: String = System.currentTimeMillis().toString(),
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)