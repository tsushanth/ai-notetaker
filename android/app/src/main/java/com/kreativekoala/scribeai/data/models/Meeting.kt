package com.kreativekoala.scribeai.data.models

import com.google.gson.annotations.SerializedName

/**
 * Meeting model representing a meeting bot session
 */
data class Meeting(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val title: String?,
    @SerializedName("meeting_url") val meetingUrl: String,
    val platform: MeetingPlatform,
    val status: MeetingStatus,
    @SerializedName("scheduled_start") val scheduledStart: String?,
    @SerializedName("actual_start") val actualStart: String?,
    @SerializedName("actual_end") val actualEnd: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int?,
    @SerializedName("error_message") val errorMessage: String?,
    @SerializedName("note_id") val noteId: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String,
    @SerializedName("bot_runs") val botRuns: List<BotRun>? = null,
    @SerializedName("meeting_recordings") val meetingRecordings: List<MeetingRecording>? = null
) {
    /**
     * Format duration as mm:ss or hh:mm:ss
     */
    val formattedDuration: String?
        get() {
            val seconds = durationSeconds ?: return null
            val minutes = seconds / 60
            val remainingSeconds = seconds % 60
            return if (minutes > 60) {
                val hours = minutes / 60
                val remainingMinutes = minutes % 60
                String.format("%d:%02d:%02d", hours, remainingMinutes, remainingSeconds)
            } else {
                String.format("%d:%02d", minutes, remainingSeconds)
            }
        }

    /**
     * Whether the meeting is currently active
     */
    val isActive: Boolean
        get() = status.isActive

    /**
     * Whether the meeting can be cancelled
     */
    val isCancellable: Boolean
        get() = status.isCancellable
}

/**
 * Meeting status enum
 */
enum class MeetingStatus {
    @SerializedName("pending") PENDING,
    @SerializedName("bot_joining") BOT_JOINING,
    @SerializedName("in_progress") IN_PROGRESS,
    @SerializedName("recording") RECORDING,
    @SerializedName("processing") PROCESSING,
    @SerializedName("transcribing") TRANSCRIBING,
    @SerializedName("completed") COMPLETED,
    @SerializedName("failed") FAILED,
    @SerializedName("cancelled") CANCELLED;

    val displayText: String
        get() = when (this) {
            PENDING -> "Waiting to join"
            BOT_JOINING -> "Bot joining..."
            IN_PROGRESS -> "In meeting"
            RECORDING -> "Recording"
            PROCESSING -> "Processing"
            TRANSCRIBING -> "Transcribing"
            COMPLETED -> "Completed"
            FAILED -> "Failed"
            CANCELLED -> "Cancelled"
        }

    val isActive: Boolean
        get() = this in listOf(PENDING, BOT_JOINING, IN_PROGRESS, RECORDING, PROCESSING, TRANSCRIBING)

    val isCancellable: Boolean
        get() = this in listOf(PENDING, BOT_JOINING, IN_PROGRESS, RECORDING)
}

/**
 * Meeting platform enum
 */
enum class MeetingPlatform {
    @SerializedName("zoom") ZOOM,
    @SerializedName("google_meet") GOOGLE_MEET,
    @SerializedName("teams") TEAMS,
    @SerializedName("webex") WEBEX,
    @SerializedName("other") OTHER;

    val displayName: String
        get() = when (this) {
            ZOOM -> "Zoom"
            GOOGLE_MEET -> "Google Meet"
            TEAMS -> "Microsoft Teams"
            WEBEX -> "Webex"
            OTHER -> "Other"
        }
}

/**
 * Bot run model
 */
data class BotRun(
    val id: String,
    @SerializedName("meeting_id") val meetingId: String,
    @SerializedName("recall_bot_id") val recallBotId: String?,
    val status: String,
    @SerializedName("join_time") val joinTime: String?,
    @SerializedName("leave_time") val leaveTime: String?,
    @SerializedName("recording_path") val recordingPath: String?,
    @SerializedName("transcript_raw") val transcriptRaw: String?
)

/**
 * Meeting recording model
 */
data class MeetingRecording(
    val id: String,
    @SerializedName("meeting_id") val meetingId: String,
    @SerializedName("bot_run_id") val botRunId: String?,
    @SerializedName("storage_path") val storagePath: String,
    @SerializedName("storage_url") val storageUrl: String?,
    @SerializedName("file_size_bytes") val fileSizeBytes: Long?,
    @SerializedName("duration_seconds") val durationSeconds: Int?,
    val format: String?,
    val status: String,
    @SerializedName("created_at") val createdAt: String
)

// MARK: - API Response Types

data class MeetingResponse(
    val success: Boolean,
    val data: Meeting?,
    val error: String?
)

data class MeetingsListResponse(
    val success: Boolean,
    val data: List<Meeting>?,
    val pagination: MeetingsPagination?,
    val error: String?
)

data class MeetingsPagination(
    val page: Int,
    val limit: Int,
    val total: Int,
    val pages: Int
) {
    val hasMore: Boolean
        get() = page < pages
}

data class CreateMeetingRequest(
    val meetingUrl: String,
    val title: String? = null
)

data class CreateMeetingResponse(
    val success: Boolean,
    val data: CreateMeetingData?,
    val error: String?
)

data class CreateMeetingData(
    val meeting: Meeting,
    val botRun: BotRun?,
    val recallBotId: String?
)

data class ValidateMeetingUrlRequest(
    val meetingUrl: String
)

data class ValidateMeetingUrlResponse(
    val success: Boolean,
    val data: ValidateMeetingUrlData?,
    val error: String?
)

data class ValidateMeetingUrlData(
    val valid: Boolean,
    val platform: MeetingPlatform?
)

// MARK: - URL Validation Helper

object MeetingURLValidator {
    /**
     * Validate a meeting URL and detect the platform
     */
    fun validate(url: String): Pair<Boolean, MeetingPlatform?> {
        val lowercased = url.lowercase()

        return when {
            lowercased.contains("zoom.us/j/") || lowercased.contains("zoom.us/my/") ->
                true to MeetingPlatform.ZOOM
            lowercased.contains("meet.google.com/") ->
                true to MeetingPlatform.GOOGLE_MEET
            lowercased.contains("teams.microsoft.com") || lowercased.contains("teams.live.com") ->
                true to MeetingPlatform.TEAMS
            lowercased.contains("webex.com") ->
                true to MeetingPlatform.WEBEX
            else -> false to null
        }
    }
}
