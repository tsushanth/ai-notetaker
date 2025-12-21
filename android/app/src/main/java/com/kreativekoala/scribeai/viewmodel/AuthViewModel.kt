package com.kreativekoala.scribeai.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.TutorialManager
import com.kreativekoala.scribeai.utils.UserIdHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

sealed class AuthState {
    object Idle : AuthState()
    object Loading : AuthState()
    data class Authenticated(val token: String) : AuthState()
    data class Error(val message: String) : AuthState()
}

class AuthViewModel(application: Application, private val authManager: AuthManager, private val tutorialManager: TutorialManager) : AndroidViewModel(application) {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Idle)
    val authState: StateFlow<AuthState> = _authState

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val supabaseUrl = "https://shufmkocfnjnlwshqrue.supabase.co"
    private val supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNodWZta29jZm5qbmx3c2hxcnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzkzMTksImV4cCI6MjA3Nzg1NTMxOX0.WPmgPldx4bt82JCr7K-20-z-53q8926qtDV5rLMSAnw"

    init {
        checkExistingAuth()
    }

    private fun checkExistingAuth() {
        viewModelScope.launch {
            // Just check once - don't use .collect { } which creates continuous emissions
            val token = authManager.authToken.value

            if (token != null && isValidJWT(token)) {
                if (authManager.isTokenExpired(token)) {
                    Log.d("AuthViewModel", "Cached token expired, attempting refresh")
                    val refreshedToken = authManager.refreshToken()
                    if (refreshedToken != null) {
                        _authState.value = AuthState.Authenticated(refreshedToken)
                    } else {
                        Log.w("AuthViewModel", "Token refresh failed, user needs to log in")
                        _authState.value = AuthState.Idle
                    }
                } else {
                    _authState.value = AuthState.Authenticated(token)
                }
            }
        }
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Loading
                }

                Log.d("AuthViewModel", "Attempting sign in for: $email")

                val json = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/token?grant_type=password")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d("AuthViewModel", "Response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorJson = JSONObject(responseBody ?: "{}")
                    val errorMessage = errorJson.optString("error_description",
                        errorJson.optString("message", "Login failed"))

                    Log.e("AuthViewModel", "Login failed: $errorMessage")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error(errorMessage)
                    }
                    return@launch
                }

                // Parse response - NOW INCLUDES REFRESH TOKEN
                val jsonResponse = JSONObject(responseBody ?: "")
                val accessToken = jsonResponse.optString("access_token")
                val refreshToken = jsonResponse.optString("refresh_token")  // NEW

                if (accessToken.isEmpty()) {
                    Log.e("AuthViewModel", "No access token in response")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error("No access token received")
                    }
                    return@launch
                }

                // Validate token format
                if (!isValidJWT(accessToken)) {
                    Log.e("AuthViewModel", "Invalid token format")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error("Invalid token format received")
                    }
                    return@launch
                }

                Log.d("AuthViewModel", "✅ Valid token received")
                Log.d("AuthViewModel", "✅ Refresh token received: ${refreshToken.isNotEmpty()}")

                // Extract userId from token
                val extractedUserId = UserIdHelper.extractUserIdFromToken(accessToken)

                // Save ALL tokens - access, refresh, and userId
                authManager.saveAuth(accessToken, refreshToken, extractedUserId)

                // Seed tutorial
                Log.d("AUTH_FLOW", "==========================================")
                Log.d("AUTH_FLOW", "1️⃣ About to seed tutorial (sign in)")
                Log.d("AUTH_FLOW", "   Extracted UserId: $extractedUserId")
                tutorialManager.seedTutorialIfNeeded(extractedUserId)
                Log.d("AUTH_FLOW", "2️⃣ Tutorial seeding completed")
                Log.d("AUTH_FLOW", "==========================================")

                Log.d("AuthViewModel", "✅ Tokens saved successfully")
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Sign in error", e)
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Error(e.message ?: "An error occurred")
                }
            }
        }
    }

    /**
     * Reset password using OkHttp (Supabase /auth/v1/recover endpoint)
     */
    fun resetPassword(email: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                Log.d("AuthViewModel", "Attempting password reset for: $email")

                val json = JSONObject().apply {
                    put("email", email)
                }

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/recover")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d("AuthViewModel", "Password reset response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorJson = JSONObject(responseBody ?: "{}")
                    val errorMessage = errorJson.optString("error_description",
                        errorJson.optString("message", "Password reset failed"))
                    Log.e("AuthViewModel", "Password reset failed: $errorMessage")
                } else {
                    Log.d("AuthViewModel", "✅ Password reset email sent successfully")
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Password reset error", e)
            }
        }
    }

    fun signUp(email: String, password: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Loading
                }

                Log.d("AuthViewModel", "Attempting sign up for: $email")

                val json = JSONObject().apply {
                    put("email", email)
                    put("password", password)
                }

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/signup")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d("AuthViewModel", "Response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorJson = JSONObject(responseBody ?: "{}")
                    val errorMessage = errorJson.optString("error_description",
                        errorJson.optString("message", "Sign up failed"))

                    Log.e("AuthViewModel", "Sign up failed: $errorMessage")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error(errorMessage)
                    }
                    return@launch
                }

                // Parse response - NOW INCLUDES REFRESH TOKEN
                val jsonResponse = JSONObject(responseBody ?: "")
                val accessToken = jsonResponse.optString("access_token")
                val refreshToken = jsonResponse.optString("refresh_token")  // NEW

                if (accessToken.isEmpty()) {
                    // Some Supabase setups require email confirmation
                    val confirmationSent = jsonResponse.optJSONObject("user")
                        ?.optString("confirmation_sent_at")

                    if (confirmationSent != null) {
                        withContext(Dispatchers.Main) {
                            _authState.value = AuthState.Error("Please check your email to confirm your account")
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            _authState.value = AuthState.Error("No access token received")
                        }
                    }
                    return@launch
                }

                // Validate token format
                if (!isValidJWT(accessToken)) {
                    Log.e("AuthViewModel", "Invalid token format")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error("Invalid token format received")
                    }
                    return@launch
                }

                Log.d("AuthViewModel", "✅ Sign up successful, valid token received")
                Log.d("AuthViewModel", "✅ Refresh token received: ${refreshToken.isNotEmpty()}")

                // Extract userId from token
                val extractedUserId = UserIdHelper.extractUserIdFromToken(accessToken)

                // Save ALL tokens
                authManager.saveAuth(accessToken, refreshToken, extractedUserId)

                // Seed tutorial
                Log.d("AUTH_FLOW", "==========================================")
                Log.d("AUTH_FLOW", "1️⃣ About to seed tutorial")
                Log.d("AUTH_FLOW", "   Extracted UserId: $extractedUserId")
                tutorialManager.seedTutorialIfNeeded(extractedUserId)
                Log.d("AUTH_FLOW", "2️⃣ Tutorial seeding completed")
                Log.d("AUTH_FLOW", "==========================================")

                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Sign up error", e)
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Error(e.message ?: "An error occurred")
                }
            }
        }
    }

    fun signInWithGoogle(idToken: String, nonce: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Loading
                }

                Log.d("AuthViewModel", "Attempting Google sign in")

                val json = JSONObject().apply {
                    put("provider", "google")
                    put("id_token", idToken)
                    put("nonce", nonce)
                }

                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/token?grant_type=id_token")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                Log.d("AuthViewModel", "Google sign in response code: ${response.code}")

                if (!response.isSuccessful) {
                    val errorJson = JSONObject(responseBody ?: "{}")
                    val errorMessage = errorJson.optString("error_description",
                        errorJson.optString("message", "Google sign-in failed"))

                    Log.e("AuthViewModel", "Google sign in failed: $errorMessage")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error(errorMessage)
                    }
                    return@launch
                }

                // Parse response - NOW INCLUDES REFRESH TOKEN
                val jsonResponse = JSONObject(responseBody ?: "")
                val accessToken = jsonResponse.optString("access_token")
                val refreshToken = jsonResponse.optString("refresh_token")  // NEW

                if (accessToken.isEmpty()) {
                    Log.e("AuthViewModel", "No access token in Google sign-in response")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error("No access token received from Google")
                    }
                    return@launch
                }

                // Validate token format
                if (!isValidJWT(accessToken)) {
                    Log.e("AuthViewModel", "Invalid token format")
                    withContext(Dispatchers.Main) {
                        _authState.value = AuthState.Error("Invalid token format received")
                    }
                    return@launch
                }

                Log.d("AuthViewModel", "✅ Google sign in successful, valid token received")
                Log.d("AuthViewModel", "✅ Refresh token received: ${refreshToken.isNotEmpty()}")

                // Extract userId from token
                val extractedUserId = UserIdHelper.extractUserIdFromToken(accessToken)

                // Save ALL tokens
                authManager.saveAuth(accessToken, refreshToken, extractedUserId)

                // Seed tutorial
                Log.d("AUTH_FLOW", "==========================================")
                Log.d("AUTH_FLOW", "1️⃣ About to seed tutorial (Google)")
                Log.d("AUTH_FLOW", "   Extracted UserId: $extractedUserId")
                tutorialManager.seedTutorialIfNeeded(extractedUserId)
                Log.d("AUTH_FLOW", "2️⃣ Tutorial seeding completed")
                Log.d("AUTH_FLOW", "==========================================")

                Log.d("AuthViewModel", "✅ Google tokens saved successfully")
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Google sign in error", e)
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Error(e.message ?: "Google sign-in failed")
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authManager.clearAuth()
            _authState.value = AuthState.Idle
        }
    }

    private fun isValidJWT(token: String): Boolean {
        val parts = token.split(".")
        return parts.size == 3 && parts.all { it.isNotEmpty() }
    }
}