package com.kreativekoala.scribeai.phone

import com.kreativekoala.scribeai.data.api.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext

/**
 * Repository for phone-related backend operations. Token is passed per-call
 * (ScribeAI convention) — caller fetches it via `AuthManager.getFreshToken()`.
 */
class PhoneRepository {

    private val api = RetrofitClient.apiService

    suspend fun sendVerificationCode(
        token: String,
        phoneNumber: String
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.sendPhoneVerificationCode(
                "Bearer $token",
                SendVerificationRequest(phoneNumber)
            )
            if (response.isSuccessful) {
                Result.success(response.body()?.message ?: "Verification code sent")
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun checkVerificationCode(
        token: String,
        phoneNumber: String,
        code: String
    ): Result<VerifiedPhone?> = withContext(Dispatchers.IO) {
        try {
            val response = api.checkPhoneVerificationCode(
                "Bearer $token",
                CheckVerificationRequest(phoneNumber, code)
            )
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.verified == true && body.phone != null) {
                    Result.success(body.phone.toDomain())
                } else {
                    Result.failure(Exception("Invalid verification code"))
                }
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getVerifiedPhones(token: String): Result<List<VerifiedPhone>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getVerifiedPhones("Bearer $token")
            if (response.isSuccessful) {
                Result.success(response.body()?.phones?.map { it.toDomain() } ?: emptyList())
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteVerifiedPhone(token: String, id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = api.deleteVerifiedPhone("Bearer $token", id)
            if (response.isSuccessful) Result.success(Unit)
            else Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getVoipToken(token: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.getVoipToken("Bearer $token")
            if (response.isSuccessful) {
                val voip = response.body()?.token
                if (voip != null) Result.success(voip)
                else Result.failure(Exception("No VoIP token in response"))
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createCall(
        token: String,
        fromNumber: String,
        toNumber: String,
        toName: String? = null
    ): Result<VoipCallDetails> = withContext(Dispatchers.IO) {
        try {
            val response = api.createPhoneCall(
                "Bearer $token",
                InitiateCallRequest(from = fromNumber, to = toNumber, toName = toName)
            )
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    Result.success(
                        VoipCallDetails(
                            callId = body.callId,
                            conferenceName = body.conferenceName,
                            toNumber = body.toNumber
                        )
                    )
                } else Result.failure(Exception("Empty response"))
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getPhoneCalls(
        token: String,
        limit: Int = 50,
        offset: Int = 0
    ): Result<PhoneCallsResult> = withContext(Dispatchers.IO) {
        try {
            val response = api.getPhoneCalls("Bearer $token", limit, offset)
            if (response.isSuccessful) {
                val body = response.body()
                if (body != null) {
                    Result.success(
                        PhoneCallsResult(
                            calls = body.calls.map { it.toDomain() },
                            total = body.total,
                            limit = body.limit,
                            offset = body.offset
                        )
                    )
                } else Result.failure(Exception("Empty response"))
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getPhoneCall(token: String, id: String): Result<PhoneCall> = withContext(Dispatchers.IO) {
        try {
            val response = api.getPhoneCall("Bearer $token", id)
            if (response.isSuccessful) {
                val call = response.body()?.call?.toDomain()
                if (call != null) Result.success(call) else Result.failure(Exception("Empty response"))
            } else {
                Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun startRecording(token: String, callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.startPhoneCallRecording("Bearer $token", callId)
            if (response.isSuccessful) Result.success(response.body()?.recording ?: false)
            else Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun stopRecording(token: String, callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.stopPhoneCallRecording("Bearer $token", callId)
            if (response.isSuccessful) Result.success(!(response.body()?.recording ?: false))
            else Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun hangupCall(token: String, callId: String): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val response = api.hangupPhoneCall("Bearer $token", callId)
            if (response.isSuccessful) Result.success(response.body()?.ended ?: false)
            else Result.failure(Exception(parseError(response.code(), response.errorBody()?.string())))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun pollCallStatus(token: String, callId: String, intervalMs: Long = 2000): Flow<PhoneCall> = flow {
        while (true) {
            try {
                val response = api.getPhoneCall("Bearer $token", callId)
                val call = response.body()?.call?.toDomain()
                if (call != null) {
                    emit(call)
                    if (!call.status.isActive) break
                }
            } catch (_: Exception) { /* keep polling */ }
            delay(intervalMs)
        }
    }.flowOn(Dispatchers.IO)

    private fun parseError(code: Int, body: String?): String = when (code) {
        401 -> "Authentication required"
        403 -> "Subscription required"
        else -> body?.take(200) ?: "Request failed ($code)"
    }
}

data class PhoneCallsResult(
    val calls: List<PhoneCall>,
    val total: Int,
    val limit: Int,
    val offset: Int
) {
    val hasMore: Boolean get() = calls.size + offset < total
}

data class VoipCallDetails(
    val callId: String,
    val conferenceName: String,
    val toNumber: String
)
