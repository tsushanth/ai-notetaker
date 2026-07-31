package com.kreativekoala.scribeai.phone

enum class PhoneCallStatus {
    INITIATED, RINGING, IN_PROGRESS, RECORDING,
    COMPLETED, FAILED, BUSY, NO_ANSWER, CANCELLED;

    val displayName: String
        get() = when (this) {
            INITIATED -> "Initiated"
            RINGING -> "Ringing"
            IN_PROGRESS -> "In Progress"
            RECORDING -> "Recording"
            COMPLETED -> "Completed"
            FAILED -> "Failed"
            BUSY -> "Busy"
            NO_ANSWER -> "No Answer"
            CANCELLED -> "Cancelled"
        }

    val isActive: Boolean
        get() = when (this) {
            INITIATED, RINGING, IN_PROGRESS, RECORDING -> true
            else -> false
        }
}

data class VerifiedPhone(
    val id: String,
    val phoneNumber: String,
    val verifiedAt: String?,
    val createdAt: String
) {
    val formattedPhoneNumber: String get() = formatPhoneNumber(phoneNumber)
}

data class PhoneCall(
    val id: String,
    val userId: String,
    val fromNumber: String,
    val toNumber: String,
    val toName: String?,
    val twilioCallSid: String?,
    val conferenceSid: String?,
    val conferenceName: String?,
    val recordingSid: String?,
    val status: PhoneCallStatus,
    val isRecording: Boolean,
    val recordingUrl: String?,
    val recordingDuration: Int?,
    val recordingId: String?,
    val startedAt: String?,
    val answeredAt: String?,
    val recordingStartedAt: String?,
    val endedAt: String?,
    val createdAt: String,
    val updatedAt: String?
) {
    val formattedToNumber: String get() = formatPhoneNumber(toNumber)
    val formattedFromNumber: String get() = formatPhoneNumber(fromNumber)

    val formattedDuration: String
        get() {
            val duration = recordingDuration ?: return "--:--"
            val mins = duration / 60
            val secs = duration % 60
            return String.format("%d:%02d", mins, secs)
        }
}

internal fun formatPhoneNumber(phone: String): String {
    return if (phone.startsWith("+1") && phone.length == 12) {
        "(${phone.substring(2, 5)}) ${phone.substring(5, 8)}-${phone.substring(8)}"
    } else phone
}

internal fun VerifiedPhoneDto.toDomain() = VerifiedPhone(
    id = id,
    phoneNumber = phoneNumber,
    verifiedAt = verifiedAt,
    createdAt = createdAt
)

internal fun PhoneCallDto.toDomain() = PhoneCall(
    id = id,
    userId = userId,
    fromNumber = fromNumber,
    toNumber = toNumber,
    toName = toName,
    twilioCallSid = twilioCallSid,
    conferenceSid = conferenceSid,
    conferenceName = conferenceName,
    recordingSid = recordingSid,
    status = when (status) {
        PhoneCallStatusDto.INITIATED -> PhoneCallStatus.INITIATED
        PhoneCallStatusDto.RINGING -> PhoneCallStatus.RINGING
        PhoneCallStatusDto.IN_PROGRESS -> PhoneCallStatus.IN_PROGRESS
        PhoneCallStatusDto.RECORDING -> PhoneCallStatus.RECORDING
        PhoneCallStatusDto.COMPLETED -> PhoneCallStatus.COMPLETED
        PhoneCallStatusDto.FAILED -> PhoneCallStatus.FAILED
        PhoneCallStatusDto.BUSY -> PhoneCallStatus.BUSY
        PhoneCallStatusDto.NO_ANSWER -> PhoneCallStatus.NO_ANSWER
        PhoneCallStatusDto.CANCELLED -> PhoneCallStatus.CANCELLED
    },
    isRecording = isRecording,
    recordingUrl = recordingUrl,
    recordingDuration = recordingDuration,
    recordingId = recordingId,
    startedAt = startedAt,
    answeredAt = answeredAt,
    recordingStartedAt = recordingStartedAt,
    endedAt = endedAt,
    createdAt = createdAt,
    updatedAt = updatedAt
)
