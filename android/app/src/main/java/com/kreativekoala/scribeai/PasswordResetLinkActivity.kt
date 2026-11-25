package com.kreativekoala.scribeai

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.kreativekoala.scribeai.utils.PasswordResetLink

/**
 * The link in the password reset email can open the app (the sign-in project redirects to the app link). This hands it
 * to the web page that sets the new password, and closes. It has no screen of its own.
 */
class PasswordResetLinkActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val link = intent?.data
        val target = PasswordResetLink.webUrl(link?.encodedFragment, link?.encodedQuery)
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target))) }
            .onFailure { FailureReporter.failure(flow = "Password reset link", message = "No browser could open the reset page") } // i18n-ok
        finish()
    }
}
