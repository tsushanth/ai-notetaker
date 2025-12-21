package com.kreativekoala.scribeai.data.api

import android.util.Log
import com.google.gson.GsonBuilder
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.data.models.FlexibleQuizQuestionAdapter
import com.kreativekoala.scribeai.data.models.QuizQuestionsWrapper
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

/**
 * Network error types for better error handling
 */
sealed class NetworkError(val message: String, val isRetryable: Boolean) {
    class Timeout(message: String = "Request timed out. Please try again.") : NetworkError(message, true)
    class NoConnection(message: String = "No internet connection. Please check your network.") : NetworkError(message, true)
    class ServerError(message: String = "Server error. Please try again later.") : NetworkError(message, true)
    class SSLError(message: String = "Secure connection failed. Please try again.") : NetworkError(message, true)
    class ClientError(message: String, isRetryable: Boolean = false) : NetworkError(message, isRetryable)
    class Unknown(message: String = "An unexpected error occurred.") : NetworkError(message, false)
}

/**
 * Retry interceptor with exponential backoff
 * Matches iOS behavior for retry logic
 */
class RetryInterceptor(
    private val maxRetries: Int = 3,
    private val initialDelayMs: Long = 1000L,
    private val maxDelayMs: Long = 10000L
) : Interceptor {

    companion object {
        private const val TAG = "RetryInterceptor"
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        var lastException: IOException? = null
        var currentDelay = initialDelayMs

        for (attempt in 0..maxRetries) {
            try {
                if (attempt > 0) {
                    Log.d(TAG, "🔄 Retry attempt $attempt for ${request.url}")
                    Thread.sleep(currentDelay)
                    currentDelay = minOf(currentDelay * 2, maxDelayMs)
                }

                val response = chain.proceed(request)

                // Retry on server errors (5xx) if retryable
                if (response.code in 500..599 && attempt < maxRetries && isRetryableRequest(request)) {
                    Log.d(TAG, "⚠️ Server error ${response.code}, will retry")
                    response.close()
                    continue
                }

                return response

            } catch (e: SocketTimeoutException) {
                Log.e(TAG, "⏱️ Timeout on attempt $attempt: ${e.message}")
                lastException = e
                if (attempt >= maxRetries || !isRetryableRequest(request)) throw e

            } catch (e: UnknownHostException) {
                Log.e(TAG, "🌐 No connection on attempt $attempt: ${e.message}")
                lastException = e
                if (attempt >= maxRetries || !isRetryableRequest(request)) throw e

            } catch (e: SSLException) {
                Log.e(TAG, "🔒 SSL error on attempt $attempt: ${e.message}")
                lastException = e
                if (attempt >= maxRetries) throw e

            } catch (e: IOException) {
                Log.e(TAG, "❌ IO error on attempt $attempt: ${e.message}")
                lastException = e
                if (attempt >= maxRetries || !isRetryableRequest(request)) throw e
            }
        }

        throw lastException ?: IOException("Request failed after $maxRetries retries")
    }

    /**
     * Determine if a request can be safely retried
     * POST/PUT/DELETE for idempotent endpoints can be retried
     */
    private fun isRetryableRequest(request: Request): Boolean {
        val method = request.method
        val path = request.url.encodedPath

        // GET requests are always safe to retry
        if (method == "GET") return true

        // Uploads and transcription shouldn't be auto-retried (handled at higher level)
        if (path.contains("/upload") || path.contains("/transcribe")) return false

        // AI generation endpoints - don't auto-retry (expensive operations)
        if (path.contains("/ai/")) return false

        return true
    }
}

object RetrofitClient {

    private const val TAG = "RetrofitClient"

    // Default timeouts
    private const val DEFAULT_CONNECT_TIMEOUT = 30L
    private const val DEFAULT_READ_TIMEOUT = 120L
    private const val DEFAULT_WRITE_TIMEOUT = 120L

    // Extended timeouts for large content
    private const val EXTENDED_READ_TIMEOUT = 300L  // 5 minutes for AI/transcription
    private const val EXTENDED_WRITE_TIMEOUT = 180L // 3 minutes for uploads

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BODY
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }

    private val retryInterceptor = RetryInterceptor(
        maxRetries = 3,
        initialDelayMs = 1000L,
        maxDelayMs = 10000L
    )

    /**
     * Default OkHttpClient with standard timeouts
     */
    private val defaultOkHttpClient = OkHttpClient.Builder()
        .addInterceptor(retryInterceptor)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(DEFAULT_CONNECT_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(DEFAULT_READ_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(DEFAULT_WRITE_TIMEOUT, TimeUnit.SECONDS)
        .build()

    /**
     * Extended timeout client for AI operations and large uploads
     */
    val extendedTimeoutClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(retryInterceptor)
        .addInterceptor(loggingInterceptor)
        .connectTimeout(DEFAULT_CONNECT_TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(EXTENDED_READ_TIMEOUT, TimeUnit.SECONDS)
        .writeTimeout(EXTENDED_WRITE_TIMEOUT, TimeUnit.SECONDS)
        .build()

    /**
     * Custom Gson instance with type adapters for flexible JSON parsing
     */
    private val gson = GsonBuilder()
        .registerTypeAdapter(QuizQuestionsWrapper::class.java, FlexibleQuizQuestionAdapter())
        .create()

    private val retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_URL)
        .client(defaultOkHttpClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()

    val apiService: ApiService = retrofit.create(ApiService::class.java)

    /**
     * Calculate dynamic timeout based on content size
     * Similar to iOS implementation
     */
    fun calculateTimeout(contentLength: Long, isAIOperation: Boolean = false): Long {
        val baseSecs = if (isAIOperation) 120L else 60L

        return when {
            contentLength <= 0 -> baseSecs
            contentLength < 1_000_000 -> baseSecs  // < 1MB
            contentLength < 10_000_000 -> baseSecs + 60  // 1-10MB
            contentLength < 50_000_000 -> baseSecs + 120 // 10-50MB
            else -> baseSecs + 180  // 50MB+
        }
    }

    /**
     * Get a client with custom timeouts for specific operations
     */
    fun getClientWithTimeout(
        readTimeoutSecs: Long,
        writeTimeoutSecs: Long = readTimeoutSecs
    ): OkHttpClient {
        return defaultOkHttpClient.newBuilder()
            .readTimeout(readTimeoutSecs, TimeUnit.SECONDS)
            .writeTimeout(writeTimeoutSecs, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Parse network exceptions into user-friendly error messages
     */
    fun parseNetworkError(throwable: Throwable): NetworkError {
        return when (throwable) {
            is SocketTimeoutException -> NetworkError.Timeout()
            is UnknownHostException -> NetworkError.NoConnection()
            is SSLException -> NetworkError.SSLError()
            is IOException -> {
                val message = throwable.message?.lowercase() ?: ""
                when {
                    message.contains("timeout") -> NetworkError.Timeout()
                    message.contains("connection") -> NetworkError.NoConnection()
                    message.contains("ssl") || message.contains("certificate") -> NetworkError.SSLError()
                    else -> NetworkError.Unknown(throwable.message ?: "Network error occurred")
                }
            }
            else -> NetworkError.Unknown(throwable.message ?: "An unexpected error occurred")
        }
    }
}
