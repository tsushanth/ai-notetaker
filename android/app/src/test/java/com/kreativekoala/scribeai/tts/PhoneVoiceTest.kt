package com.kreativekoala.scribeai.tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

class PhoneVoiceTest {

    @Test fun englishOnlineKeepsTheServerVoice() {
        assertNull(PhoneVoice.reason(online = true, noteLanguage = null, hasPlayer = false))
    }

    @Test fun otherLanguagesUseThePhoneOnlineOrNot() {
        assertEquals(PhoneVoiceReason.NOT_ENGLISH, PhoneVoice.reason(true, "es", false))
        assertEquals(PhoneVoiceReason.NOT_ENGLISH, PhoneVoice.reason(false, "ar", true))
    }

    @Test fun offlineUsesThePhoneUnlessServerAudioIsAlreadyLoaded() {
        assertEquals(PhoneVoiceReason.OFFLINE, PhoneVoice.reason(false, null, false))
        assertNull(PhoneVoice.reason(false, null, true))
    }

    @Test fun theStopButtonStaysWhenTheConnectionReturnsMidReading() {
        assertEquals(PhoneVoiceReason.OFFLINE, PhoneVoice.reason(true, null, false, speaking = true))
    }

    @Test fun theVoiceFollowsTheNoteNotThePhone() {
        assertEquals("pl", PhoneVoice.localeFor("pl", Locale.US).language)
        assertEquals("fil", PhoneVoice.localeFor("tl", Locale.US).language)
        assertEquals(Locale.UK, PhoneVoice.localeFor(null, Locale.UK))
        assertEquals(Locale.US, PhoneVoice.localeFor(null, Locale.FRANCE))
    }

    @Test fun markdownIsNotReadOut() {
        val spoken = PhoneVoice.plainText("## Title\n\n- **Bold** point with [a link](https://example.org)\n> quoted `code`\n---\n| a | b |")
        for (mark in listOf("#", "*", "`", "|", "https", "[", "---", ">")) {
            assertEquals(mark, false, spoken.contains(mark))
        }
        for (word in listOf("Title", "Bold", "point", "a link", "quoted", "code")) {
            assertEquals(word, true, spoken.contains(word))
        }
    }
}
