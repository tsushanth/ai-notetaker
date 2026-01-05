package com.kreativekoala.scribeai.data.repository

import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Repository for meeting-related API operations
 */
class MeetingRepository {

    private val apiService = RetrofitClient.apiService

    /**
     * Create a new meeting and deploy bot
     */
    suspend fun createMeeting(
        token: String,
        meetingUrl: String,
        title: String?
    ): Result<CreateMeetingResponse> = withContext(Dispatchers.IO) {
        try {
            val request = CreateMeetingRequest(meetingUrl, title)
            val response = apiService.createMeeting("Bearer $token", request)

            if (response.isSuccessful) {
                response.body()?.let {
                    Result.success(it)
                } ?: Result.failure(Exception("Empty response"))
            } else {
                val errorBody = response.errorBody()?.string()
                val errorMessage = when (response.code()) {
                    401 -> "Authentication required"
                    403 -> "Premium subscription required for meeting bot"
                    400 -> errorBody?.let { parseErrorMessage(it) } ?: "Invalid meeting URL"
                    else -> errorBody?.let { parseErrorMessage(it) } ?: "Failed to create meeting"
                }
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get all meetings for user
     */
    suspend fun getMeetings(
        token: String,
        page: Int = 1,
        limit: Int = 20
    ): Result<MeetingsListResponse> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getMeetings("Bearer $token", page, limit)

            if (response.isSuccessful) {
                response.body()?.let {
                    Result.success(it)
                } ?: Result.failure(Exception("Empty response"))
            } else {
                val errorMessage = when (response.code()) {
                    401 -> "Authentication required"
                    403 -> "Premium subscription required"
                    else -> "Failed to load meetings"
                }
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get meeting status
     */
    suspend fun getMeetingStatus(
        token: String,
        meetingId: String
    ): Result<MeetingResponse> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.getMeetingStatus("Bearer $token", meetingId)

            if (response.isSuccessful) {
                response.body()?.let {
                    Result.success(it)
                } ?: Result.failure(Exception("Empty response"))
            } else {
                Result.failure(Exception("Failed to get meeting status"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Cancel a meeting
     */
    suspend fun cancelMeeting(
        token: String,
        meetingId: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.cancelMeeting("Bearer $token", meetingId)

            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMessage = when (response.code()) {
                    404 -> "Meeting not found"
                    else -> "Failed to cancel meeting"
                }
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Delete a meeting
     */
    suspend fun deleteMeeting(
        token: String,
        meetingId: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = apiService.deleteMeeting("Bearer $token", meetingId)

            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMessage = when (response.code()) {
                    404 -> "Meeting not found"
                    else -> "Failed to delete meeting"
                }
                Result.failure(Exception(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Validate a meeting URL
     */
    suspend fun validateMeetingUrl(
        token: String,
        meetingUrl: String
    ): Result<ValidateMeetingUrlResponse> = withContext(Dispatchers.IO) {
        try {
            val request = ValidateMeetingUrlRequest(meetingUrl)
            val response = apiService.validateMeetingUrl("Bearer $token", request)

            if (response.isSuccessful) {
                response.body()?.let {
                    Result.success(it)
                } ?: Result.failure(Exception("Empty response"))
            } else {
                Result.failure(Exception("Failed to validate URL"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Parse error message from response body
     */
    private fun parseErrorMessage(errorBody: String): String {
        return try {
            // Try to parse as JSON and extract error field
            val regex = """"error"\s*:\s*"([^"]+)"""".toRegex()
            regex.find(errorBody)?.groupValues?.getOrNull(1) ?: errorBody
        } catch (e: Exception) {
            errorBody
        }
    }
}
