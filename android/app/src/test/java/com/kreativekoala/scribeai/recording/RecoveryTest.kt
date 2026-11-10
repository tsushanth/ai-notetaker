package com.kreativekoala.scribeai.recording

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RecoveryTest {
    @get:Rule val tmp = TemporaryFolder()

    private val now = 10_000_000_000L

    private fun store() = PendingRecordingStore(File(tmp.root, "recordings"))

    private fun p(id: String, phase: RecordingPhase, serverId: String? = null, createdAt: Long = now - 1000) =
        PendingRecording(id = id, phase = phase, createdAtMs = createdAt, serverRecordingId = serverId)

    @Test
    fun manifestSurvivesARoundTrip() {
        val s = store()
        val rec = PendingRecording(
            id = "abc", phase = RecordingPhase.RECORDED, createdAtMs = 42, title = "Lecture 1", durationMs = 61_000, bytes = 480_000,
            peakAmplitude = 8000, silentPercent = 3, allSilent = false, stopReason = "user", stopDetail = "stop_button",
            serverRecordingId = "srv-1", uploadAttempts = 2, failureKind = "SERVICE", appVersionCode = 87
        )
        s.save(rec)
        assertEquals(rec, s.load("abc"))
    }

    @Test
    fun unknownOrMissingFieldsAndDamagedFilesAreTolerated() {
        assertEquals("x", PendingRecording.fromJson("""{"id":"x","extra":{"a":1}}""")?.id)
        assertEquals(RecordingPhase.RECORDED, PendingRecording.fromJson("""{"id":"x","phase":"FUTURE_PHASE"}""")?.phase)
        assertNull(PendingRecording.fromJson("not json"))
        assertNull(PendingRecording.fromJson("""{"phase":"RECORDED"}"""))
        val s = store()
        s.save(p("good", RecordingPhase.RECORDED))
        File(tmp.root, "recordings/bad.json").writeText("{{{")
        assertEquals(listOf("good"), s.list().map { it.id })
    }

    @Test
    fun listIsNewestFirstAndDeleteRemovesBothFiles() {
        val s = store()
        s.save(p("old", RecordingPhase.RECORDED, createdAt = 1))
        s.save(p("new", RecordingPhase.RECORDED, createdAt = 2))
        s.audioFile("new").writeBytes(byteArrayOf(1, 2, 3))
        assertEquals(listOf("new", "old"), s.list().map { it.id })
        s.delete("new")
        assertNull(s.load("new"))
        assertTrue(!s.audioFile("new").exists())
    }

    @Test
    fun audioWithoutManifestIsFoundAsOrphan() {
        val s = store()
        s.audioFile("orphan").writeBytes(byteArrayOf(1))
        s.save(p("fine", RecordingPhase.RECORDED))
        s.audioFile("fine").writeBytes(byteArrayOf(1))
        assertEquals(listOf("orphan"), s.orphanAudioIds())
    }

    @Test
    fun killedMidRecordingWithAudioIsFinalizedNotLost() {
        val plan = RecoveryPlanner.plan(listOf(p("r1", RecordingPhase.RECORDING)), { 480_000L }, activeRecordingId = null, nowMs = now)
        assertEquals(RecoveryAction.Finalize("r1"), plan.single())
    }

    @Test
    fun killedMidRecordingWithNoAudioIsDiscarded() {
        val plan = RecoveryPlanner.plan(listOf(p("r1", RecordingPhase.RECORDING)), { 0L }, null, now)
        assertEquals(RecoveryAction.Discard("r1", "no_audio"), plan.single())
    }

    @Test
    fun aRecordingTheRunningServiceOwnsIsLeftAlone() {
        val plan = RecoveryPlanner.plan(listOf(p("live", RecordingPhase.RECORDING)), { 1000L }, activeRecordingId = "live", nowMs = now)
        assertEquals(RecoveryAction.Keep("live"), plan.single())
    }

    @Test
    fun interruptedUploadWithAudioIsResumed() {
        val plan = RecoveryPlanner.plan(listOf(p("u", RecordingPhase.UPLOADING)), { 5000L }, null, now)
        assertEquals(RecoveryAction.Resume("u"), plan.single())
    }

    @Test
    fun uploadedButNotTranscribedResumesEvenIfTheLocalAudioIsGone() {
        val plan = RecoveryPlanner.plan(listOf(p("t", RecordingPhase.TRANSCRIBING, serverId = "srv")), { 0L }, null, now)
        assertEquals(RecoveryAction.Resume("t"), plan.single())
    }

    @Test
    fun notYetUploadedAndAudioMissingCannotBeRecovered() {
        val plan = RecoveryPlanner.plan(listOf(p("m", RecordingPhase.UPLOADING)), { 0L }, null, now)
        assertEquals(RecoveryAction.Discard("m", "audio_missing"), plan.single())
    }

    @Test
    fun finishedUnsentRecordingWaitsForTheUser() {
        val plan = RecoveryPlanner.plan(listOf(p("w", RecordingPhase.RECORDED)), { 5000L }, null, now)
        assertEquals(RecoveryAction.Keep("w"), plan.single())
    }

    @Test
    fun failedRecordingsAreKeptAWeekThenDropped() {
        val fresh = p("f1", RecordingPhase.FAILED, createdAt = now - 1000)
        val stale = p("f2", RecordingPhase.FAILED, createdAt = now - RecordingConfig.STALE_FAILED_MS - 1)
        val plan = RecoveryPlanner.plan(listOf(fresh, stale), { 0L }, null, now)
        assertEquals(RecoveryAction.Keep("f1"), plan[0])
        assertEquals(RecoveryAction.Discard("f2", "stale_failed"), plan[1])
    }

    @Test
    fun doneRecordingsLeftOnDiskAreCleanedUp() {
        val plan = RecoveryPlanner.plan(listOf(p("d", RecordingPhase.DONE)), { 5000L }, null, now)
        assertEquals(RecoveryAction.Discard("d", "already_done"), plan.single())
    }

    @Test
    fun crashSimulationEndToEnd() {
        // 10 s of audio written, then the process dies in the middle of a frame.
        val s = store()
        s.save(p("crash", RecordingPhase.RECORDING))
        val frame = AdtsFrames.frame()
        s.audioFile("crash").writeBytes(ByteArray(0).let { _ -> (1..160).fold(ByteArray(0)) { a, _ -> a + frame } + frame.copyOf(30) })

        val action = RecoveryPlanner.plan(s.list(), { s.audioFile(it).length() }, null, now).single()
        assertEquals(RecoveryAction.Finalize("crash"), action)

        val info = AdtsInspector.repair(s.audioFile("crash"))
        assertEquals(160, info.frames)
        assertEquals(10_240, info.durationMs)
        s.update("crash") { it.copy(phase = RecordingPhase.RECORDED, durationMs = info.durationMs, bytes = info.validBytes) }
        assertNotNull(s.load("crash"))
        // After finalizing, the next launch only keeps it for the user.
        assertEquals(RecoveryAction.Keep("crash"), RecoveryPlanner.plan(s.list(), { s.audioFile(it).length() }, null, now).single())
    }
}

/** Shared synthetic ADTS frame for the tests. */
object AdtsFrames {
    fun frame(payload: Int = 100): ByteArray {
        val len = 7 + payload
        val h = ByteArray(7)
        h[0] = 0xFF.toByte(); h[1] = 0xF1.toByte()
        h[2] = ((1 shl 6) or (8 shl 2)).toByte()
        h[3] = ((1 shl 6) or ((len shr 11) and 0x03)).toByte()
        h[4] = ((len shr 3) and 0xFF).toByte()
        h[5] = (((len and 0x07) shl 5) or 0x1F).toByte()
        h[6] = 0xFC.toByte()
        return h + ByteArray(payload) { 0x11 }
    }
}
