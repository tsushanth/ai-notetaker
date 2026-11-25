package com.kreativekoala.scribeai

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Reports backend 5xx responses. Deliberately ignores 4xx (auth/validation noise) and
 * IOExceptions (a user with no signal is not an app failure). Path only, never the query, ids replaced.
 */
class FailureReporterInterceptor(
    private val report: (flow: String, message: String) -> Unit = { flow, message -> FailureReporter.backendError(flow, message) },
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        // "Still generating" is a long job answering in the only way old clients retry, not a server fault.
        if (response.code >= 500 && !response.peekBody(PEEK_BYTES).string().contains(STILL_GENERATING)) {
            val url = chain.request().url
            report(
                "${chain.request().method} ${routeOf(url.encodedPath)}",
                "HTTP ${response.code} from ${url.host}",
            )
        }
        return response
    }

    companion object {
        private const val PEEK_BYTES = 512L
        private const val STILL_GENERATING = "TTS_STILL_GENERATING"
        private val ID = Regex("/(?:[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}|\\d+)(?=/|$)")

        fun routeOf(path: String): String = path.replace(ID, "/:id")
    }
}
