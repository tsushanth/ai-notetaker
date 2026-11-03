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
    fun http403IsTheFreePlanLimitAndKeepsTheServerMessage() {
        val body = """{"success":false,"error":"Free plan allows 3 share links per month. Upgrade for unlimited sharing."}"""
        assertEquals(
            ShareLinkResult.LimitReached("Free plan allows 3 share links per month. Upgrade for unlimited sharing."),
            ShareLink.parseResponse(403, body)
        )
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
        // A 403 with no usable body is still the limit case, with the default text.
        assertEquals(ShareLinkResult.LimitReached(ShareLink.DEFAULT_ERROR), ShareLink.parseResponse(403, "<html>"))
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
