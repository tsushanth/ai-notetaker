package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FreeTierErrorsTest {

    @Test
    fun usesServerMessageFromErrorField() {
        val body = """{"success":false,"error":"You have reached today's limit of 60 AI generations. It resets on a rolling 24-hour basis, so please try again later.","code":"DAILY_LIMIT_REACHED","details":{"upgradeRequired":false}}"""
        assertEquals(
            "You have reached today's limit of 60 AI generations. It resets on a rolling 24-hour basis, so please try again later.",
            FreeTierErrors.dailyLimitMessage(body)
        )
    }

    @Test
    fun usesMessageFieldWhenNoErrorField() {
        assertEquals("Slow down", FreeTierErrors.dailyLimitMessage("""{"message":"Slow down"}"""))
    }

    @Test
    fun fallsBackToPlainDefaultForMissingOrBadBodies() {
        listOf(null, "", "not json", "[]", "{}", """{"error":""}""", """{"error":{"a":1}}""").forEach {
            assertEquals(FreeTierErrors.DEFAULT_LIMIT_MESSAGE, FreeTierErrors.dailyLimitMessage(it))
        }
    }

    @Test
    fun ignoresAbsurdlyLongServerMessages() {
        val body = """{"error":"${"x".repeat(400)}"}"""
        assertEquals(FreeTierErrors.DEFAULT_LIMIT_MESSAGE, FreeTierErrors.dailyLimitMessage(body))
    }

    @Test
    fun defaultMessageIsPlainAsciiAndNeverSaysUpgrade() {
        val m = FreeTierErrors.DEFAULT_LIMIT_MESSAGE
        assertFalse(m.contains("upgrade", ignoreCase = true))
        assertTrue(m.all { it.code < 128 })
        assertEquals("You have reached today's free limit, try again later", m)
    }
}
