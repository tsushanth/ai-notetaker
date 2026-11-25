package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class ReportRulesTest {

    @Test
    fun wrongPasswordAndExistingAccountAreNotReported() {
        assertFalse(ReportRules.shouldReportAuth(400, """{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"""))
        assertFalse(ReportRules.shouldReportAuth(400, """{"error":"invalid_grant","error_description":"Invalid login credentials"}"""))
        assertFalse(ReportRules.shouldReportAuth(422, """{"error_code":"user_already_exists"}"""))
        assertFalse(ReportRules.shouldReportAuth(429, ""))
    }

    @Test
    fun brokenSignInIsReportedByCodeOnly() {
        val body = """{"error_code":"unexpected_failure","msg":"Database error saving new user someone@example.com"}"""
        assertTrue(ReportRules.shouldReportAuth(500, body))
        assertTrue(ReportRules.shouldReportAuth(400, """{"error_code":"bad_oauth_callback"}"""))
        assertEquals("unexpected_failure", ReportRules.authErrorCode(body))
        assertEquals("unknown", ReportRules.authErrorCode("<html>"))
    }

    @Test
    fun limitsPaywallsAndNoSignalAreNotFeatureFailures() {
        assertFalse(ReportRules.shouldReportException(FreeTierErrors.DailyLimitException("limit")))
        assertFalse(ReportRules.shouldReportException(ReportRules.ExpectedFailure("still generating")))
        assertFalse(ReportRules.shouldReportException(UnknownHostException()))
        assertTrue(ReportRules.shouldReportException(SocketTimeoutException()))
        assertFalse(ReportRules.shouldReportHttp(429))
        assertTrue(ReportRules.shouldReportHttp(404))
        assertTrue(ReportRules.shouldReportHttp(422))
        assertFalse(ReportRules.shouldReportHttp(502)) // the interceptor reports it
    }

    @Test
    fun billingCancelAndAlreadyOwnedAreNotReported() {
        for (code in listOf(0, 1, 7)) assertFalse(ReportRules.shouldReportBilling(code))
        for (code in listOf(-1, 2, 3, 4, 5, 6, 12)) assertTrue(ReportRules.shouldReportBilling(code))
    }

    private class GetCredentialCancellationException : Exception("activity is cancelled by the user")
    private class NoCredentialException : Exception("none")

    @Test
    fun closingTheGoogleSheetIsNotReported() {
        assertFalse(ReportRules.shouldReportCredential(GetCredentialCancellationException()))
        assertFalse(ReportRules.shouldReportCredential(NoCredentialException()))
        assertTrue(ReportRules.shouldReportCredential(IllegalStateException("provider configuration")))
    }

    @Test
    fun passwordResetLinkKeepsTheRecoverySession() {
        assertEquals(
            "https://scribeai.online/reset-password#access_token=a&type=recovery",
            PasswordResetLink.webUrl("access_token=a&type=recovery", null),
        )
        assertEquals("https://scribeai.online/reset-password", PasswordResetLink.webUrl(null, null))
    }
}
