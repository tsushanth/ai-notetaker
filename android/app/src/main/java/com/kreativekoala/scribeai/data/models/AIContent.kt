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
    // Also support 'count' as alias for num_cards (used by iOS)
    val count: Int? = null,
    val style: String? = null,
    @SerializedName("generate_audio")
    val generateAudio: Boolean? = null,
    val language: String? = null,
    // Podcast-specific options
    val duration: String? = null, // "short", "medium", "long"
    val voice: String? = null, // "nova" (female), "onyx" (male)
    val instructions: String? = null,
)

data class AIContentResponse(
    val success: Boolean,
    val data: AIContentData? = null,
    val error: String? = null
)

data class PodcastStatusResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("data") val data: PodcastStatus? = null
)

data class PodcastStatus(
    @SerializedName("status") val status: String,
    @SerializedName("message") val message: String? = null,
    @SerializedName("id") val id: String? = null,
    @SerializedName("audio_url") val audio_url: String? = null,
    @SerializedName("script") val script: String? = null,
    @SerializedName("duration") val duration: String? = null,
    @SerializedName("style") val style: String? = null,
    @SerializedName("note_id") val note_id: String? = null
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
    val model: String? = null,
    val title: String? = null,
    // Infographic fields
    @SerializedName("image_url")
    val imageUrl: String? = null,
    @SerializedName("extracted_data")
    val extractedData: InfographicExtractedData? = null,
    // Mind Map fields
    @SerializedName("mind_map_title")
    val mindMapTitle: String? = null,
    @SerializedName("nodes")
    val mindMapNodes: List<MindMapNode>? = null
)

// ============================================
// Mind Map Models
// ============================================

data class MindMap(
    val id: String,
    val noteId: String,
    val title: String,
    val nodes: List<MindMapNode>,
    val createdAt: String
)

data class MindMapNode(
    val id: String,
    val label: String,
    val content: String,
    val level: Int,
    @SerializedName("parentId")
    val parentId: String? = null,
    val color: String? = null,
    @SerializedName("isExploratory")
    val isExploratory: Boolean = false
)

data class MindMapGenerateRequest(
    @SerializedName("note_id")
    val noteId: String,
    @SerializedName("content_type")
    val contentType: String = "mindmap",
    val options: MindMapOptions? = null
)

data class MindMapOptions(
    val language: String = "english",
    @SerializedName("includeExploration")
    val includeExploration: Boolean = true
)

data class MindMapResponse(
    val success: Boolean,
    val data: MindMapData? = null,
    val error: String? = null
)

data class MindMapData(
    val id: String? = null,
    @SerializedName("note_id")
    val noteId: String? = null,
    val title: String? = null,
    val nodes: List<MindMapNode>? = null,
    @SerializedName("created_at")
    val createdAt: String? = null
)

// ============================================
// TTS Models
// ============================================

data class TTSGenerateRequest(
    @SerializedName("note_id")
    val noteId: String,
    val voice: String = "nova",
    val speed: Double = 1.0
)

data class TTSResponse(
    val success: Boolean,
    val data: TTSData? = null,
    val error: String? = null
)

data class TTSData(
    @SerializedName("audio_url")
    val audioUrl: String,
    val voice: String = "nova",
    val speed: Double = 1.0,
    @SerializedName("duration_seconds")
    val durationSeconds: Int = 0
)

// MARK: - Infographic Models

data class InfographicGenerateResponse(
    val success: Boolean,
    val data: InfographicData? = null,
    val error: String? = null
)

data class InfographicData(
    val id: String,
    @SerializedName("note_id")
    val noteId: String,
    @SerializedName("image_url")
    val imageUrl: String,
    @SerializedName("extracted_data")
    val extractedData: InfographicExtractedData? = null,
    val style: String? = null
)

data class InfographicExtractedData(
    val title: String? = null,
    val subtitle: String? = null,
    @SerializedName("key_stats")
    val keyStats: List<InfographicStat>? = null,
    @SerializedName("main_sections")
    val mainSections: List<InfographicSection>? = null,
    @SerializedName("key_takeaway")
    val keyTakeaway: String? = null
)

data class InfographicStat(
    val value: String,
    val label: String
)

data class InfographicSection(
    val title: String,
    val points: List<String>
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

// ============================================
// Subscription Models
// ============================================

data class SubscriptionSyncRequest(
    val productId: String,
    val platform: String = "android",
    val status: String,
    val originalTransactionId: String? = null,
    val transactionId: String? = null,
    val expirationDate: String? = null,
    val purchaseDate: String? = null,
    val isTrial: Boolean = false,
    val trialEndDate: String? = null,
    val autoRenewEnabled: Boolean = true,
    val priceAmount: String? = null,
    val priceCurrency: String? = null,
    val deviceId: String? = null
)

// Trial check with device ID (for abuse prevention)
data class TrialCheckRequest(
    val deviceId: String
)

data class TrialCheckResponse(
    val success: Boolean,
    val data: TrialCheckData? = null
)

data class TrialCheckData(
    val isInTrial: Boolean,
    val daysRemaining: Int,
    val expiresAt: String? = null,
    val trialExpired: Boolean,
    val deviceTrialUsed: Boolean? = null
)

data class SubscriptionSyncResponse(
    val success: Boolean,
    val data: SubscriptionSyncData? = null,
    val error: String? = null
)

data class SubscriptionSyncData(
    val subscriptionId: String,
    val status: String,
    val expiresAt: String? = null
)

data class SubscriptionStatusResponse(
    val success: Boolean,
    val data: SubscriptionStatusData? = null
)

data class SubscriptionStatusData(
    val isSubscribed: Boolean,
    val status: String,
    val productId: String? = null,
    val platform: String? = null,
    val expiresAt: String? = null,
    val isTrial: Boolean = false,
    val trialEndsAt: String? = null,
    val autoRenewEnabled: Boolean = true
)

data class AccessStatusResponse(
    val success: Boolean,
    val data: AccessStatusData? = null
)

data class AccessStatusData(
    val hasAccess: Boolean,
    val isSubscribed: Boolean,
    val isInTrial: Boolean,
    val reason: String? = null,
    val trialDaysRemaining: Int = 0,
    val trialExpiresAt: String? = null,
    val trialExpired: Boolean = false,
    val productId: String? = null,
    val expiresAt: String? = null,
    val usage: UsageData? = null,
    val features: FeatureAccess? = null
)

data class UsageData(
    val current: UsageCounts,
    val limits: UsageCounts,
    val remaining: UsageCounts
)

data class UsageCounts(
    val notes: Int = 0,
    val aiGenerations: Int = 0,
    val podcasts: Int = 0
)

data class FeatureAccess(
    val canCreateNotes: Boolean = true,
    val canUseAI: Boolean = true,
    val canGeneratePodcasts: Boolean = false,
    val canExportNotes: Boolean = false,
    val unlimitedAccess: Boolean = false
)

data class SubscriptionEventRequest(
    val eventType: String,
    val platform: String = "android",
    val productId: String? = null,
    val transactionId: String? = null,
    val originalTransactionId: String? = null,
    val priceAmount: String? = null,
    val priceCurrency: String? = null,
    val reason: String? = null,
    val metadata: Map<String, Any>? = null
)

// ============================================
// Generic & Analytics Models
// ============================================

data class GenericResponse(
    val success: Boolean,
    val error: String? = null
)

data class AnalyticsBatchRequest(
    val events: List<Map<String, Any>>
)

data class ErrorReportRequest(
    val flow: String,
    val error: String,
    val context: Map<String, Any>? = null
)

data class OnboardingPreferencesRequest(
    @SerializedName("user_type")
    val userType: String?,
    @SerializedName("use_cases")
    val useCases: List<String>
)

data class CreateContentData(
    val html: String,
    val prompt: String? = null
)

data class CreateContentResponse(
    val success: Boolean,
    val data: CreateContentData? = null,
    val error: String? = null
)

// On-device script-only generation
data class PodcastScriptResponse(
    val success: Boolean,
    val data: PodcastScriptData? = null,
    val error: String? = null
)

data class PodcastScriptData(
    val id: String? = null,
    @SerializedName("note_id")
    val noteId: String? = null,
    val script: String? = null,
    val duration: String? = null,
    val style: String? = null,
    val status: String? = null
)
