package com.kreativekoala.scribeai.recording

import com.google.gson.JsonParser
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.Buffer
import okio.source

/**
 * The real backend calls. [token] returns a bearer token, or null when there is none (the call then reports 401 and
 * the flow waits for the user to sign in again). Routes are the existing ones in routes/recordings.js; the extra
 * `client_recording_id` form field is ignored by an older backend.
 */
class HttpRecordingApi(
    private val baseUrl: String,
    private val token: suspend () -> String?,
    private val client: OkHttpClient = defaultClient()
) : RecordingApi {

    override suspend fun upload(file: File, title: String, clientId: String, onProgress: (Long, Long) -> Unit): ApiResult<String> {
        val bearer = token() ?: return ApiResult.Http(401, null)
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("audio", "$clientId.${RecordingConfig.FILE_EXTENSION}", ProgressFileBody(file, RecordingConfig.UPLOAD_MIME.toMediaType(), onProgress))
            .addFormDataPart("title", title.ifBlank { "Recording" })
            .addFormDataPart("client_recording_id", clientId)
            .build()
        val request = Request.Builder().url(baseUrl + "api/recordings/upload").addHeader("Authorization", "Bearer $bearer").post(body).build()
        return call(request) { code, text ->
            val id = runCatching { JsonParser.parseString(text).asJsonObject.getAsJsonObject("data").get("id").asString }.getOrNull()
            if (id.isNullOrBlank()) ApiResult.Http(code, text) else ApiResult.Ok(id)
        }
    }

    override suspend fun transcribe(serverRecordingId: String): ApiResult<TranscribeData> {
        val bearer = token() ?: return ApiResult.Http(401, null)
        val json = """{"recording_id":"$serverRecordingId"}""".toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url(baseUrl + "api/recordings/transcribe").addHeader("Authorization", "Bearer $bearer").post(json).build()
        return call(request, readTimeoutSec = 330) { _, text ->
            val noteId = runCatching { JsonParser.parseString(text).asJsonObject.getAsJsonObject("data").get("note_id")?.asString }.getOrNull()
            ApiResult.Ok(TranscribeData(noteId?.takeIf { it.isNotBlank() }))
        }
    }

    override suspend fun status(serverRecordingId: String): ApiResult<RemoteStatus> {
        val bearer = token() ?: return ApiResult.Http(401, null)
        val request = Request.Builder().url(baseUrl + "api/recordings/" + serverRecordingId).addHeader("Authorization", "Bearer $bearer").get().build()
        return call(request) { code, text ->
            val data = runCatching { JsonParser.parseString(text).asJsonObject.getAsJsonObject("data") }.getOrNull()
            if (data == null) ApiResult.Http(code, text) else {
                fun str(k: String): String? = data.get(k)?.takeIf { it.isJsonPrimitive }?.asString
                ApiResult.Ok(RemoteStatus(str("status"), str("error_message"), str("note_id")))
            }
        }
    }

    private suspend fun <T> call(request: Request, readTimeoutSec: Long? = null, parse: (Int, String?) -> ApiResult<T>): ApiResult<T> {
        val c = if (readTimeoutSec != null) client.newBuilder().readTimeout(readTimeoutSec, TimeUnit.SECONDS).build() else client
        return try {
            val response = c.newCall(request).await()
            val text = withContext(Dispatchers.IO) { response.use { it.body?.string() } }
            if (response.isSuccessful) parse(response.code, text) else ApiResult.Http(response.code, text)
        } catch (e: IOException) {
            ApiResult.Network(e.javaClass.simpleName)
        }
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}

/** Suspends until the call answers; cancelling the coroutine cancels the HTTP call. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (!cont.isCompleted) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) { cont.resume(response) }
    })
}

/** A file body that reports how many bytes have gone out. */
private class ProgressFileBody(
    private val file: File,
    private val type: MediaType,
    private val onProgress: (Long, Long) -> Unit
) : RequestBody() {
    override fun contentType() = type
    override fun contentLength() = file.length()
    override fun writeTo(sink: BufferedSink) {
        val total = file.length()
        var sent = 0L
        file.source().use { src ->
            val buf = Buffer()
            while (true) {
                val n = src.read(buf, 8192)
                if (n == -1L) break
                sink.write(buf, n)
                sent += n
                onProgress(sent, total)
            }
        }
    }
}
