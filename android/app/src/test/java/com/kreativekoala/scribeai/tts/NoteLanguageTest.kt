package com.kreativekoala.scribeai.tts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NoteLanguageTest {

    private val samples = mapOf(
        "es" to "Hoy vamos a hablar de la economía y de cómo los precios suben cada año. Es importante para todos, pero no siempre se entiende bien lo que está pasando en el mercado.",
        "fr" to "Aujourd'hui nous allons parler de la cuisine et des recettes que vous pouvez faire à la maison avec des produits simples. C'est une bonne idée pour la semaine.",
        "de" to "Heute sprechen wir über das Wetter und die Frage, warum es im Sommer so oft regnet. Das ist nicht leicht zu erklären, aber wir versuchen es mit einem Beispiel.",
        "pt" to "Hoje vamos falar sobre como você pode estudar melhor em casa. Isso não é difícil, mas é preciso ter uma rotina e um lugar tranquilo para os livros.",
        "it" to "Oggi parliamo della storia di Roma e di come la città è cambiata nel corso dei secoli. Non è una storia breve, ma questo video la racconta in modo semplice.",
        "pl" to "Dzisiaj porozmawiamy o tym, jak działa pamięć i dlaczego tak łatwo zapominamy to, czego się uczymy. Nie jest to trudne, ale warto wiedzieć, jak sobie z tym radzić.",
        "tr" to "Bugün sizlere bu konuyu anlatacağız ve daha iyi bir şekilde öğrenmek için neler yapılabilir ona bakacağız. Bu çok önemli bir konu ama zor değil.",
        "id" to "Pada video ini kita akan belajar tentang cara membuat kue yang enak dan mudah untuk keluarga. Bahan yang dibutuhkan tidak banyak dan bisa dibeli di pasar.",
        "vi" to "Hôm nay chúng ta sẽ nói về cách học tiếng Anh hiệu quả cho người mới bắt đầu và những điều cần nhớ trong quá trình học để không bị nản.",
        "ru" to "Сегодня мы поговорим о том, как устроена память и почему мы так быстро забываем новое.",
        "uk" to "Сьогодні ми поговоримо про те, як працює пам'ять і чому ми так швидко забуваємо її уроки.",
        "ar" to "سنتحدث اليوم عن كيفية عمل الذاكرة ولماذا ننسى بسرعة.",
        "hi" to "आज हम बात करेंगे कि याददाश्त कैसे काम करती है और हम जल्दी क्यों भूल जाते हैं।",
        "bn" to "আজ আমরা আলোচনা করব স্মৃতি কীভাবে কাজ করে।",
        "zh" to "今天我们来谈谈记忆是如何工作的，以及为什么我们很快就会忘记。",
        "ja" to "今日は記憶の仕組みと、なぜすぐに忘れてしまうのかについてお話しします。",
        "ko" to "오늘은 기억이 어떻게 작동하는지 이야기해 보겠습니다.",
        "el" to "Σήμερα θα μιλήσουμε για το πώς λειτουργεί η μνήμη.",
        "th" to "วันนี้เราจะพูดถึงการทำงานของความจำ",
    )

    @Test fun otherLanguagesAreRecognisedFromTheText() {
        for ((expected, text) in samples) assertEquals(text, expected, NoteLanguage.nonEnglish(text))
    }

    @Test fun englishStaysWithTheServerVoice() {
        val english = listOf(
            "Today we are going to talk about how memory works and why it is so easy to forget what you have just learned.",
            "## Summary\n- The meeting was about the new budget and the plan for next year.\n- Maria will send the notes to the team.",
            "The Spanish phrase \"que sera sera\" means that what will be, will be. We use it to talk about things you can not change.",
            "In physics the angle θ and the wavelength λ are used for this and the result is shown on the screen for you to see.",
        )
        for (text in english) assertNull(text, NoteLanguage.nonEnglish(text))
    }

    @Test fun englishTextWinsOverAWrongTranscriptLanguage() {
        assertNull(NoteLanguage.nonEnglish(
            "This is a note that was written in English even though the video it came from was not, and that is fine.", "es"))
    }

    @Test fun theTranscriptLanguageDecidesOnlyWhenTheTextCannot() {
        assertEquals("es", NoteLanguage.nonEnglish("Hola amigos", "es-419"))
        assertNull(NoteLanguage.nonEnglish("Hello friends", "auto"))
        assertNull(NoteLanguage.nonEnglish("Hello friends", "en-US"))
        assertNull(NoteLanguage.nonEnglish("", null))
    }
}
