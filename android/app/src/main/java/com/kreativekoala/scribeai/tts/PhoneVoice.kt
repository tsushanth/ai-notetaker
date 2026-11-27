package com.kreativekoala.scribeai.tts

import java.util.Locale

/** Why Read Aloud uses the phone's own voice instead of the server's. */
enum class PhoneVoiceReason(val analyticsName: String) {
    NOT_ENGLISH("non_english"),
    OFFLINE("offline"),
}

enum class PhoneVoiceStart { STARTED, NO_VOICE, NO_ENGINE }

object PhoneVoice {
    /**
     * [noteLanguage] is the code of a non-English note, else null. Server audio that is already loaded in the player
     * ([hasPlayer]) is left alone when the connection drops. While the phone is reading ([speaking]) its controls
     * stay, even if the connection comes back.
     */
    fun reason(online: Boolean, noteLanguage: String?, hasPlayer: Boolean, speaking: Boolean = false): PhoneVoiceReason? =
        when {
            noteLanguage != null -> PhoneVoiceReason.NOT_ENGLISH
            !hasPlayer && (!online || speaking) -> PhoneVoiceReason.OFFLINE
            else -> null
        }

    fun localeFor(noteLanguage: String?, device: Locale = Locale.getDefault()): Locale = when (noteLanguage) {
        null -> if (device.language == "en") device else Locale.US
        "tl" -> Locale.forLanguageTag("fil")
        else -> Locale.forLanguageTag(noteLanguage)
    }

    /** Markdown marks removed, so the voice does not read them out. */
    fun plainText(markdown: String): String = markdown
        .replace(Regex("!?\\[([^\\]]*)]\\([^)]*\\)"), "$1")
        .replace(Regex("(?m)^[ \\t]*[-=:| \\t]{3,}$"), "")
        .replace(Regex("(?m)^[ \\t]*(?:>|[-*+] )[ \\t]*"), "")
        .replace(Regex("[*_`#|]+"), " ")
        .replace(Regex("[ \\t]{2,}"), " ")
        .trim()
}
