package com.kreativekoala.scribeai.data.api

import com.kreativekoala.scribeai.FailureReporterInterceptor
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NetworkInterceptorsTest {

    private val reports = mutableListOf<String>()
    private var seen: Request? = null

    /** Runs a request through the interceptors against a fake server; nothing touches the network. */
    private fun call(path: String, status: Int, body: String = "{}"): Response {
        val server = Interceptor { chain ->
            seen = chain.request()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("m")
                .body(body.toResponseBody()).build()
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(FailureReporterInterceptor { flow, message -> reports.add("$flow|$message") })
            .addInterceptor(LongRequestInterceptor())
            .addInterceptor(server)
            .build()
        return client.newCall(Request.Builder().url("https://example.test$path").build()).execute()
    }

    @Test
    fun serverErrorsAreReportedWithoutIdsAndTheBodyStaysReadable() {
        val response = call("/api/notes/123e4567-e89b-12d3-a456-426614174000?token=x", 502, """{"error":"boom"}""")
        assertEquals(listOf("GET /api/notes/:id|HTTP 502 from example.test"), reports)
        assertEquals("""{"error":"boom"}""", response.body!!.string())
    }

    @Test
    fun clientErrorsAndStillGeneratingAreNotReported() {
        call("/api/ai/summary", 404)
        call("/api/tts/generate", 503, """{"code":"TTS_STILL_GENERATING"}""")
        assertTrue(reports.isEmpty())
    }

    @Test
    fun readAloudSaysHowLongTheAppWillWait() {
        call("/api/tts/generate", 200)
        assertEquals("270000", seen!!.header("x-tts-wait-ms"))
        call("/api/notes", 200)
        assertNull(seen!!.header("x-tts-wait-ms"))
        assertTrue(LongRequestInterceptor.isLong("/api/ai/mindmap"))
        assertTrue(LongRequestInterceptor.isLong("/api/recordings/transcribe"))
    }

    /** The reporter once existed without being attached to any client, so nothing was ever reported. */
    @Test
    fun everyBackendClientHasTheReporterAttached() {
        fun source(name: String) = listOf("src/main/java/com/kreativekoala/scribeai/$name", "app/src/main/java/com/kreativekoala/scribeai/$name")
            .map(::File).first { it.exists() }.readText()
        val expected = mapOf(
            "data/api/RetrofitClient.kt" to 2,
            "viewmodel/NoteViewModel.kt" to 1,
            "ui/screens/RecordingScreen.kt" to 2,
            "ui/screens/PDFUploadScreen.kt" to 1,
        )
        for ((file, count) in expected) {
            assertEquals(file, count, Regex("addInterceptor\\(FailureReporterInterceptor\\(\\)\\)").findAll(source(file)).count())
        }
    }
}
