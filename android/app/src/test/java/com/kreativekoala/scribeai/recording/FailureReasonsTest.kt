package com.kreativekoala.scribeai.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FailureReasonsTest {
    private val silentBody = """{"success":false,"error":"The recording is completely silent. Check that the microphone is allowed for this app, not muted and not in use by another app, then try again.","code":"NO_SPEECH"}"""

    @Test
    fun silentRecordingIsExplainedAsSilent() {
        val f = FailureReasons.fromHttp(422, silentBody)
        assertEquals(FailureKind.SILENT, f.kind)
        assertEquals("NO_SPEECH", f.code)
    }

    @Test
    fun noSpeechWithSoundInEnglishIsPlainNoSpeech() {
        val f = FailureReasons.fromHttp(422, """{"error":"No speech detected in the recording","code":"NO_SPEECH"}""")
        assertEquals(FailureKind.NO_SPEECH, f.kind)
    }

    @Test
    fun storedSilentRow() {
        val row = "NO_SPEECH: audio 12s, detected language en (confidence 0.99), file 1.1 MB, level silent (all samples zero) (peak -91 dB, mean -91 dB)"
        assertEquals(FailureKind.SILENT, FailureReasons.fromStoredError(row).kind)
    }

    @Test
    fun storedAudibleButNotEnglishIsLanguage() {
        val row = "NO_SPEECH: audio 2m05s, detected language ar (confidence 0.42), file 2.0 MB, level audible (peak -9 dB, mean -30 dB)"
        assertEquals(FailureKind.LANGUAGE, FailureReasons.fromStoredError(row).kind)
    }

    @Test
    fun storedVeryShortRecordingIsTooShort() {
        val row = "NO_SPEECH: audio 1.2s, detected language unknown, file 12 KB, level audible (peak -12 dB, mean -40 dB)"
        assertEquals(FailureKind.TOO_SHORT, FailureReasons.fromStoredError(row).kind)
    }

    @Test
    fun storedAudibleEnglishIsNoSpeech() {
        val row = "NO_SPEECH: audio 1m30s, detected language en (confidence 0.8), file 1.5 MB, level audible (peak -20 dB, mean -50 dB)"
        assertEquals(FailureKind.NO_SPEECH, FailureReasons.fromStoredError(row).kind)
    }

    @Test
    fun providerAndInternalFailuresAreRetryableServiceErrors() {
        listOf("PROVIDER_ERROR: status 503", "PROVIDER_TIMEOUT: x", "DOWNLOAD_FAILED: x", "INTERNAL_ERROR: boom").forEach {
            val f = FailureReasons.fromStoredError(it)
            assertEquals(it, FailureKind.SERVICE, f.kind)
            assertTrue(f.kind.retryable)
        }
    }

    @Test
    fun httpStatusMapping() {
        assertEquals(FailureKind.NETWORK, FailureReasons.fromHttp(null, null).kind)
        assertEquals(FailureKind.DAILY_LIMIT, FailureReasons.fromHttp(429, """{"error":"Daily limit reached"}""").kind)
        assertEquals("Daily limit reached", FailureReasons.fromHttp(429, """{"error":"Daily limit reached"}""").serverText)
        assertEquals(FailureKind.AUTH, FailureReasons.fromHttp(401, null).kind)
        assertEquals(FailureKind.TOO_LARGE, FailureReasons.fromHttp(413, null).kind)
        assertEquals(FailureKind.SERVICE, FailureReasons.fromHttp(502, "<html>bad gateway</html>").kind)
    }

    @Test
    fun serverErrorTextIsNeverPassedThroughForServerFaults() {
        assertNull(FailureReasons.fromHttp(500, """{"error":"stack trace at line 5"}""").serverText)
    }

    @Test
    fun unknownClientErrorKeepsShortServerSentence() {
        val f = FailureReasons.fromHttp(400, """{"error":"Recording ID is required"}""")
        assertEquals(FailureKind.UNKNOWN, f.kind)
        assertEquals("Recording ID is required", f.serverText)
        assertNull(FailureReasons.fromHttp(400, """{"error":"${"x".repeat(400)}"}""").serverText)
    }

    @Test
    fun emptyOrGarbageIsUnknownNotACrash() {
        assertEquals(FailureKind.UNKNOWN, FailureReasons.fromStoredError(null).kind)
        assertEquals(FailureKind.UNKNOWN, FailureReasons.fromStoredError("   ").kind)
        assertEquals(FailureKind.UNKNOWN, FailureReasons.fromHttp(418, "not json").kind)
    }

    @Test
    fun onlyServiceNetworkAndAuthFailuresAreRetryable() {
        val retryable = FailureKind.entries.filter { it.retryable }.toSet()
        assertEquals(setOf(FailureKind.SERVICE, FailureKind.NETWORK, FailureKind.AUTH), retryable)
        assertFalse(FailureKind.SILENT.retryable)
    }
}
