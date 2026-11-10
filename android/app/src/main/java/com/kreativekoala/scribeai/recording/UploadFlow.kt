package com.kreativekoala.scribeai.recording

import java.io.File
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Result of one call to the backend, with no Android types so the flow can be unit-tested with a fake. */
sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    /** The server answered with an error status. */
    data class Http(val code: Int, val body: String?) : ApiResult<Nothing>
    /** No answer: no connection, timeout, TLS failure. */
    data class Network(val message: String? = null) : ApiResult<Nothing>
}

data class TranscribeData(val noteId: String?)
data class RemoteStatus(val status: String?, val errorMessage: String?, val noteId: String?)

/** The three calls the app makes for a recording. All use routes that already exist (no backend change). */
interface RecordingApi {
    /** POST /api/recordings/upload (multipart). Returns the server's recording id. */
    suspend fun upload(file: File, title: String, clientId: String, onProgress: (sent: Long, total: Long) -> Unit): ApiResult<String>
    /** POST /api/recordings/transcribe. Synchronous on the server: can take minutes for a long recording. */
    suspend fun transcribe(serverRecordingId: String): ApiResult<TranscribeData>
    /** GET /api/recordings/:id, the real job status (`status`: processing, completed, failed; `error_message`). */
    suspend fun status(serverRecordingId: String): ApiResult<RemoteStatus>
}

enum class SendPhase { QUEUED, UPLOADING, TRANSCRIBING, WAITING_RETRY, DONE, FAILED }

/** What the screen shows for a recording being sent. Driven only by real results, never by a timer. */
data class UploadProgress(
    val id: String,
    val phase: SendPhase,
    /** 0-100 while uploading. */
    val percent: Int? = null,
    val attempt: Int = 0,
    /** Wall-clock time of the next automatic retry, when [phase] is WAITING_RETRY. */
    val retryAtMs: Long? = null,
    val failure: Failure? = null,
    val noteId: String? = null
)

fun interface ProgressSink { fun publish(p: UploadProgress) }

/** Process-wide progress, read by the recording screen. The sending work runs in the same process as the app. */
object UploadProgressBus : ProgressSink {
    private val _state = MutableStateFlow<Map<String, UploadProgress>>(emptyMap())
    val state: StateFlow<Map<String, UploadProgress>> = _state

    override fun publish(p: UploadProgress) { _state.value = _state.value + (p.id to p) }
    fun clear(id: String) { _state.value = _state.value - id }
}

/** Retry and polling rules. */
object UploadPolicy {
    /** Waits between failed attempts: 5 s, 15 s, 45 s, 2 min, 5 min, then 10 min. */
    private val BACKOFF_MS = longArrayOf(5_000, 15_000, 45_000, 120_000, 300_000, 600_000)
    /** Attempts inside one run of the sending work before it hands back to the scheduler. */
    const val ATTEMPTS_PER_RUN = 3
    /** Attempts over the life of a recording before the user is asked to retry by hand. */
    const val MAX_TOTAL_ATTEMPTS = 12
    const val POLL_INTERVAL_MS = 5_000L
    const val POLL_BUDGET_MS = 5 * 60_000L

    /** [failures] is how many attempts have failed so far (1 after the first failure). */
    fun backoffMs(failures: Int): Long = BACKOFF_MS[(failures - 1).coerceIn(0, BACKOFF_MS.lastIndex)]

    enum class UploadFailureClass { RETRY, REFRESH_AUTH_THEN_RETRY, FINAL }

    fun classifyUploadFailure(httpCode: Int?): UploadFailureClass = when {
        httpCode == null -> UploadFailureClass.RETRY
        httpCode == 401 -> UploadFailureClass.REFRESH_AUTH_THEN_RETRY
        httpCode == 408 || httpCode == 425 || httpCode == 429 || httpCode >= 500 -> UploadFailureClass.RETRY
        else -> UploadFailureClass.FINAL // 400, 403, 404, 413, 415, 422: sending the same file again cannot help
    }

    /** Short code for analytics. */
    fun failureKindCode(httpCode: Int?): String = when {
        httpCode == null -> "network"
        httpCode == 401 || httpCode == 403 -> "auth"
        httpCode == 413 -> "too_large"
        httpCode == 429 -> "limit"
        httpCode >= 500 -> "server"
        else -> "client"
    }
}

/**
 * Sends one recording: upload, then transcription, resuming from the phase stored in its manifest. Safe to run again
 * after a crash or a cancelled worker: an upload that already got a server id is not repeated, and before asking
 * for a transcription the flow reads the server's real status first (so a request that finished while the app was
 * dead is not paid for twice).
 *
 * The audio file is deleted only when the note exists. A final failure keeps the manifest (and the audio, if it was
 * never uploaded) so the screen can show why.
 */
class UploadFlow(
    private val store: PendingRecordingStore,
    private val api: RecordingApi,
    private val telemetry: RecordingTelemetry,
    private val progress: ProgressSink,
    private val sleep: suspend (Long) -> Unit,
    private val now: () -> Long
) {
    sealed interface Outcome {
        data class Done(val noteId: String?) : Outcome
        data class Final(val failure: Failure) : Outcome
        /** Could not finish now (no network, server busy). Try again later; nothing is lost. */
        data object RetryLater : Outcome
    }

    suspend fun run(id: String, trigger: String): Outcome {
        var p = store.load(id) ?: return Outcome.Final(Failure(FailureKind.UNKNOWN))
        if (p.phase == RecordingPhase.DONE) return Outcome.Done(p.noteId)
        if (p.phase == RecordingPhase.FAILED) {
            return Outcome.Final(Failure(runCatching { FailureKind.valueOf(p.failureKind ?: "") }.getOrDefault(FailureKind.UNKNOWN)))
        }
        progress.publish(UploadProgress(id, SendPhase.QUEUED))

        if (p.serverRecordingId == null) {
            val audio = store.audioFile(id)
            if (!audio.exists() || audio.length() == 0L) return finalFailure(id, Failure(FailureKind.UNKNOWN), 0L)
            var attemptsThisRun = 0
            while (true) {
                p = store.update(id) { it.copy(phase = RecordingPhase.UPLOADING, uploadAttempts = it.uploadAttempts + 1) }
                    ?: return Outcome.Final(Failure(FailureKind.UNKNOWN))
                val attempt = p.uploadAttempts
                progress.publish(UploadProgress(id, SendPhase.UPLOADING, percent = 0, attempt = attempt))
                telemetry.track(RecordingEvents.UPLOAD_STARTED, mapOf("local_id" to id, "attempt" to attempt, "bytes" to audio.length(), "trigger" to trigger))
                val started = now()
                var lastPercent = -1
                val result = api.upload(audio, p.title, id) { sent, total ->
                    val pct = if (total > 0) ((sent * 100) / total).toInt().coerceIn(0, 100) else 0
                    if (pct != lastPercent) {
                        lastPercent = pct
                        progress.publish(UploadProgress(id, SendPhase.UPLOADING, percent = pct, attempt = attempt))
                    }
                }
                when (result) {
                    is ApiResult.Ok -> {
                        store.update(id) { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = result.value) }
                        telemetry.track(RecordingEvents.UPLOAD_COMPLETED, mapOf(
                            "local_id" to id, "server_recording_id" to result.value.lowercase(), "attempt" to attempt,
                            "bytes" to audio.length(), "elapsed_ms" to (now() - started)
                        ))
                        break
                    }
                    is ApiResult.Http, is ApiResult.Network -> {
                        val code = (result as? ApiResult.Http)?.code
                        val body = (result as? ApiResult.Http)?.body
                        val cls = UploadPolicy.classifyUploadFailure(code)
                        val giveUp = cls == UploadPolicy.UploadFailureClass.FINAL || attempt >= UploadPolicy.MAX_TOTAL_ATTEMPTS
                        telemetry.track(RecordingEvents.UPLOAD_FAILED, mapOf(
                            "local_id" to id, "attempt" to attempt, "http_code" to (code ?: 0),
                            "kind" to UploadPolicy.failureKindCode(code), "will_retry" to !giveUp
                        ))
                        if (giveUp) {
                            val f = if (cls == UploadPolicy.UploadFailureClass.FINAL) FailureReasons.fromHttp(code, body) else Failure(FailureKind.NETWORK)
                            return finalFailure(id, f, started)
                        }
                        attemptsThisRun++
                        val wait = UploadPolicy.backoffMs(attempt)
                        store.update(id) { it.copy(phase = RecordingPhase.WAITING) }
                        progress.publish(UploadProgress(id, SendPhase.WAITING_RETRY, attempt = attempt, retryAtMs = now() + wait))
                        // Auth problems need the scheduler (a token refresh), not a tight loop.
                        if (cls == UploadPolicy.UploadFailureClass.REFRESH_AUTH_THEN_RETRY || attemptsThisRun >= UploadPolicy.ATTEMPTS_PER_RUN) {
                            return Outcome.RetryLater
                        }
                        sleep(wait)
                    }
                }
            }
        }
        return transcribe(id)
    }

    private suspend fun transcribe(id: String): Outcome {
        val p = store.update(id) { it.copy(phase = RecordingPhase.TRANSCRIBING) } ?: return Outcome.Final(Failure(FailureKind.UNKNOWN))
        val serverId = p.serverRecordingId ?: return Outcome.Final(Failure(FailureKind.UNKNOWN))
        val attempt = p.uploadAttempts
        val started = now()
        progress.publish(UploadProgress(id, SendPhase.TRANSCRIBING, attempt = attempt))

        // Real status first: the request may have finished (or still be running) from an earlier run.
        when (val s = api.status(serverId)) {
            is ApiResult.Ok -> when (s.value.status?.lowercase()) {
                "completed" -> return success(id, serverId, s.value.noteId, started)
                "failed" -> {
                    val f = FailureReasons.fromStoredError(s.value.errorMessage)
                    if (!f.kind.retryable) return finalFailure(id, f, started, serverId)
                    // A service-side failure: asking again is the right retry.
                }
                "processing" -> return pollUntilFinished(id, serverId, started)
            }
            is ApiResult.Http -> if (s.code == 404) return finalFailure(id, Failure(FailureKind.UNKNOWN, "not_found"), started, serverId)
            is ApiResult.Network -> return waitLater(id, attempt)
        }

        return when (val r = api.transcribe(serverId)) {
            is ApiResult.Ok -> success(id, serverId, r.value.noteId, started)
            is ApiResult.Http -> {
                val f = FailureReasons.fromHttp(r.code, r.body)
                when {
                    // A 5xx or a gateway timeout does not mean the work stopped: look at the real status.
                    r.code >= 500 -> pollUntilFinished(id, serverId, started)
                    f.kind == FailureKind.AUTH -> waitLater(id, attempt)
                    else -> finalFailure(id, f, started, serverId)
                }
            }
            // The call is synchronous on the server: a dropped connection mid-transcription is common on a phone.
            is ApiResult.Network -> pollUntilFinished(id, serverId, started)
        }
    }

    private suspend fun pollUntilFinished(id: String, serverId: String, started: Long): Outcome {
        val attempt = store.load(id)?.uploadAttempts ?: 0
        val deadline = now() + UploadPolicy.POLL_BUDGET_MS
        while (now() < deadline) {
            sleep(UploadPolicy.POLL_INTERVAL_MS)
            val s = api.status(serverId)
            if (s is ApiResult.Ok) {
                when (s.value.status?.lowercase()) {
                    "completed" -> return success(id, serverId, s.value.noteId, started)
                    "failed" -> {
                        val f = FailureReasons.fromStoredError(s.value.errorMessage)
                        return if (f.kind.retryable) waitLater(id, attempt) else finalFailure(id, f, started, serverId)
                    }
                }
            }
        }
        telemetry.track(RecordingEvents.TRANSCRIPTION_OUTCOME, mapOf(
            "local_id" to id, "server_recording_id" to serverId.lowercase(), "outcome" to "gave_up",
            "failure_kind" to FailureKind.SERVICE, "elapsed_ms" to (now() - started)
        ))
        return waitLater(id, attempt)
    }

    private fun waitLater(id: String, attempt: Int): Outcome {
        store.update(id) { it.copy(phase = RecordingPhase.WAITING) }
        progress.publish(UploadProgress(id, SendPhase.WAITING_RETRY, attempt = attempt))
        return Outcome.RetryLater
    }

    private fun success(id: String, serverId: String, noteId: String?, started: Long): Outcome {
        telemetry.track(RecordingEvents.TRANSCRIPTION_OUTCOME, mapOf(
            "local_id" to id, "server_recording_id" to serverId.lowercase(), "outcome" to "completed",
            "error_code" to "none", "elapsed_ms" to (now() - started)
        ))
        telemetry.flush()
        progress.publish(UploadProgress(id, SendPhase.DONE, noteId = noteId))
        store.delete(id) // the note exists: the audio and the manifest are no longer needed
        return Outcome.Done(noteId)
    }

    private fun finalFailure(id: String, f: Failure, started: Long, serverId: String? = null): Outcome {
        store.update(id) {
            it.copy(phase = RecordingPhase.FAILED, failureKind = f.kind.name, failureMessage = f.serverText)
        }
        if (serverId != null) {
            // The server holds the audio; a final transcription failure does not need the local copy either
            // (unless the server says it no longer has the recording: then ours is the only copy).
            if (f.code != "not_found") store.deleteAudio(id)
            telemetry.track(RecordingEvents.TRANSCRIPTION_OUTCOME, mapOf(
                "local_id" to id, "server_recording_id" to serverId.lowercase(), "outcome" to "failed",
                "error_code" to (f.code ?: "none").lowercase(), "failure_kind" to f.kind, "elapsed_ms" to (now() - started)
            ))
        }
        telemetry.flush()
        progress.publish(UploadProgress(id, SendPhase.FAILED, failure = f))
        return Outcome.Final(f)
    }
}
