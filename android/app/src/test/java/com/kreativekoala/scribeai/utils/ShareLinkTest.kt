package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareLinkTest {

    @Test
    fun successReturnsTheShareUrl() {
        val body = """{"success":true,"data":{"shareId":"a","shareToken":"t","shareUrl":"https://scribeai.app/shared/t"}}"""
        assertEquals(ShareLinkResult.Success("https://scribeai.app/shared/t"), ShareLink.parseResponse(200, body))
    }

    @Test
    fun successWithoutAUrlIsAFailureNotAnEmptyClipboard() {
        listOf(
            """{"success":true}""",
            """{"success":true,"data":{}}""",
            """{"success":true,"data":{"shareUrl":""}}""",
            """{"success":true,"data":"x"}"""
        ).forEach {
            assertEquals(it, ShareLinkResult.Failure(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(200, it))
        }
    }

    @Test
    fun http429IsTheDailyLimitAndShowsTheServerMessage() {
        val body = """{"success":false,"error":"You have reached today's limit of share links. Please try again tomorrow."}"""
        assertEquals(
            ShareLinkResult.LimitReached("You have reached today's limit of share links. Please try again tomorrow."),
            ShareLink.parseResponse(429, body)
        )
        assertEquals(ShareLinkResult.LimitReached(FreeTierErrors.DEFAULT_LIMIT_MESSAGE), ShareLink.parseResponse(429, "<html>"))
    }

    @Test
    fun http403NeverShowsAnUpgradeMessage() {
        // Sharing is free; an older server may still answer 403 with an upsell, which is replaced by a plain failure.
        val body = """{"success":false,"error":"Free plan allows 3 share links per month. Upgrade for unlimited sharing."}"""
        assertEquals(ShareLinkResult.Failure(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(403, body))
    }

    @Test
    fun otherErrorsAreFailuresWithTheServerMessage() {
        assertEquals(ShareLinkResult.Failure("Note not found"), ShareLink.parseResponse(404, """{"success":false,"error":"Note not found"}"""))
        assertEquals(ShareLinkResult.Failure("Slow down"), ShareLink.parseResponse(500, """{"message":"Slow down"}"""))
    }

    @Test
    fun badBodiesFallBackToTheDefaultMessage() {
        listOf(null, "", "not json", "[]", "{}", """{"error":""}""", """{"error":{"a":1}}""").forEach {
            assertEquals(ShareLinkResult.Failure(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(500, it))
        }
        assertEquals(ShareLinkResult.Failure(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(403, "<html>"))
    }

    @Test
    fun overlongServerMessagesAreNotShown() {
        val long = "x".repeat(301)
        assertEquals(ShareLinkResult.Failure(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(500, """{"error":"$long"}"""))
    }

    @Test
    fun shareMessageIncludesTheTitleAndUrl() {
        assertEquals("Bio 101 (notes made with Scribe AI): https://x/y", ShareLink.shareMessage("  Bio 101 ", "https://x/y"))
        assertTrue(ShareLink.shareMessage("", "https://x/y").endsWith("https://x/y"))
    }
}
