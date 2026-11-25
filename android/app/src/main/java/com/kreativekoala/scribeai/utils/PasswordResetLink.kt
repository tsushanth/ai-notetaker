package com.kreativekoala.scribeai.utils

/** Where a password reset goes. The new password is chosen on the web page, which works on any device. */
object PasswordResetLink {
    const val WEB_PAGE = "https://scribeai.online/reset-password"

    /** The web page carrying whatever the email link brought (the recovery session is in the fragment). */
    fun webUrl(encodedFragment: String?, encodedQuery: String?): String = buildString {
        append(WEB_PAGE)
        if (!encodedQuery.isNullOrEmpty()) append('?').append(encodedQuery)
        if (!encodedFragment.isNullOrEmpty()) append('#').append(encodedFragment)
    }
}
