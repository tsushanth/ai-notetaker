package com.kreativekoala.scribeai.data.api

import okhttp3.Interceptor
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * AI generation, Read Aloud and transcription can take longer than the default two minutes. Wait for them, and tell the
 * server how long Read Aloud may take before it should answer "still generating".
 */
class LongRequestInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val path = request.url.encodedPath
        if (!isLong(path)) return chain.proceed(request)
        val sent = if (path == TTS_PATH) request.newBuilder().header("x-tts-wait-ms", TTS_SERVER_WAIT_MS.toString()).build() else request
        return chain.withReadTimeout(LONG_READ_SECONDS, TimeUnit.SECONDS).proceed(sent)
    }

    companion object {
        const val TTS_PATH = "/api/tts/generate"
        const val LONG_READ_SECONDS = 300
        const val TTS_SERVER_WAIT_MS = 270_000

        fun isLong(path: String): Boolean =
            path == TTS_PATH || path.startsWith("/api/ai/") || path == "/api/recordings/transcribe"
    }
}
