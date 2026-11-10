package com.kreativekoala.scribeai.utils

import android.content.Context
import com.google.gson.JsonParser
import com.kreativekoala.scribeai.data.api.RetrofitClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

/**
 * Server-driven switches for features that are hidden by default (GET /api/config/features).
 * Every flag is off until the server says true; the last answer is kept so the next launch does not flash the tabs.
 * If the request fails the last known values stay as they were (off on a first launch).
 */
data class FeatureFlagValues(
    val phoneCalls: Boolean = false,
    val learn: Boolean = false,
    val create: Boolean = false,
    val compete: Boolean = false
)

object FeatureFlags {
    private const val PREFS_NAME = "scribe_ai_prefs"
    private const val KEY_PHONE = "ff_phone_calls"
    private const val KEY_LEARN = "ff_learn"
    private const val KEY_CREATE = "ff_create"
    private const val KEY_COMPETE = "ff_compete"

    private val _flags = MutableStateFlow(FeatureFlagValues())
    val flags: StateFlow<FeatureFlagValues> = _flags

    /** Pure: only a literal JSON true switches a flag on; anything else, including a broken body, leaves everything off. */
    fun parse(body: String?): FeatureFlagValues {
        val data = try {
            JsonParser.parseString(body ?: "").asJsonObject.getAsJsonObject("data")
        } catch (e: Exception) {
            null
        } ?: return FeatureFlagValues()
        fun on(name: String): Boolean {
            val el = data.get(name) ?: return false
            return el.isJsonPrimitive && el.asJsonPrimitive.isBoolean && el.asBoolean
        }
        return FeatureFlagValues(on("phone_calls"), on("learn"), on("create"), on("compete"))
    }

    /** Load the last known values (call once at startup, before the first screen). */
    fun load(context: Context) {
        val p = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        _flags.value = FeatureFlagValues(
            p.getBoolean(KEY_PHONE, false), p.getBoolean(KEY_LEARN, false),
            p.getBoolean(KEY_CREATE, false), p.getBoolean(KEY_COMPETE, false)
        )
    }

    /** Ask the server. Safe to call from any thread; a failure changes nothing. */
    suspend fun refresh(context: Context) = withContext(Dispatchers.IO) {
        try {
            val response = RetrofitClient.apiService.getFeatureFlags()
            if (!response.isSuccessful) return@withContext
            val values = parse(response.body()?.string())
            _flags.value = values
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putBoolean(KEY_PHONE, values.phoneCalls).putBoolean(KEY_LEARN, values.learn)
                .putBoolean(KEY_CREATE, values.create).putBoolean(KEY_COMPETE, values.compete)
                .apply()
        } catch (e: Exception) {
            // keep the last known values
        }
    }
}
