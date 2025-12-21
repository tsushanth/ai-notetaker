package com.kreativekoala.scribeai.utils

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "auth_prefs")

class AuthManager(private val context: Context) {

    companion object {
        private val AUTH_TOKEN_KEY = stringPreferencesKey(Constants.PREF_AUTH_TOKEN)
        private val REFRESH_TOKEN_KEY = stringPreferencesKey("refresh_token")  // NEW
        private val USER_ID_KEY = stringPreferencesKey(Constants.PREF_USER_ID)
        private const val TAG = "AuthManager"

        // Refresh token if it expires within 5 minutes
        private const val REFRESH_THRESHOLD_MS = 5 * 60 * 1000L

        // Supabase config - should match AuthViewModel
        private const val SUPABASE_URL = "https://shufmkocfnjnlwshqrue.supabase.co"
        private const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNodWZta29jZm5qbmx3c2hxcnVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNzkzMTksImV4cCI6MjA3Nzg1NTMxOX0.WPmgPldx4bt82JCr7K-20-z-53q8926qtDV5rLMSAnw"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // Mutex to prevent multiple simultaneous refresh attempts
    private val refreshMutex = Mutex()

    // HTTP client for token refresh
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    // Cached tokens
    private val _authToken = MutableStateFlow<String?>(null)
    val authToken: StateFlow<String?> = _authToken.asStateFlow()

    private val _refreshToken = MutableStateFlow<String?>(null)

    private val _userId = MutableStateFlow<String?>(null)
    val userId: StateFlow<String?> = _userId.asStateFlow()

    init {
        // Load cached tokens on init
        scope.launch {
            loadCachedAuth()
        }
    }

    /**
     * Load cached auth from DataStore
     */
    private suspend fun loadCachedAuth() {
        try {
            val preferences = context.dataStore.data.first()
            val token = preferences[AUTH_TOKEN_KEY]
            val refresh = preferences[REFRESH_TOKEN_KEY]
            val userId = preferences[USER_ID_KEY]

            _refreshToken.value = refresh
            _userId.value = userId

            if (token != null && !isTokenExpired(token)) {
                _authToken.value = token
                Log.d(TAG, "Loaded valid cached token")
            } else if (token != null && refresh != null) {
                Log.w(TAG, "Cached token expired, will refresh on next request")
                // Don't refresh immediately - wait until token is actually needed
                _authToken.value = token  // Keep expired token, refresh when needed
            } else if (token != null) {
                Log.w(TAG, "Token expired and no refresh token available")
                // Clear everything - user needs to log in again
                clearAuth()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading cached auth", e)
        }
    }

    /**
     * Check if user is currently authenticated
     */
    fun isAuthenticated(): Boolean {
        val token = _authToken.value
        val refresh = _refreshToken.value

        // User is authenticated if they have a valid token OR a refresh token
        val isAuth = (token != null && !isTokenExpired(token)) || refresh != null
        Log.d(TAG, "isAuthenticated: $isAuth (hasToken: ${token != null}, hasRefresh: ${refresh != null})")
        return isAuth
    }

    /**
     * Get current auth token - will auto-refresh if expired
     * This is the main method to use for API calls
     */
    fun getCurrentToken(): String? {
        val token = _authToken.value

        // If no token at all, return null
        if (token == null) {
            Log.d(TAG, "No token available")
            return null
        }

        // If token is valid and not expiring soon, return it
        if (!isTokenExpired(token) && !willExpireSoon(token)) {
            return token
        }

        // Token is expired or expiring soon - try to refresh
        Log.d(TAG, "Token expired or expiring soon, attempting refresh")
        return refreshTokenBlocking()
    }

    /**
     * Refresh the access token using the refresh token (blocking version)
     */
    private fun refreshTokenBlocking(): String? {
        return runBlocking(Dispatchers.IO) {
            refreshToken()
        }
    }

    /**
     * Refresh the access token using the refresh token (suspend version)
     */
    suspend fun refreshToken(): String? {
        return refreshMutex.withLock {
            // Double-check after acquiring lock - another thread might have refreshed
            val currentToken = _authToken.value
            if (currentToken != null && !isTokenExpired(currentToken) && !willExpireSoon(currentToken)) {
                Log.d(TAG, "Token was refreshed by another thread")
                return@withLock currentToken
            }

            val refresh = _refreshToken.value
            if (refresh == null) {
                Log.e(TAG, "No refresh token available")
                return@withLock null
            }

            try {
                Log.d(TAG, "Refreshing token from Supabase...")

                val json = JSONObject().apply {
                    put("refresh_token", refresh)
                }

                val request = Request.Builder()
                    .url("$SUPABASE_URL/auth/v1/token?grant_type=refresh_token")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", SUPABASE_KEY)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                if (!response.isSuccessful) {
                    Log.e(TAG, "Token refresh failed: ${response.code} - $responseBody")

                    // If refresh token is invalid, clear auth - user needs to log in again
                    if (response.code == 400 || response.code == 401) {
                        Log.e(TAG, "Refresh token invalid, clearing auth")
                        withContext(Dispatchers.IO) {
                            clearAuth()
                        }
                    }
                    return@withLock null
                }

                val jsonResponse = JSONObject(responseBody ?: "")
                val newAccessToken = jsonResponse.optString("access_token")
                val newRefreshToken = jsonResponse.optString("refresh_token")

                if (newAccessToken.isEmpty()) {
                    Log.e(TAG, "No access token in refresh response")
                    return@withLock null
                }

                Log.d(TAG, "✅ Token refreshed successfully")

                // Update in-memory cache
                _authToken.value = newAccessToken
                if (newRefreshToken.isNotEmpty()) {
                    _refreshToken.value = newRefreshToken
                }

                // Persist to DataStore
                context.dataStore.edit { preferences ->
                    preferences[AUTH_TOKEN_KEY] = newAccessToken
                    if (newRefreshToken.isNotEmpty()) {
                        preferences[REFRESH_TOKEN_KEY] = newRefreshToken
                    }
                }

                return@withLock newAccessToken

            } catch (e: Exception) {
                Log.e(TAG, "Error refreshing token", e)
                return@withLock null
            }
        }
    }

    /**
     * Get a fresh token - suspending function that ensures token is valid
     * Use this for important operations
     */
    suspend fun getFreshToken(): String? {
        val currentToken = _authToken.value

        // If token is valid and not expiring soon, return it
        if (currentToken != null && !isTokenExpired(currentToken) && !willExpireSoon(currentToken)) {
            return currentToken
        }

        // Refresh the token
        return refreshToken()
    }

    /**
     * Get current user ID synchronously
     */
    fun getCurrentUserId(): String? {
        return _userId.value
    }

    /**
     * Save auth after login - NOW INCLUDES REFRESH TOKEN
     */
    suspend fun saveAuth(accessToken: String, refreshToken: String, userId: String) {
        Log.d(TAG, "Saving auth tokens and user ID")

        // Update in-memory cache
        _authToken.value = accessToken
        _refreshToken.value = refreshToken
        _userId.value = userId

        // Persist to DataStore
        context.dataStore.edit { preferences ->
            preferences[AUTH_TOKEN_KEY] = accessToken
            preferences[REFRESH_TOKEN_KEY] = refreshToken
            preferences[USER_ID_KEY] = userId
        }
    }

    /**
     * Legacy method for compatibility - prefer saveAuth with refresh token
     */
    suspend fun saveAuthToken(token: String) {
        Log.d(TAG, "Saving auth token (legacy method)")
        _authToken.value = token
        context.dataStore.edit { preferences ->
            preferences[AUTH_TOKEN_KEY] = token
        }
    }

    /**
     * Save refresh token separately
     */
    suspend fun saveRefreshToken(token: String) {
        Log.d(TAG, "Saving refresh token")
        _refreshToken.value = token
        context.dataStore.edit { preferences ->
            preferences[REFRESH_TOKEN_KEY] = token
        }
    }

    /**
     * Save user ID
     */
    suspend fun saveUserId(userId: String) {
        Log.d(TAG, "Saving user ID: $userId")
        _userId.value = userId
        context.dataStore.edit { preferences ->
            preferences[USER_ID_KEY] = userId
        }
    }

    /**
     * Clear auth on logout
     */
    suspend fun clearAuth() {
        Log.d(TAG, "Clearing auth")
        _authToken.value = null
        _refreshToken.value = null
        _userId.value = null

        context.dataStore.edit { preferences ->
            preferences.remove(AUTH_TOKEN_KEY)
            preferences.remove(REFRESH_TOKEN_KEY)
            preferences.remove(USER_ID_KEY)
        }
    }

    /**
     * Sign out - clears local auth
     */
    fun signOut() {
        scope.launch {
            clearAuth()
        }
    }

    /**
     * Get auth header for API calls
     */
    fun getAuthHeader(token: String? = null): String {
        return token ?: _authToken.value ?: ""
    }

    /**
     * Check if a JWT token is expired
     */
    fun isTokenExpired(token: String): Boolean {
        try {
            val parts = token.split(".")
            if (parts.size != 3) {
                Log.e(TAG, "Invalid token format")
                return true
            }

            // Decode the payload (second part)
            val payload = String(
                Base64.decode(
                    parts[1],
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
                )
            )
            val json = JSONObject(payload)

            // Get expiration time (exp is in seconds)
            val exp = json.optLong("exp", 0)
            if (exp == 0L) {
                Log.e(TAG, "Token has no expiration")
                return true
            }

            // Current time in seconds
            val currentTime = System.currentTimeMillis() / 1000

            // Token is expired if current time is past expiration
            val isExpired = currentTime >= exp

            if (isExpired) {
                Log.w(TAG, "Token expired at: $exp, current: $currentTime")
            }

            return isExpired
        } catch (e: Exception) {
            Log.e(TAG, "Error checking token expiration", e)
            return true // Treat as expired if we can't parse it
        }
    }

    /**
     * Get token expiration time in milliseconds
     */
    fun getTokenExpirationTime(token: String): Long? {
        try {
            val parts = token.split(".")
            if (parts.size != 3) return null

            val payload = String(
                Base64.decode(
                    parts[1],
                    Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
                )
            )
            val json = JSONObject(payload)

            val exp = json.optLong("exp", 0)
            if (exp == 0L) return null

            return exp * 1000 // Convert to milliseconds
        } catch (e: Exception) {
            Log.e(TAG, "Error getting token expiration", e)
            return null
        }
    }

    /**
     * Get time until token expires in milliseconds
     */
    fun getTimeUntilExpiration(token: String): Long? {
        val expirationTime = getTokenExpirationTime(token) ?: return null
        val currentTime = System.currentTimeMillis()
        val timeRemaining = expirationTime - currentTime
        return if (timeRemaining > 0) timeRemaining else 0
    }

    /**
     * Check if token will expire within the specified time (in milliseconds)
     * Default: 5 minutes
     */
    fun willExpireSoon(token: String, withinMillis: Long = REFRESH_THRESHOLD_MS): Boolean {
        val timeRemaining = getTimeUntilExpiration(token) ?: return true
        return timeRemaining < withinMillis
    }
}