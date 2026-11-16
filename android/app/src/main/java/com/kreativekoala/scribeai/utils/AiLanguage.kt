package com.kreativekoala.scribeai.utils

import android.content.Context
import android.content.SharedPreferences
import java.util.Locale

/**
 * The language the AI writes summaries, chat answers, quizzes and so on in.
 *
 * The backend validates the language by its English name ("spanish"), so that name is what is stored and sent.
 * Until the person picks one in the language dialog, it follows the phone's language instead of always being English.
 */
object AiLanguage {
    const val PREF_KEY = "preferred_language"
    private const val DEFAULT = "english"

    /** Backend language name to BCP-47 tag, in the order shown in the dialog. Must stay inside the backend allow-list. */
    val ALL: List<Pair<String, String>> = listOf(
        "english" to "en", "spanish" to "es", "french" to "fr", "german" to "de", "portuguese" to "pt", "italian" to "it",
        "chinese" to "zh-Hans", "chinese_traditional" to "zh-Hant", "japanese" to "ja", "korean" to "ko",
        "hindi" to "hi", "bengali" to "bn", "tamil" to "ta", "telugu" to "te", "urdu" to "ur", "marathi" to "mr",
        "gujarati" to "gu", "punjabi" to "pa",
        "dutch" to "nl", "polish" to "pl", "russian" to "ru", "ukrainian" to "uk", "swedish" to "sv", "norwegian" to "no",
        "danish" to "da", "finnish" to "fi", "greek" to "el", "czech" to "cs", "romanian" to "ro", "hungarian" to "hu",
        "arabic" to "ar", "hebrew" to "he", "turkish" to "tr", "persian" to "fa", "swahili" to "sw",
        "thai" to "th", "vietnamese" to "vi", "indonesian" to "id", "malay" to "ms", "tagalog" to "fil"
    )

    private val nameByLanguage: Map<String, String> = mapOf(
        "en" to "english", "es" to "spanish", "fr" to "french", "de" to "german", "pt" to "portuguese", "it" to "italian",
        "ja" to "japanese", "ko" to "korean", "hi" to "hindi", "bn" to "bengali", "ta" to "tamil", "te" to "telugu",
        "ur" to "urdu", "mr" to "marathi", "gu" to "gujarati", "pa" to "punjabi", "nl" to "dutch", "pl" to "polish",
        "ru" to "russian", "uk" to "ukrainian", "sv" to "swedish", "no" to "norwegian", "nb" to "norwegian",
        "nn" to "norwegian", "da" to "danish", "fi" to "finnish", "el" to "greek", "cs" to "czech", "ro" to "romanian",
        "hu" to "hungarian", "ar" to "arabic", "he" to "hebrew", "iw" to "hebrew", "tr" to "turkish", "fa" to "persian",
        "sw" to "swahili", "th" to "thai", "vi" to "vietnamese", "id" to "indonesian", "in" to "indonesian",
        "ms" to "malay", "tl" to "tagalog", "fil" to "tagalog"
    )

    /** The backend language name that matches [locale], or "english" when the phone's language is not on the list. */
    fun forLocale(locale: Locale = Locale.getDefault()): String {
        val lang = locale.language
        if (lang == "zh") {
            val traditional = locale.script == "Hant" || locale.country in setOf("TW", "HK", "MO")
            return if (traditional) "chinese_traditional" else "chinese"
        }
        return nameByLanguage[lang] ?: DEFAULT
    }

    private const val PREF_DEFAULT_RESOLVED = "preferred_language_default"

    /**
     * The stored choice if there is one. Otherwise a default that is decided once and then kept: fresh installs follow the
     * phone's language, installs that already existed before this default was introduced keep "english" (their behaviour
     * must not change silently). A fresh install is one that has never been updated (first install time equals last update time).
     */
    fun preferred(context: Context, prefs: SharedPreferences, locale: Locale = Locale.getDefault()): String {
        prefs.getString(PREF_KEY, null)?.takeIf { name -> ALL.any { it.first == name } }?.let { return it }
        prefs.getString(PREF_DEFAULT_RESOLVED, null)?.takeIf { name -> ALL.any { it.first == name } }?.let { return it }
        val fresh = try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            info.firstInstallTime == info.lastUpdateTime
        } catch (e: Exception) {
            false
        }
        val resolved = if (fresh) forLocale(locale) else DEFAULT
        prefs.edit().putString(PREF_DEFAULT_RESOLVED, resolved).apply()
        return resolved
    }

    /** Name for the dialog in the app's language, with the language's own name when it differs: "Spanish (Español)". */
    fun displayName(tag: String, uiLocale: Locale = Locale.getDefault()): String {
        val language = Locale.forLanguageTag(tag)
        val inUi = language.getDisplayName(uiLocale).replaceFirstChar { it.titlecase(uiLocale) }
        val native = language.getDisplayName(language).replaceFirstChar { it.titlecase(language) }
        return if (native.equals(inUi, ignoreCase = true)) inUi else "$inUi ($native)"
    }
}
