package com.kreativekoala.scribeai.recording

import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UploadFlowTest {
    @get:Rule val tmp = TemporaryFolder()

    /** Scripted backend: each call pops the next prepared answer (the last one repeats). */
    private class FakeApi : RecordingApi {
        val uploads = ArrayDeque<ApiResult<String>>()
        val transcribes = ArrayDeque<ApiResult<TranscribeData>>()
        val statuses = ArrayDeque<ApiResult<RemoteStatus>>()
        var uploadCalls = 0
        var transcribeCalls = 0
        var statusCalls = 0
        override suspend fun upload(file: File, title: String, clientId: String, onProgress: (Long, Long) -> Unit): ApiResult<String> {
            uploadCalls++
            onProgress(file.length() / 2, file.length()); onProgress(file.length(), file.length())
            return if (uploads.size > 1) uploads.removeFirst() else uploads.first()
        }
        override suspend fun transcribe(serverRecordingId: String): ApiResult<TranscribeData> {
            transcribeCalls++
            return if (transcribes.size > 1) transcribes.removeFirst() else transcribes.first()
        }
        override suspend fun status(serverRecordingId: String): ApiResult<RemoteStatus> {
            statusCalls++
            return if (statuses.size > 1) statuses.removeFirst() else statuses.first()
        }
    }

    private class ListSink : EventSink {
        val events = mutableListOf<Pair<String, Map<String, Any>>>()
        override fun send(name: String, props: Map<String, Any>) { events += name to props }
        fun names() = events.map { it.first }
        fun of(name: String) = events.filter { it.first == name }.map { it.second }
    }

    private class Progress : ProgressSink {
        val seen = mutableListOf<UploadProgress>()
        override fun publish(p: UploadProgress) { seen += p }
        fun phases() = seen.map { it.phase }
    }

    private lateinit var store: PendingRecordingStore
    private val api = FakeApi()
    private val sink = ListSink()
    private val progress = Progress()
    private val delays = mutableListOf<Long>()
    private var clock = 1_000_000L

    private fun flow() = UploadFlow(
        store, api, RecordingTelemetry(sink, { emptyMap() }), progress,
        sleep = { delays += it; clock += it }, now = { clock }
    )

    private fun run(trigger: String = "user") = runBlocking { flow().run("rec1", trigger) }

    private fun noStatus() = RemoteStatus("uploaded", null, null)

    @Before
    fun setUp() {
        store = PendingRecordingStore(File(tmp.root, "recordings"))
        store.save(PendingRecording(id = "rec1", phase = RecordingPhase.RECORDED, createdAtMs = 1, durationMs = 30_000, bytes = 1000))
        store.audioFile("rec1").writeBytes(ByteArray(1000) { 1 })
        api.statuses.add(ApiResult.Ok(noStatus()))
    }

    @Test
    fun happyPathUploadsTranscribesAndCleansUp() {
        api.uploads.add(ApiResult.Ok("srv-1"))
        api.transcribes.add(ApiResult.Ok(TranscribeData("note-9")))
        val out = run()
        assertEquals(UploadFlow.Outcome.Done("note-9"), out)
        assertEquals(1, api.uploadCalls)
        assertEquals(1, api.transcribeCalls)
        assertNull(store.load("rec1"))
        assertFalse(store.audioFile("rec1").exists())
        assertEquals(SendPhase.DONE, progress.seen.last().phase)
        assertEquals("note-9", progress.seen.last().noteId)
        assertEquals(
            listOf(RecordingEvents.UPLOAD_STARTED, RecordingEvents.UPLOAD_COMPLETED, RecordingEvents.TRANSCRIPTION_OUTCOME),
            sink.names()
        )
        assertEquals("completed", sink.of(RecordingEvents.TRANSCRIPTION_OUTCOME).single()["outcome"])
    }

    @Test
    fun uploadProgressComesFromBytesSent() {
        api.uploads.add(ApiResult.Ok("srv-1"))
        api.transcribes.add(ApiResult.Ok(TranscribeData("n")))
        run()
        val percents = progress.seen.filter { it.phase == SendPhase.UPLOADING }.mapNotNull { it.percent }
        assertTrue(percents.containsAll(listOf(0, 50, 100)))
    }

    @Test
    fun networkFailuresRetryWithBackoffThenSucceed() {
        api.uploads.add(ApiResult.Network("timeout"))
        api.uploads.add(ApiResult.Http(503, "busy"))
        api.uploads.add(ApiResult.Ok("srv-1"))
        api.transcribes.add(ApiResult.Ok(TranscribeData("n")))
        val out = run()
        assertTrue(out is UploadFlow.Outcome.Done)
        assertEquals(3, api.uploadCalls)
        assertEquals(listOf(5_000L, 15_000L), delays) // 5 s, then 15 s
        val failed = sink.of(RecordingEvents.UPLOAD_FAILED)
        assertEquals(2, failed.size)
        assertEquals(true, failed[0]["will_retry"])
        assertEquals("network", failed[0]["kind"])
        assertEquals("server", failed[1]["kind"])
        assertTrue(progress.phases().contains(SendPhase.WAITING_RETRY))
    }

    @Test
    fun afterThreeFailedAttemptsTheRunHandsBackAndTheNextRunContinues() {
        api.uploads.add(ApiResult.Network())
        val first = run()
        assertEquals(UploadFlow.Outcome.RetryLater, first)
        assertEquals(UploadPolicy.ATTEMPTS_PER_RUN, api.uploadCalls)
        assertEquals(RecordingPhase.WAITING, store.load("rec1")!!.phase)
        assertEquals(3, store.load("rec1")!!.uploadAttempts)
        assertTrue(store.audioFile("rec1").exists()) // nothing is lost

        // Later (scheduler retry): the network is back.
        api.uploads.clear(); api.uploads.add(ApiResult.Ok("srv-1"))
        api.transcribes.add(ApiResult.Ok(TranscribeData("n")))
        val second = run("worker")
        assertTrue(second is UploadFlow.Outcome.Done)
        assertEquals(4, api.uploadCalls) // attempt numbers continue, only one more upload
        assertEquals(4, sink.of(RecordingEvents.UPLOAD_STARTED).last()["attempt"])
    }

    @Test
    fun givesUpAfterTheTotalAttemptCapAndKeepsTheAudio() {
        store.update("rec1") { it.copy(uploadAttempts = UploadPolicy.MAX_TOTAL_ATTEMPTS - 1) }
        api.uploads.add(ApiResult.Network())
        val out = run()
        assertTrue(out is UploadFlow.Outcome.Final)
        assertEquals(FailureKind.NETWORK, (out as UploadFlow.Outcome.Final).failure.kind)
        val m = store.load("rec1")!!
        assertEquals(RecordingPhase.FAILED, m.phase)
        assertTrue(store.audioFile("rec1").exists())
        assertEquals(false, sink.of(RecordingEvents.UPLOAD_FAILED).last()["will_retry"])
    }

    @Test
    fun clientErrorOnUploadIsFinalWithoutRetry() {
        api.uploads.add(ApiResult.Http(413, """{"error":"File size too large"}"""))
        val out = run() as UploadFlow.Outcome.Final
        assertEquals(FailureKind.TOO_LARGE, out.failure.kind)
        assertEquals(1, api.uploadCalls)
        assertTrue(delays.isEmpty())
        assertEquals(RecordingPhase.FAILED, store.load("rec1")!!.phase)
    }

    @Test
    fun expiredLoginWaitsForTheSchedulerInsteadOfLooping() {
        api.uploads.add(ApiResult.Http(401, null))
        assertEquals(UploadFlow.Outcome.RetryLater, run())
        assertEquals(1, api.uploadCalls)
        assertTrue(delays.isEmpty())
    }

    @Test
    fun processKilledAfterUploadDoesNotUploadAgain() {
        // Manifest says the server already has it; the process died before transcribing.
        store.update("rec1") { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = "srv-1", uploadAttempts = 1) }
        api.transcribes.add(ApiResult.Ok(TranscribeData("n")))
        val out = run("recovery")
        assertTrue(out is UploadFlow.Outcome.Done)
        assertEquals(0, api.uploadCalls)
        assertEquals(1, api.transcribeCalls)
    }

    @Test
    fun transcriptionAlreadyFinishedOnTheServerIsNotPaidForTwice() {
        store.update("rec1") { it.copy(phase = RecordingPhase.TRANSCRIBING, serverRecordingId = "srv-1") }
        api.statuses.clear(); api.statuses.add(ApiResult.Ok(RemoteStatus("completed", null, "note-7")))
        val out = run("recovery")
        assertEquals(UploadFlow.Outcome.Done("note-7"), out)
        assertEquals(0, api.transcribeCalls)
    }

    @Test
    fun droppedConnectionDuringTranscriptionFollowsTheRealStatus() {
        store.update("rec1") { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = "srv-1") }
        api.transcribes.add(ApiResult.Network("read timeout"))
        api.statuses.clear()
        api.statuses.add(ApiResult.Ok(noStatus()))                       // before asking
        api.statuses.add(ApiResult.Ok(RemoteStatus("processing", null, null)))
        api.statuses.add(ApiResult.Ok(RemoteStatus("processing", null, null)))
        api.statuses.add(ApiResult.Ok(RemoteStatus("completed", null, "note-3")))
        val out = run()
        assertEquals(UploadFlow.Outcome.Done("note-3"), out)
        assertEquals(1, api.transcribeCalls)
        assertEquals(listOf(5_000L, 5_000L, 5_000L), delays) // polled every 5 s, not a tight loop
    }

    @Test
    fun pollingStopsAfterTheBudgetAndWaitsForTheScheduler() {
        store.update("rec1") { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = "srv-1") }
        api.transcribes.add(ApiResult.Http(504, null))
        api.statuses.clear()
        api.statuses.add(ApiResult.Ok(noStatus()))
        api.statuses.add(ApiResult.Ok(RemoteStatus("processing", null, null)))
        assertEquals(UploadFlow.Outcome.RetryLater, run())
        assertEquals(RecordingPhase.WAITING, store.load("rec1")!!.phase)
        assertEquals("gave_up", sink.of(RecordingEvents.TRANSCRIPTION_OUTCOME).single()["outcome"])
        assertTrue(delays.sum() >= UploadPolicy.POLL_BUDGET_MS)
    }

    @Test
    fun silentRecordingFailureIsFinalAndExplained() {
        api.uploads.add(ApiResult.Ok("srv-1"))
        api.transcribes.add(ApiResult.Http(422, """{"error":"The recording is completely silent. Check ...","code":"NO_SPEECH"}"""))
        val out = run() as UploadFlow.Outcome.Final
        assertEquals(FailureKind.SILENT, out.failure.kind)
        val m = store.load("rec1")!!
        assertEquals(RecordingPhase.FAILED, m.phase)
        assertEquals("SILENT", m.failureKind)
        val e = sink.of(RecordingEvents.TRANSCRIPTION_OUTCOME).single()
        assertEquals("failed", e["outcome"])
        assertEquals("no_speech", e["error_code"])
        assertEquals("silent", e["failure_kind"])
        assertEquals(SendPhase.FAILED, progress.seen.last().phase)
        assertFalse(store.audioFile("rec1").exists()) // the server has the audio; no reason to keep a second copy
    }

    @Test
    fun serverFailureRecordedOnTheRowIsNotRetriedAsTranscription() {
        store.update("rec1") { it.copy(phase = RecordingPhase.TRANSCRIBING, serverRecordingId = "srv-1") }
        api.statuses.clear()
        api.statuses.add(ApiResult.Ok(RemoteStatus("failed", "NO_SPEECH: audio 1m30s, detected language en (confidence 0.8), file 1.5 MB, level audible", null)))
        val out = run("recovery") as UploadFlow.Outcome.Final
        assertEquals(FailureKind.NO_SPEECH, out.failure.kind)
        assertEquals(0, api.transcribeCalls) // would cost another provider call for the same answer
    }

    @Test
    fun serviceSideFailureOnTheRowIsRetriedByAskingAgain() {
        store.update("rec1") { it.copy(phase = RecordingPhase.TRANSCRIBING, serverRecordingId = "srv-1") }
        api.statuses.clear()
        api.statuses.add(ApiResult.Ok(RemoteStatus("failed", "PROVIDER_TIMEOUT: x", null)))
        api.transcribes.add(ApiResult.Ok(TranscribeData("n")))
        assertTrue(run("recovery") is UploadFlow.Outcome.Done)
        assertEquals(1, api.transcribeCalls)
    }

    @Test
    fun dailyLimitKeepsTheRecordingForALaterTry() {
        store.update("rec1") { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = "srv-1") }
        api.transcribes.add(ApiResult.Http(429, """{"error":"You have reached today's free limit"}"""))
        val out = run() as UploadFlow.Outcome.Final
        assertEquals(FailureKind.DAILY_LIMIT, out.failure.kind)
        assertEquals("You have reached today's free limit", out.failure.serverText)
        assertEquals(RecordingPhase.FAILED, store.load("rec1")!!.phase)
    }

    @Test
    fun serverSaysRecordingIsGoneKeepsOurOnlyCopy() {
        store.update("rec1") { it.copy(phase = RecordingPhase.UPLOADED, serverRecordingId = "srv-1") }
        api.statuses.clear(); api.statuses.add(ApiResult.Http(404, null))
        assertTrue(run() is UploadFlow.Outcome.Final)
        assertTrue(store.audioFile("rec1").exists())
    }

    @Test
    fun missingAudioBeforeUploadIsAFinalFailureNotACrash() {
        store.audioFile("rec1").delete()
        assertTrue(run() is UploadFlow.Outcome.Final)
        assertEquals(0, api.uploadCalls)
    }

    @Test
    fun aFailedRecordingIsNotRerunUntilTheUserRetries() {
        store.update("rec1") { it.copy(phase = RecordingPhase.FAILED, failureKind = "SILENT") }
        val out = run() as UploadFlow.Outcome.Final
        assertEquals(FailureKind.SILENT, out.failure.kind)
        assertEquals(0, api.uploadCalls + api.transcribeCalls)
    }

    @Test
    fun backoffScheduleIsBoundedAndIncreasing() {
        assertEquals(5_000L, UploadPolicy.backoffMs(1))
        assertEquals(15_000L, UploadPolicy.backoffMs(2))
        assertEquals(45_000L, UploadPolicy.backoffMs(3))
        assertEquals(600_000L, UploadPolicy.backoffMs(6))
        assertEquals(600_000L, UploadPolicy.backoffMs(50))
        assertEquals(5_000L, UploadPolicy.backoffMs(0))
    }

    @Test
    fun uploadFailureClasses() {
        assertEquals(UploadPolicy.UploadFailureClass.RETRY, UploadPolicy.classifyUploadFailure(null))
        assertEquals(UploadPolicy.UploadFailureClass.RETRY, UploadPolicy.classifyUploadFailure(503))
        assertEquals(UploadPolicy.UploadFailureClass.RETRY, UploadPolicy.classifyUploadFailure(429))
        assertEquals(UploadPolicy.UploadFailureClass.REFRESH_AUTH_THEN_RETRY, UploadPolicy.classifyUploadFailure(401))
        assertEquals(UploadPolicy.UploadFailureClass.FINAL, UploadPolicy.classifyUploadFailure(400))
        assertEquals(UploadPolicy.UploadFailureClass.FINAL, UploadPolicy.classifyUploadFailure(413))
        assertEquals(UploadPolicy.UploadFailureClass.FINAL, UploadPolicy.classifyUploadFailure(422))
    }
}
