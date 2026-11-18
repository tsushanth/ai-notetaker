package com.kreativekoala.scribeai.data.models

import com.google.gson.annotations.SerializedName
import androidx.annotation.StringRes
import com.kreativekoala.scribeai.R

data class Note(
    @SerializedName("id")
    val id: String,

    @SerializedName("user_id")
    val userId: String,

    @SerializedName("title")
    val title: String,

    @SerializedName("content")
    val content: String,

    @SerializedName("formatted_content")
    val formattedContent: String? = null,

    @SerializedName("formatting_status")
    val formattingStatus: String? = null,

    @SerializedName("source_type")
    val sourceType: String,

    @SerializedName("source_url")
    val sourceUrl: String? = null,

    @SerializedName("metadata")
    val metadata: Map<String, Any>? = null,

    @SerializedName("created_at")
    val createdAt: String,

    @SerializedName("updated_at")
    val updatedAt: String
) {
    /**
     * Returns the best available content for display (formatted if available, otherwise raw)
     */
    val displayContent: String
        get() = if (hasFormattedContent) formattedContent!! else content

    /**
     * Whether formatted content is available
     */
    val hasFormattedContent: Boolean
        get() = !formattedContent.isNullOrEmpty() && formattingStatus == "completed"

    /**
     * Whether formatting is in progress
     */
    val isFormatting: Boolean
        get() = formattingStatus == "processing"
}

data class CreateNoteRequest(
    val id: String? = null,
    val title: String,
    val content: String,
    @SerializedName("source_type")
    val sourceType: String,
    @SerializedName("source_url")
    val sourceUrl: String? = null,
    val metadata: Map<String, Any>? = null
)

data class UpdateNoteRequest(
    val title: String? = null,
    val content: String? = null,
    val metadata: Map<String, Any>? = null
)

data class NoteResponse(
    val success: Boolean,
    val data: Note? = null,
    val error: String? = null
)

data class NotesListResponse(
    val success: Boolean,
    val data: List<Note>? = null,
    val pagination: Pagination? = null,
    val error: String? = null
)

data class Pagination(
    val page: Int,
    val limit: Int,
    val total: Int,
    val pages: Int
) {
    /**
     * Returns true if there are more pages to load
     */
    val hasMore: Boolean
        get() = page < pages
}

// User Stats for retention screens
data class UserStats(
    @SerializedName("notes_count")
    val notesCount: Int = 0,
    @SerializedName("quizzes_count")
    val quizzesCount: Int = 0,
    @SerializedName("flashcards_count")
    val flashcardsCount: Int = 0,
    @SerializedName("audio_hours")
    val audioHours: Double = 0.0
)

data class UserStatsResponse(
    val success: Boolean,
    val data: UserStats? = null,
    val error: String? = null
)

/** `reason` is optional: when the user picks none it is omitted from the request body (Gson skips nulls). */
data class DeleteAccountRequest(
    val reason: String? = null
)

// Deletion reasons for account deletion
enum class DeletionReason(@StringRes val labelRes: Int) {
    NOT_USEFUL(R.string.deletion_reason_not_useful),
    TOO_EXPENSIVE(R.string.deletion_reason_too_expensive),
    FOUND_ALTERNATIVE(R.string.deletion_reason_found_alternative),
    PRIVACY_CONCERNS(R.string.deletion_reason_privacy),
    TOO_COMPLICATED(R.string.deletion_reason_too_complicated),
    BUGS_ISSUES(R.string.deletion_reason_bugs),
    OTHER(R.string.deletion_reason_other)
}

/**
 * The only thing about the deletion reason that may leave the device through analytics: the enum name of a
 * fixed choice, or "none" when the user skipped it. Never free text.
 */
fun DeletionReason?.analyticsValue(): String = this?.name ?: "none"
