package com.kreativekoala.scribeai.data.models

import com.google.gson.annotations.SerializedName

data class Recording(
    val id: String,
    @SerializedName("user_id")
    val userId: String,
    @SerializedName("note_id")
    val noteId: String?,
    val title: String?,
    @SerializedName("file_path")
    val filePath: String,
    @SerializedName("file_url")
    val fileUrl: String,
    @SerializedName("file_size")
    val fileSize: Long,
    val duration: Int?,
    val format: String,
    val status: String,
    @SerializedName("transcription_id")
    val transcriptionId: String?,
    @SerializedName("created_at")
    val createdAt: String,
    @SerializedName("updated_at")
    val updatedAt: String
)

data class RecordingResponse(
    val success: Boolean,
    val data: Recording? = null,
    val error: String? = null
)

data class TranscriptionResponse(
    val success: Boolean,
    val data: TranscriptionResult? = null,
    val error: String? = null
)

data class TranscriptionResult(
    @SerializedName("recording_id")
    val recordingId: String,
    val transcription: String,
    val duration: Int,
    val status: String,
    @SerializedName("note_id")
    val noteId: String? = null

)
