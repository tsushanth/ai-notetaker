package com.kreativekoala.scribeai.utils

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings

/**
 * Utility class to generate device fingerprints for fraud detection.
 *
 * This fingerprint is used to detect self-referral in the creator program,
 * where a creator tries to earn commission by subscribing themselves.
 */
object DeviceFingerprint {

    /**
     * Generate a device fingerprint combining multiple device identifiers.
     *
     * Components:
     * - Android ID (persists across app reinstalls, resets on factory reset)
     * - Device model and manufacturer
     * - Android version
     * - Screen resolution
     *
     * @param context Application context
     * @return Device fingerprint string
     */
    @SuppressLint("HardwareIds")
    fun generate(context: Context): String {
        val components = mutableListOf<String>()

        // Android ID - unique per device/user combination
        try {
            val androidId = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID
            )
            if (!androidId.isNullOrEmpty()) {
                components.add(androidId)
            }
        } catch (e: Exception) {
            // Ignore if we can't get Android ID
        }

        // Device information
        components.add(Build.MANUFACTURER)
        components.add(Build.MODEL)
        components.add(Build.DEVICE)

        // Android version
        components.add(Build.VERSION.SDK_INT.toString())
        components.add(Build.VERSION.RELEASE)

        // Screen metrics
        try {
            val displayMetrics = context.resources.displayMetrics
            components.add("${displayMetrics.widthPixels}x${displayMetrics.heightPixels}")
            components.add("${displayMetrics.densityDpi}")
        } catch (e: Exception) {
            // Ignore if we can't get display metrics
        }

        // Build fingerprint (unique to each build)
        try {
            components.add(Build.FINGERPRINT)
        } catch (e: Exception) {
            // Ignore if we can't get build fingerprint
        }

        // Combine all components into a single fingerprint
        return components.joinToString(separator = "|")
    }
}
