package com.kreativekoala.scribeai.data.models

import com.google.gson.annotations.SerializedName

data class Note(
    @SerializedName("id")
    val id: String,
    
    @SerializedName("user_id")
    val userId: String,
    
    @SerializedName("title")
    val title: String,
    
    @SerializedName("content")
    val content: String,
    
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
)

data class CreateNoteRequest(
    val title: String,
    val content: String,
    @SerializedName("source_type")
    val sourceType: String,
    @SerializedName("source_url")
    val sourceUrl: String? = null,
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
