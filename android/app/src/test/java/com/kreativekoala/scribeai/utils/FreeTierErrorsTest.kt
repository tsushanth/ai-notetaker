package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FreeTierErrorsTest {

    private companion object {
        val FALLBACK: () -> String = { "fallback text" }
    }

    @Test
    fun usesServerMessageFromErrorField() {
        val body = """{"success":false,"error":"You have reached today's limit of 60 AI generations. It resets on a rolling 24-hour basis, so please try again later.","code":"DAILY_LIMIT_REACHED","details":{"upgradeRequired":false}}"""
        assertEquals(
            "You have reached today's limit of 60 AI generations. It resets on a rolling 24-hour basis, so please try again later.",
            FreeTierErrors.dailyLimitMessage(body, FALLBACK)
        )
    }

    @Test
    fun usesMessageFieldWhenNoErrorField() {
        assertEquals("Slow down", FreeTierErrors.dailyLimitMessage("""{"message":"Slow down"}""", FALLBACK))
    }

    @Test
    fun fallsBackToPlainDefaultForMissingOrBadBodies() {
        listOf(null, "", "not json", "[]", "{}", """{"error":""}""", """{"error":{"a":1}}""").forEach {
            assertEquals(FALLBACK(), FreeTierErrors.dailyLimitMessage(it, FALLBACK))
        }
    }

    @Test
    fun ignoresAbsurdlyLongServerMessages() {
        val body = """{"error":"${"x".repeat(400)}"}"""
        assertEquals(FALLBACK(), FreeTierErrors.dailyLimitMessage(body, FALLBACK))
    }

    @Test
    fun defaultMessageIsPlainAsciiAndNeverSaysUpgrade() {
        // The default text lives in string resources; read the English source straight from the XML.
        val xml = java.io.File("src/main/res/values/strings_sweep.xml").readText()
        val m = Regex("""<string name="error_daily_limit">(.*?)</string>""").find(xml)!!.groupValues[1].replace("\\'", "'")
        assertFalse(m.contains("upgrade", ignoreCase = true))
        assertTrue(m.all { it.code < 128 })
        assertEquals("You've reached today's daily limit. Please come back tomorrow.", m)
    }

    @Test
    fun ignoresServerTextThatPushesAnUpgrade() {
        listOf(
            """{"error":"Daily limit reached. Upgrade to Pro for more."}""",
            """{"message":"Subscribe to continue"}""",
            """{"error":"This needs a premium plan"}"""
        ).forEach {
            assertEquals(FALLBACK(), FreeTierErrors.dailyLimitMessage(it, FALLBACK))
        }
    }
}
