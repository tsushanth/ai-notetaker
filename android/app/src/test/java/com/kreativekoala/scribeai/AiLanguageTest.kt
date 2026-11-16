package com.kreativekoala.scribeai

import com.kreativekoala.scribeai.utils.AiLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class AiLanguageTest {
    @Test fun phoneLanguageMapsToTheBackendName() {
        assertEquals("spanish", AiLanguage.forLocale(Locale("es", "MX")))
        assertEquals("indonesian", AiLanguage.forLocale(Locale("in", "ID")))
        assertEquals("tagalog", AiLanguage.forLocale(Locale("fil", "PH")))
        assertEquals("hebrew", AiLanguage.forLocale(Locale("iw", "IL")))
        assertEquals("norwegian", AiLanguage.forLocale(Locale("nb", "NO")))
    }

    @Test fun chineseSplitsIntoSimplifiedAndTraditional() {
        assertEquals("chinese", AiLanguage.forLocale(Locale.SIMPLIFIED_CHINESE))
        assertEquals("chinese_traditional", AiLanguage.forLocale(Locale.TRADITIONAL_CHINESE))
        assertEquals("chinese_traditional", AiLanguage.forLocale(Locale("zh", "HK")))
    }

    @Test fun unknownLanguageFallsBackToEnglish() {
        assertEquals("english", AiLanguage.forLocale(Locale("xx", "YY")))
    }

    @Test fun everyListedLanguageNameIsLowerCaseAscii() {
        assertTrue(AiLanguage.ALL.all { (name, tag) -> name.matches(Regex("[a-z_]+")) && tag.isNotEmpty() })
    }
}
