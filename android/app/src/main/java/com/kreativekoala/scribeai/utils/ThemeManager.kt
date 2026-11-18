package com.kreativekoala.scribeai.utils

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import androidx.annotation.StringRes
import com.kreativekoala.scribeai.R

/**
 * App theme options
 */
enum class AppTheme(@StringRes val labelRes: Int, val icon: String) {
    SYSTEM(R.string.theme_system_short, "smartphone"),
    LIGHT(R.string.theme_light, "light_mode"),
    DARK(R.string.theme_dark, "dark_mode")
}

/**
 * Manages app-wide theme preference
 */
object ThemeManager {
    private const val PREFS_NAME = "theme_prefs"
    private const val KEY_THEME = "app_theme"

    private var prefs: SharedPreferences? = null
    private val _currentTheme = MutableStateFlow(AppTheme.DARK)
    val currentTheme: StateFlow<AppTheme> = _currentTheme.asStateFlow()

    fun initialize(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedTheme = prefs?.getString(KEY_THEME, AppTheme.DARK.name) ?: AppTheme.DARK.name
        _currentTheme.value = try {
            AppTheme.valueOf(savedTheme)
        } catch (e: Exception) {
            AppTheme.DARK
        }
    }

    fun setTheme(theme: AppTheme) {
        _currentTheme.value = theme
        prefs?.edit()?.putString(KEY_THEME, theme.name)?.apply()
    }

    @Composable
    fun isDarkTheme(): Boolean {
        return when (_currentTheme.value) {
            AppTheme.SYSTEM -> isSystemInDarkTheme()
            AppTheme.LIGHT -> false
            AppTheme.DARK -> true
        }
    }
}
