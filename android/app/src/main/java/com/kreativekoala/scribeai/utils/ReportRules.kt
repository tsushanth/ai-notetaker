package com.kreativekoala.scribeai.utils

import java.net.ConnectException
import java.net.UnknownHostException

/**
 * Which failures are worth telling the owner about. A daily limit, a wrong password, a cancelled dialog or a phone with
 * no signal is not the app breaking.
 */
object ReportRules {

    /** A failure the product is designed to produce (paywall, expired session, audio still being prepared). */
    class ExpectedFailure(message: String) : Exception(message)

    private val EXPECTED_AUTH_CODES = setOf(
        "invalid_credentials", "invalid_grant", "user_already_exists", "email_exists", "weak_password",
        "email_address_invalid", "validation_failed", "over_request_rate_limit", "over_email_send_rate_limit",
    )

    // Google Play Billing: OK, USER_CANCELED, ITEM_ALREADY_OWNED
    private val EXPECTED_BILLING_CODES = setOf(0, 1, 7)

    private val AUTH_CODE = Regex("\"(?:error_code|error)\"\\s*:\\s*\"([a-z_]{1,60})\"")

    /** The machine code in a Supabase Auth error body, or "unknown". Never the message: it can name the account. */
    fun authErrorCode(body: String?): String = body?.let { AUTH_CODE.find(it)?.groupValues?.get(1) } ?: "unknown"

    fun shouldReportAuth(httpStatus: Int, body: String?): Boolean =
        httpStatus != 429 && authErrorCode(body) !in EXPECTED_AUTH_CODES

    /** A refused backend request. 5xx is left to FailureReporterInterceptor, so one failure is one report. */
    fun shouldReportHttp(httpStatus: Int): Boolean = httpStatus < 500 && httpStatus !in setOf(401, 402, 403, 429)

    fun shouldReportException(error: Throwable): Boolean =
        error !is ExpectedFailure && error !is FreeTierErrors.DailyLimitException &&
            error !is UnknownHostException && error !is ConnectException &&
            error.javaClass.simpleName != "CancellationException" && error.javaClass.simpleName != "JobCancellationException"

    fun shouldReportBilling(responseCode: Int): Boolean = responseCode !in EXPECTED_BILLING_CODES

    /** Credential Manager: the user closing the sheet, or having no Google account, is not a failure. */
    fun shouldReportCredential(error: Throwable): Boolean {
        val name = error.javaClass.simpleName
        val message = error.message?.lowercase().orEmpty()
        return !name.contains("Cancellation") && !name.startsWith("NoCredential") &&
            !message.contains("canceled") && !message.contains("cancelled") && !message.contains("no credentials")
    }
}
