package com.kreativekoala.scribeai.tts

/**
 * Which language a note is written in, as far as Read Aloud needs to know: the server's voices speak English only,
 * so anything else is read by the phone. Decided on the device from the text itself (no network, no extra library).
 */
object NoteLanguage {
    private const val SAMPLE_CHARS = 4000
    private const val MIN_WORDS = 12
    /** Share of letters in another script before the note counts as written in it. */
    private const val SCRIPT_SHARE = 0.3
    /** Share of words that must be common words of a language to decide on it. */
    private const val WORD_SHARE = 0.10

    private val WORD = Regex("\\p{L}+")

    private val COMMON: Map<String, Set<String>> = mapOf(
        "en" to "the and of to is that it for you with this are was be have from they we but not what can will your",
        "es" to "el los las que de y en una por para con es como pero más este está del se lo la",
        "fr" to "le les des est que et une pour dans qui pas vous nous avec ce cette sur du au la de",
        "de" to "der die das und ist nicht ein eine mit auf für sich den dem auch ich wir zu von sind",
        "it" to "il che di e è per non una sono con come questo della nel gli anche più la le",
        "pt" to "o os que de não uma para com é como mas você isso está do da em um são",
        "nl" to "de het een en van dat niet op zijn voor met ook maar wordt ik je naar deze",
        "pl" to "nie się że jest na w z do to jak ale tym który oraz czy dla są tak po",
        "tr" to "bir ve bu için ile çok daha değil olarak ama gibi olan ne var kadar sonra",
        "id" to "yang dan di ini itu dengan untuk tidak dari akan ada kita bisa pada juga kami",
        "ms" to "yang dan di ini itu dengan untuk tidak dari akan boleh kerana kepada ialah iaitu awak",
        "vi" to "và là của có không được cho một những các người này trong với để đã",
        "tl" to "ang ng sa na mga ay hindi ito para kung siya ako naman yung po lang",
        "sv" to "och att det som är på för med inte den jag av till har om ett",
        "da" to "og at det der er på for med ikke den jeg af til har som et",
        "nb" to "og å det som er på for med ikke jeg av til har om et",
        "cs" to "že se je na jsem ale jako není který pro tak také jsou nebo když ve",
        "ro" to "și să că este nu pentru mai din care cu sunt dar acest sau în la",
        "hu" to "és hogy nem egy az meg is van ez de vagy mint csak már volt",
        "fi" to "ja on ei että se mutta kun ovat tai myös joka jos niin tämä ole",
        "sw" to "na ya wa kwa ni za katika hii kuwa hiyo lakini sana",
    ).mapValues { (_, words) -> words.split(' ').toSet() }

    /**
     * Language code of a note that is not in English, or null when it is English or cannot be told.
     * [transcriptLanguage] (from the note's metadata) is used only when the text itself does not decide.
     */
    fun nonEnglish(text: String, transcriptLanguage: String? = null): String? {
        val sample = text.take(SAMPLE_CHARS)
        byScript(sample)?.let { return it }
        byWords(sample)?.let { return it.takeIf { code -> code != "en" } }
        return transcriptLanguage?.lowercase()?.substringBefore('-')?.substringBefore('_')
            ?.takeIf { it.matches(Regex("[a-z]{2,3}")) && it != "en" && it != "eng" }
    }

    private fun byWords(sample: String): String? {
        val words = WORD.findAll(sample.lowercase()).map { it.value }.toList()
        if (words.size < MIN_WORDS) return null
        val shares = COMMON.mapValues { (_, common) -> words.count { it in common }.toDouble() / words.size }
        val english = shares.getValue("en")
        val other = shares.filterKeys { it != "en" }.maxByOrNull { it.value } ?: return null
        return when {
            other.value >= WORD_SHARE && other.value > english * 1.5 -> other.key
            english >= WORD_SHARE -> "en"
            else -> null
        }
    }

    private fun byScript(sample: String): String? {
        val counts = HashMap<Character.UnicodeScript, Int>()
        var letters = 0
        var i = 0
        while (i < sample.length) {
            val c = sample.codePointAt(i)
            i += Character.charCount(c)
            if (!Character.isLetter(c)) continue
            letters++
            counts.merge(Character.UnicodeScript.of(c), 1, Int::plus)
        }
        if (letters == 0) return null
        fun count(s: Character.UnicodeScript) = counts[s] ?: 0

        val kana = count(Character.UnicodeScript.HIRAGANA) + count(Character.UnicodeScript.KATAKANA)
        val cjk = kana + count(Character.UnicodeScript.HAN)
        if (cjk >= letters * SCRIPT_SHARE) return if (kana >= cjk * 0.1) "ja" else "zh"

        val top = counts.filterKeys { it != Character.UnicodeScript.LATIN && it != Character.UnicodeScript.COMMON }
            .maxByOrNull { it.value } ?: return null
        if (top.value < letters * SCRIPT_SHARE) return null
        fun has(chars: String) = sample.any { it in chars }
        return when (top.key) {
            Character.UnicodeScript.CYRILLIC -> if (has("іїєґІЇЄҐ")) "uk" else "ru"
            Character.UnicodeScript.ARABIC -> when {
                has("ٹڈڑے") -> "ur"
                has("پچژگ") -> "fa"
                else -> "ar"
            }
            Character.UnicodeScript.DEVANAGARI -> if (has("ळ")) "mr" else "hi"
            Character.UnicodeScript.BENGALI -> "bn"
            Character.UnicodeScript.GREEK -> "el"
            Character.UnicodeScript.HEBREW -> "he"
            Character.UnicodeScript.THAI -> "th"
            Character.UnicodeScript.HANGUL -> "ko"
            Character.UnicodeScript.TAMIL -> "ta"
            Character.UnicodeScript.TELUGU -> "te"
            Character.UnicodeScript.GUJARATI -> "gu"
            Character.UnicodeScript.GURMUKHI -> "pa"
            Character.UnicodeScript.KANNADA -> "kn"
            Character.UnicodeScript.MALAYALAM -> "ml"
            Character.UnicodeScript.SINHALA -> "si"
            Character.UnicodeScript.KHMER -> "km"
            Character.UnicodeScript.LAO -> "lo"
            Character.UnicodeScript.MYANMAR -> "my"
            Character.UnicodeScript.GEORGIAN -> "ka"
            Character.UnicodeScript.ARMENIAN -> "hy"
            Character.UnicodeScript.ETHIOPIC -> "am"
            else -> null
        }
    }
}
