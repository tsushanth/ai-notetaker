package com.kreativekoala.scribeai.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.service.FacebookSDKHelper
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
import android.net.Uri
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.utils.AppStrings
import com.kreativekoala.scribeai.utils.ErrorReportingService
import com.kreativekoala.scribeai.utils.PasswordResetLink
import com.kreativekoala.scribeai.utils.ReportRules

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
                        // Seed tutorial for returning users too
                        val userId = UserIdHelper.extractUserIdFromToken(refreshedToken)
                        tutorialManager.seedTutorialIfNeeded(userId)
                        _authState.value = AuthState.Authenticated(refreshedToken)
                    } else {
                        Log.w("AuthViewModel", "Token refresh failed, user needs to log in")
                        _authState.value = AuthState.Idle
                    }
                } else {
                    // Seed tutorial for returning users too
                    val userId = UserIdHelper.extractUserIdFromToken(token)
                    tutorialManager.seedTutorialIfNeeded(userId)
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
                    reportAuthFailure(ErrorReportingService.UserFlow.SIGN_IN, response.code, responseBody)
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
                // Meta attribution — dedupes per install, safe to call on every signin.
                FacebookSDKHelper.logSignUp("email")
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Sign in error", e)
                ErrorReportingService.reportException(ErrorReportingService.UserFlow.SIGN_IN, e)
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Error(e.message ?: "An error occurred")
                }
            }
        }
    }

    /** Report a refused sign-in or sign-up that is not the user's own mistake: status and error code only. */
    private fun reportAuthFailure(flow: ErrorReportingService.UserFlow, status: Int, body: String?) {
        if (ReportRules.shouldReportAuth(status, body)) {
            ErrorReportingService.reportError(flow, "HTTP $status ${ReportRules.authErrorCode(body)}") // i18n-ok
        }
    }

    /**
     * Reset password using OkHttp (Supabase /auth/v1/recover endpoint). [onResult] is called on the main thread with
     * null when the email was accepted, else with the message to show.
     */
    fun resetPassword(email: String, onResult: (error: String?) -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            val error = try {
                val json = JSONObject().apply {
                    put("email", email)
                }

                // The web page works on any device. If the project does not allow that address yet, the sign-in service
                // uses the app link instead, which PasswordResetLinkActivity forwards to the same page.
                val redirect = Uri.encode(PasswordResetLink.WEB_PAGE)
                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/recover?redirect_to=$redirect")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", supabaseKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        null
                    } else {
                        val body = response.body?.string()
                        Log.e("AuthViewModel", "Password reset failed: ${response.code}")
                        // A rate limit here is the mailer refusing to send: the owner needs to know.
                        ErrorReportingService.reportError(
                            ErrorReportingService.UserFlow.PASSWORD_RESET,
                            "HTTP ${response.code} ${ReportRules.authErrorCode(body)}", // i18n-ok
                        )
                        AppStrings.get(R.string.error_reset_email_failed)
                    }
                }
            } catch (e: Exception) {
                Log.e("AuthViewModel", "Password reset error", e)
                ErrorReportingService.reportException(ErrorReportingService.UserFlow.PASSWORD_RESET, e)
                AppStrings.get(R.string.error_network)
            }
            withContext(Dispatchers.Main) { onResult(error) }
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
                    reportAuthFailure(ErrorReportingService.UserFlow.SIGN_UP, response.code, responseBody)
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

                // Meta attribution — explicit signup flow.
                FacebookSDKHelper.logSignUp("email")
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Sign up error", e)
                ErrorReportingService.reportException(ErrorReportingService.UserFlow.SIGN_UP, e)
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
                    reportAuthFailure(ErrorReportingService.UserFlow.SIGN_IN_WITH_GOOGLE, response.code, responseBody)
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
                FacebookSDKHelper.logSignUp("google")
                withContext(Dispatchers.Main) {
                    _authState.value = AuthState.Authenticated(accessToken)
                }

            } catch (e: Exception) {
                Log.e("AuthViewModel", "Google sign in error", e)
                ErrorReportingService.reportException(ErrorReportingService.UserFlow.SIGN_IN_WITH_GOOGLE, e)
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