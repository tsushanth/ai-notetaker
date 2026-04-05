package com.kreativekoala.scribeai.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.data.models.AIContentData
import com.kreativekoala.scribeai.data.models.AIOptions
import com.kreativekoala.scribeai.data.models.GenerateAIRequest
import com.kreativekoala.scribeai.data.models.InfographicData
import com.kreativekoala.scribeai.data.repository.NoteRepository
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.ErrorReportingService
import com.kreativekoala.scribeai.utils.TutorialContent
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
    data class Success<T>(val content: T) : AIContentState()
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

    private val _infographicState = MutableStateFlow<AIContentState>(AIContentState.Idle)
    val infographicState: StateFlow<AIContentState> = _infographicState.asStateFlow()

    fun generateSummary(token: String, noteId: String, length: String = "medium", language: String = "english") {
        viewModelScope.launch {
            _summaryState.value = AIContentState.Loading

            // Use pre-generated content for tutorial note
            if (noteId == TutorialContent.TUTORIAL_ID) {
                val content = TutorialContent.createSummaryContent(length)
                _summaryState.value = AIContentState.Success(content)
                AnalyticsService.trackSummaryGenerated(noteId, content.summary?.length ?: 0)
                return@launch
            }

            val options = AIOptions(length = length, language = language)
            try {
                repository.generateAIContent(token, noteId, "summary", options).fold(
                    onSuccess = { content ->
                        _summaryState.value = AIContentState.Success(content)
                        try {
                            AnalyticsService.trackSummaryGenerated(noteId, content.summary?.length ?: 0)
                        } catch (e: Exception) {
                            Log.e("AIViewModel", "Error tracking summary analytics", e)
                        }
                    },
                    onFailure = { exception ->
                        ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_SUMMARY, exception)
                        _summaryState.value = AIContentState.Error(exception.message ?: "Failed to generate summary")
                    }
                )
            } catch (e: Exception) {
                Log.e("AIViewModel", "Unexpected error generating summary", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_SUMMARY, e)
                _summaryState.value = AIContentState.Error("Failed to generate summary. Please try again.")
            }
        }
    }

    fun generateQuiz(token: String, noteId: String, difficulty: String = "medium", numQuestions: Int = 5, language: String = "english") {
        viewModelScope.launch {
            _quizState.value = AIContentState.Loading

            // Use pre-generated content for tutorial note
            if (noteId == TutorialContent.TUTORIAL_ID) {
                val content = TutorialContent.createQuizContent()
                _quizState.value = AIContentState.Success(content)
                AnalyticsService.trackQuizGenerated(content.questions?.quizQuestions?.size ?: 0)
                return@launch
            }

            val options = AIOptions(difficulty = difficulty, numQuestions = numQuestions, language = language)
            repository.generateAIContent(token, noteId, "quiz", options).fold(
                onSuccess = { content ->
                    _quizState.value = AIContentState.Success(content)
                    AnalyticsService.trackQuizGenerated(content.questions?.quizQuestions?.size ?: 0)
                },
                onFailure = { exception ->
                    ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_QUIZ, exception)
                    _quizState.value = AIContentState.Error(exception.message ?: "Failed to generate quiz")
                }
            )
        }
    }

    fun generateFlashcards(
        token: String,
        noteId: String,
        numCards: Int = 10,
        language: String = "english"
    ) {
        viewModelScope.launch {
            _flashcardsState.value = AIContentState.Loading

            // Use pre-generated content for tutorial note
            if (noteId == TutorialContent.TUTORIAL_ID) {
                val content = TutorialContent.createFlashcardsContent()
                _flashcardsState.value = AIContentState.Success(content)
                AnalyticsService.trackFlashcardsGenerated(content.flashcards?.size ?: 0)
                return@launch
            }

            // Send both numCards and count for compatibility
            val options = AIOptions(numCards = numCards, count = numCards, language = language)
            repository.generateAIContent(token, noteId, "flashcards", options).fold(
                onSuccess = { content ->
                    _flashcardsState.value = AIContentState.Success(content)
                    AnalyticsService.trackFlashcardsGenerated(content.flashcards?.size ?: 0)
                },
                onFailure = { exception ->
                    ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_FLASHCARDS, exception)
                    _flashcardsState.value = AIContentState.Error(exception.message ?: "Failed to generate flashcards")
                }
            )
        }
    }

    fun generateInfographic(
        token: String,
        noteId: String,
        style: String = "modern",
        language: String = "english"
    ) {
        viewModelScope.launch {
            _infographicState.value = AIContentState.Loading

            val options = AIOptions(style = style, language = language)
            try {
                repository.generateInfographic(token, noteId, options).fold(
                    onSuccess = { data ->
                        _infographicState.value = AIContentState.Success(data)
                        Log.d("AIViewModel", "Infographic generated for note: $noteId, style: $style")
                    },
                    onFailure = { exception ->
                        Log.e("AIViewModel", "Failed to generate infographic", exception)
                        ErrorReportingService.reportError(
                            ErrorReportingService.UserFlow.GENERATE_INFOGRAPHIC,
                            exception,
                            "Note: $noteId, Style: $style"
                        )
                        _infographicState.value = AIContentState.Error(exception.message ?: "Failed to generate infographic")
                    }
                )
            } catch (e: Exception) {
                Log.e("AIViewModel", "Unexpected error generating infographic", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_INFOGRAPHIC, e, "Note: $noteId")
                _infographicState.value = AIContentState.Error(e.message ?: "Failed to generate infographic")
            }
        }
    }

    fun generatePodcast(
        token: String,
        noteId: String,
        generateAudio: Boolean = true,
        duration: String = "medium",
        voice: String = "nova",
        instructions: String? = null,
        language: String = "english"
    ) {
        viewModelScope.launch {
            _podcastState.value = AIContentState.Loading

            // Use pre-generated content for tutorial note (script only, no audio)
            if (noteId == TutorialContent.TUTORIAL_ID) {
                val content = TutorialContent.createPodcastContent()
                _podcastState.value = AIContentState.Success(content)
                AnalyticsService.trackPodcastGenerated(0)
                return@launch
            }

            val options = AIOptions(
                duration = duration,
                style = "conversational",
                generateAudio = generateAudio,
                voice = voice,
                instructions = instructions,
                language = language
            )

            try {
                // Start generation
                val request = GenerateAIRequest(noteId, "podcast", options)
                val startResult = repository.startPodcastGeneration(token, request)

                // Check if podcast generation started successfully
                startResult.fold(
                    onSuccess = {
                        Log.d("AIViewModel", "Podcast generation started for note: $noteId")
                    },
                    onFailure = { exception ->
                        Log.e("AIViewModel", "Failed to start podcast generation", exception)
                        ErrorReportingService.reportError(
                            ErrorReportingService.UserFlow.GENERATE_PODCAST,
                            exception,
                            "Failed to start generation for note: $noteId"
                        )
                        _podcastState.value = AIContentState.Error("Failed to start podcast generation. Please try again.")
                        return@launch
                    }
                )

                // Poll for completion every 2 seconds, up to 3 minutes (90 attempts)
                repeat(90) { attempt ->
                    delay(2000) // Wait 2 seconds

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
                                        audioUrl = status.audio_url,
                                        duration = status.duration
                                    )
                                    _podcastState.value = AIContentState.Success(content)
                                    AnalyticsService.trackPodcastGenerated(0) // Duration unknown at this point
                                    return@launch
                                }
                                "failed" -> {
                                    // Podcast generation failed on the server
                                    val errorMessage = status.message ?: "Podcast generation failed on server"
                                    Log.e("AIViewModel", "Podcast generation failed: $errorMessage")
                                    ErrorReportingService.reportError(
                                        ErrorReportingService.UserFlow.GENERATE_PODCAST,
                                        Exception(errorMessage),
                                        "Note: $noteId, Attempt: $attempt"
                                    )
                                    _podcastState.value = AIContentState.Error(errorMessage)
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
                            Log.w("AIViewModel", "Podcast status check failed, attempt: $attempt", it)
                        }
                    )
                }

                // Timeout after 3 minutes
                val timeoutError = "Podcast generation is taking longer than expected. Try loading this note again in a few minutes."
                ErrorReportingService.reportError(
                    ErrorReportingService.UserFlow.GENERATE_PODCAST,
                    Exception("Timeout after 3 minutes"),
                    "Note: $noteId"
                )
                _podcastState.value = AIContentState.Error(timeoutError)

            } catch (e: Exception) {
                Log.e("AIViewModel", "Unexpected error generating podcast", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_PODCAST, e, "Note: $noteId")
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

                        // Update states - set to Success if content exists, otherwise keep as Idle
                        // Wrap content safely to ensure proper type handling
                        _summaryState.value = summary?.let {
                            try {
                                AIContentState.Success(it.content)
                            } catch (e: Exception) {
                                Log.e("AIViewModel", "Error casting summary content", e)
                                AIContentState.Idle
                            }
                        } ?: AIContentState.Idle

                        _podcastState.value = podcast?.let {
                            try {
                                AIContentState.Success(it.content)
                            } catch (e: Exception) {
                                Log.e("AIViewModel", "Error casting podcast content", e)
                                AIContentState.Idle
                            }
                        } ?: AIContentState.Idle

                        _quizState.value = quiz?.let {
                            try {
                                AIContentState.Success(it.content)
                            } catch (e: Exception) {
                                Log.e("AIViewModel", "Error casting quiz content", e)
                                AIContentState.Idle
                            }
                        } ?: AIContentState.Idle

                        _flashcardsState.value = flashcards?.let {
                            try {
                                AIContentState.Success(it.content)
                            } catch (e: Exception) {
                                Log.e("AIViewModel", "Error casting flashcards content", e)
                                AIContentState.Idle
                            }
                        } ?: AIContentState.Idle

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
            try {
                repository.generateAIContent(token, noteId, "diagram", options).fold(
                    onSuccess = { content ->
                        _diagramState.value = AIContentState.Success(content)
                    },
                    onFailure = { exception ->
                        Log.e("AIViewModel", "Failed to generate diagram", exception)
                        ErrorReportingService.reportError(
                            ErrorReportingService.UserFlow.GENERATE_DIAGRAM,
                            exception,
                            "Note: $noteId, Style: $style"
                        )
                        _diagramState.value = AIContentState.Error(exception.message ?: "Failed to generate diagram")
                    }
                )
            } catch (e: Exception) {
                Log.e("AIViewModel", "Unexpected error generating diagram", e)
                ErrorReportingService.reportError(ErrorReportingService.UserFlow.GENERATE_DIAGRAM, e, "Note: $noteId")
                _diagramState.value = AIContentState.Error(e.message ?: "Failed to generate diagram")
            }
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
                    AnalyticsService.trackChatMessageSent(noteId, question.length)
                    AnalyticsService.trackChatUsed()
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
            "infographic" -> _infographicState.value = AIContentState.Idle
        }
    }

    /**
     * Reset all AI content states when switching to a different note.
     * This prevents showing stale content from the previous note.
     */
    fun resetAllStates() {
        _summaryState.value = AIContentState.Idle
        _quizState.value = AIContentState.Idle
        _flashcardsState.value = AIContentState.Idle
        _podcastState.value = AIContentState.Idle
        _diagramState.value = AIContentState.Idle
        _infographicState.value = AIContentState.Idle
    }
}

data class ChatMessage(
    val id: String = System.currentTimeMillis().toString(),
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)