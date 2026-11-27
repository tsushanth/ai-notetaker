package com.kreativekoala.scribeai.utils

import com.kreativekoala.scribeai.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class VideoErrorsTest {

    private fun body(error: String, code: String? = null) =
        """{"success":false,"error":"$error"${code?.let { ""","code":"$it"""" } ?: ""}}"""

    @Test fun theDailyLimitShowsTheServersOwnWords() {
        val f = VideoErrors.fromResponse(429, body("You have reached today's limit of 10 uploads.", "DAILY_LIMIT_REACHED"))
        assertEquals("You have reached today's limit of 10 uploads.", f.serverMessage)
        assertEquals("DAILY_LIMIT_REACHED", f.code)
    }

    @Test fun aVideoWithoutATranscriptIsNotCalledPrivate() {
        val text = "This video has no captions, so there is no transcript to make a note from. Try a video with captions."
        val f = VideoErrors.fromResponse(404, body(text, "NO_CAPTIONS_UNAVAILABLE"))
        assertEquals(text, f.serverMessage)
        assertFalse(f.isPending)
    }

    @Test fun stillWritingIsNotAFailure() {
        val f = VideoErrors.fromResponse(409, body("ScribeAI is still writing the transcript.", "TRANSCRIPT_PENDING"))
        assertTrue(f.isPending)
        assertEquals("ScribeAI is still writing the transcript.", f.serverMessage)
    }

    @Test fun aRejectedLinkGetsAPlainLinkMessage() {
        for (text in listOf("Validation error", "Invalid YouTube URL", "Could not extract video ID from URL")) {
            val f = VideoErrors.fromResponse(400, body(text))
            assertNull(f.serverMessage)
            assertEquals(R.string.error_youtube_link, f.textRes)
            assertEquals("bad_link", f.code)
        }
    }

    @Test fun anExpiredSessionSaysSo() {
        val f = VideoErrors.fromResponse(401, body("Invalid token"))
        assertEquals(R.string.error_session_expired, f.textRes)
        assertNull(f.serverMessage)
    }

    @Test fun anAnswerWithoutAReadableMessageKeepsTheStatus() {
        val f = VideoErrors.fromResponse(502, "<html>Bad gateway</html>")
        assertEquals(R.string.error_video_process_code, f.textRes)
        assertEquals(502, f.textArg)
        assertEquals("http_502", f.code)
        assertEquals("id ${R.string.error_video_process_code} 502", f.message { id, args -> "id $id ${args.single()}" })
    }

    @Test fun aLimitMessageThatSellsAnUpgradeIsReplaced() {
        val f = VideoErrors.fromResponse(429, body("Upgrade to Pro for more videos.", "DAILY_LIMIT_REACHED"))
        assertEquals(R.string.error_daily_limit, f.textRes)
        assertNull(f.serverMessage)
    }

    @Test fun noAnswerIsToldApart() {
        assertEquals("timeout", VideoErrors.fromException(SocketTimeoutException("timeout")).code)
        assertEquals("no_connection", VideoErrors.fromException(UnknownHostException("x")).code)
        assertEquals(R.string.error_network_generic, VideoErrors.fromException(java.io.IOException("reset")).textRes)
        assertEquals(R.string.error_video_process, VideoErrors.fromException(IllegalStateException()).textRes)
    }
}
