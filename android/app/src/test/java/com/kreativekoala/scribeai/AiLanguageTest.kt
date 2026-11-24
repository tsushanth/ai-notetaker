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
        assertEquals("chinese_traditional", AiLanguage.forLocale(Locale("zh", "TW")))
        assertEquals("chinese_traditional_hk", AiLanguage.forLocale(Locale("zh", "HK")))
        assertEquals("chinese_traditional_hk", AiLanguage.forLocale(Locale("zh", "MO")))
        assertEquals("chinese_traditional", AiLanguage.forLocale(Locale.forLanguageTag("zh-Hant")))
        assertEquals("chinese_traditional_hk", AiLanguage.forLocale(Locale.forLanguageTag("zh-Hant-HK")))
        assertEquals("chinese", AiLanguage.forLocale(Locale.forLanguageTag("zh-Hans-HK")))
        assertEquals("chinese", AiLanguage.forLocale(Locale.forLanguageTag("zh-SG")))
        assertEquals("chinese", AiLanguage.forLocale(Locale("zh")))
    }

    @Test fun chinesePickerEntriesUseTheirOwnNames() {
        val names = AiLanguage.ALL.associate { (name, tag) -> name to AiLanguage.displayName(tag, Locale.US) }
        assertEquals("简体中文", names["chinese"])
        assertEquals("繁體中文（台灣）", names["chinese_traditional"])
        assertEquals("繁體中文（香港）", names["chinese_traditional_hk"])
    }

    @Test fun unknownLanguageFallsBackToEnglish() {
        assertEquals("english", AiLanguage.forLocale(Locale("xx", "YY")))
    }

    @Test fun everyListedLanguageNameIsLowerCaseAscii() {
        assertTrue(AiLanguage.ALL.all { (name, tag) -> name.matches(Regex("[a-z_]+")) && tag.isNotEmpty() })
    }
}
