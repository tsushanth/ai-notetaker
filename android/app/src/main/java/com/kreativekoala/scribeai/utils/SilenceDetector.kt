package com.kreativekoala.scribeai.utils

/**
 * Notices a recording in which the microphone delivered nothing at all.
 *
 * MediaRecorder.getMaxAmplitude() returns the loudest sample since the previous call, and exactly 0
 * only when every sample was zero: the mic is muted (Android 12+ privacy toggle), blocked, held by
 * another app, or there is no mic (emulator). Ordinary quiet rooms read well above 0. The first call
 * after start() always returns 0 by design, so a verdict needs several readings.
 *
 * Used only to warn before upload; it never discards or blocks a recording.
 */
class SilenceDetector(private val minReadings: Int = MIN_READINGS) {
    private var readings = 0
    private var peak = 0

    fun add(maxAmplitude: Int) {
        readings++
        if (maxAmplitude > peak) peak = maxAmplitude
    }

    fun reset() {
        readings = 0
        peak = 0
    }

    val isSilent: Boolean
        get() = readings >= minReadings && peak == 0

    companion object {
        const val MIN_READINGS = 3
    }
}
