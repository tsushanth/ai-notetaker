package com.kreativekoala.scribeai.data.models
import com.google.gson.annotations.JsonAdapter
import com.google.gson.annotations.SerializedName

data class AIContent(
    @SerializedName("id")
    val id: String,

    @SerializedName("note_id")
    val noteId: String,

    @SerializedName("content_type")
    val contentType: String,

    @SerializedName("content")
    val content: Map<String, Any>,

    @SerializedName("created_at")
    val createdAt: String
)

data class GenerateAIRequest(
    @SerializedName("note_id")
    val noteId: String,

    @SerializedName("content_type")
    val contentType: String,

    val options: AIOptions? = null
)

data class AIOptions(
    val length: String? = null,
    val difficulty: String? = null,
    @SerializedName("num_questions")
    val numQuestions: Int? = null,
    @SerializedName("num_cards")
    val numCards: Int? = null,
    val style: String? = null,
    val generateAudio: Boolean? = null,
    val language: String? = null
)

data class AIContentResponse(
    val success: Boolean,
    val data: AIContentData? = null,
    val error: String? = null
)

data class PodcastStatusResponse(
    val success: Boolean,
    val data: PodcastStatus? = null
)

data class PodcastStatus(
    val status: String, // "generating", "ready", "not_found"
    val message: String? = null,
    val id: String? = null,
    val audio_url: String? = null,
    val script: String? = null,
    val duration: String? = null,
    val style: String? = null,
    val note_id: String? = null
)

data class AIContentListResponse(
    val success: Boolean,
    val data: List<AIContentItem>? = null
)

data class AIContentItem(
    val id: String,
    @SerializedName("content")
    val content: AIContentData,
    @SerializedName("content_type")
    val contentType: String,
    @SerializedName("note_id")
    val noteId: String? = null,
    @SerializedName("created_at")
    val createdAt: String
)

data class NoteDetailResponse(
    val success: Boolean,
    val data: NoteDetailData? = null
)

data class ChatApiResponse(
    val success: Boolean,
    val data: ChatResponse?
)

data class NoteDetailData(
    val id: String,
    @SerializedName("user_id")
    val userId: String,
    val title: String,
    val content: String,
    @SerializedName("source_type")
    val sourceType: String? = null,
    @SerializedName("source_url")
    val sourceUrl: String? = null,
    val metadata: Map<String, Any>? = null,
    @SerializedName("created_at")
    val createdAt: String,
    @SerializedName("updated_at")
    val updatedAt: String,
    val recordings: List<Any>? = null,
    @SerializedName("ai_content")
    val aiContent: List<AIContentItem>? = null  // ← This is the key field!
)

data class AIContentData(
    val id: String? = null,
    @SerializedName("note_id")
    val noteId: String? = null,
    val summary: String? = null,
    @JsonAdapter(FlexibleQuizQuestionAdapter::class)
    val questions: QuizQuestionsWrapper? = null,
    val flashcards: List<Flashcard>? = null,
    val script: String? = null,
    @SerializedName("audio_url")
    val audioUrl: String? = null,
    val duration: String? = null,
    val style: String? = null,
    val diagram: String? = null,
    val difficulty: String? = null,
    @SerializedName("num_questions")
    val numQuestions: Int? = null,
    @SerializedName("num_cards")
    val numCards: Int? = null,
    val model: String? = null
)

data class QuizQuestionsWrapper(
    @SerializedName("quiz_questions")
    val quizQuestions: List<QuizQuestion>? = null  // ← Also use camelCase for Kotlin convention
)

data class QuizQuestion(
    val question: String = "",
    val options: List<String> = emptyList(),
    @SerializedName("correct_answer")
    val correctAnswer: String = "",
    val explanation: String = ""
)

data class Flashcard(
    val front: String,
    val back: String
)

data class ProcessVideoRequest(
    val url: String,
    val title: String? = null
)

data class ChatRequest(
    val note_id: String,
    val question: String,
    val language: String = "english",
    val conversation_history: List<ChatHistoryItem> = emptyList()
)

data class ChatHistoryItem(
    val text: String,
    val isUser: Boolean
)

data class ChatResponse(
    val answer: String,
    val note_id: String
)