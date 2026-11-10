package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingErrorsTest {

    private val silent = "The recording is completely silent. Check that the microphone is allowed for this app, not muted and not in use by another app, then try again."

    @Test
    fun showsTheServerTextForNoSpeech() {
        val body = """{"success":false,"error":"$silent","code":"NO_SPEECH"}"""
        assertEquals(silent, RecordingErrors.serverMessage(422, body))
    }

    @Test
    fun showsTheServerTextForTooLargeAndBadRequests() {
        assertEquals("File size too large", RecordingErrors.serverMessage(400, """{"error":"File size too large"}"""))
        assertEquals("Too big", RecordingErrors.serverMessage(413, """{"message":"Too big"}"""))
    }

    @Test
    fun keepsTheGenericMessageForServerErrorsAndOtherCodes() {
        listOf(500, 502, 503, 401, 403, 404, 429).forEach {
            assertNull("code $it", RecordingErrors.serverMessage(it, """{"error":"internal stack detail"}"""))
        }
    }

    @Test
    fun keepsTheGenericMessageForMissingOrUnusableBodies() {
        listOf(null, "", "not json", "[]", "{}", """{"error":""}""", """{"error":{"a":1}}""", """{"error":"${"x".repeat(301)}"}""").forEach {
            assertNull(it, RecordingErrors.serverMessage(422, it))
        }
    }

    @Test
    fun retriesTheSameAudioOnlyWhenTheFailureWasNotAboutTheAudio() {
        assertTrue(RecordingErrors.canRetrySameAudio(null))
        assertTrue(RecordingErrors.canRetrySameAudio(500))
        assertTrue(RecordingErrors.canRetrySameAudio(503))
        assertTrue(RecordingErrors.canRetrySameAudio(429))
        assertFalse(RecordingErrors.canRetrySameAudio(422))
        assertFalse(RecordingErrors.canRetrySameAudio(400))
        assertFalse(RecordingErrors.canRetrySameAudio(413))
    }
}
