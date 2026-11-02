package com.kreativekoala.scribeai.data.repository

import com.google.gson.JsonParser
import com.kreativekoala.scribeai.data.api.ApiService
import com.kreativekoala.scribeai.data.api.RetrofitClient
import com.kreativekoala.scribeai.data.models.DeleteAccountRequest
import com.kreativekoala.scribeai.data.models.DeletionReason
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Account deletion against the real backend route (DELETE /api/user/delete-account).
 * Google Play requires in-app deletion to actually delete, so success here means the server said so.
 */
class AccountRepository(private val api: ApiService = RetrofitClient.apiService) {

    suspend fun deleteAccount(token: String, reason: DeletionReason): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = api.deleteAccount("Bearer $token", DeleteAccountRequest(reason = reason.name))
            when {
                response.isSuccessful && response.body()?.success == true -> Result.success(Unit)
                response.isSuccessful -> Result.failure(Exception(response.body()?.error ?: GENERIC_FAILURE))
                response.code() == 401 -> Result.failure(Exception("Session expired. Please log in again."))
                else -> Result.failure(Exception(serverMessage(response.errorBody()?.string()) ?: "$GENERIC_FAILURE (${response.code()})"))
            }
        } catch (e: Exception) {
            Result.failure(Exception(e.message ?: GENERIC_FAILURE))
        }
    }

    /** `{"error": "..."}` or `{"message": "..."}` from the backend, else null. */
    private fun serverMessage(body: String?): String? = try {
        val obj = JsonParser.parseString(body ?: "").asJsonObject
        listOf("error", "message")
            .mapNotNull { key ->
                val el = obj.get(key)
                if (el != null && el.isJsonPrimitive && el.asJsonPrimitive.isString) el.asString.trim() else null
            }
            .firstOrNull { it.isNotEmpty() }
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val GENERIC_FAILURE = "Failed to delete account"
    }
}
