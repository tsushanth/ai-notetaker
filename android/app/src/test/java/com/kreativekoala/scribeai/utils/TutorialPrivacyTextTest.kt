package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The tutorial note must not say things the privacy policy (https://scribeai.online/privacy) contradicts:
 * audio goes to Deepgram and text to Anthropic, so "never shared" and "encrypted notes" are false.
 */
class TutorialPrivacyTextTest {

    private val allText = listOf(
        TutorialContent.TUTORIAL_CONTENT,
        TutorialContent.TUTORIAL_SUMMARY_SHORT,
        TutorialContent.TUTORIAL_SUMMARY_MEDIUM,
        TutorialContent.TUTORIAL_SUMMARY_LONG,
        TutorialContent.TUTORIAL_PODCAST_SCRIPT,
    ).joinToString("\n").lowercase()

    @Test
    fun noFalseSharingOrEncryptionClaims() {
        listOf(
            "never share",
            "never shared",
            "private and encrypted",
            "private, encrypted",
            "completely private",
            "processing happens securely",
            "end-to-end",
        ).forEach { assertFalse("tutorial still says \"$it\"", allText.contains(it)) }
    }

    @Test
    fun namesTheProcessorsAndPointsToThePolicy() {
        assertTrue(TutorialContent.TUTORIAL_CONTENT.contains("Deepgram"))
        assertTrue(TutorialContent.TUTORIAL_CONTENT.contains("Anthropic"))
        assertTrue(TutorialContent.TUTORIAL_CONTENT.contains("scribeai.online/privacy"))
        assertTrue(TutorialContent.TUTORIAL_SUMMARY_LONG.contains("Deepgram"))
    }

    @Test
    fun legalLinksPointAtThePublicPages() {
        assertEquals("https://scribeai.online/privacy", LegalLinks.PRIVACY_URL)
        assertEquals("https://scribeai.online/terms", LegalLinks.TERMS_URL)
    }
}
