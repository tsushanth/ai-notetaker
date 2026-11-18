package com.kreativekoala.scribeai.utils

import android.content.Context
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import com.kreativekoala.scribeai.ScribeAIApplication

/**
 * Looks up localized text from code that has no Compose or Activity context (repositories, view models,
 * services). Uses the application context, so it follows the system or per-app language.
 */
object AppStrings {
    private val context: Context get() = ScribeAIApplication.appContext

    fun get(@StringRes id: Int, vararg args: Any): String =
        if (args.isEmpty()) context.getString(id) else context.getString(id, *args)

    fun plural(@PluralsRes id: Int, quantity: Int, vararg args: Any): String =
        context.resources.getQuantityString(id, quantity, *args)
}
