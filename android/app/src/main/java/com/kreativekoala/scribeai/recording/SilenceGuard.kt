package com.kreativekoala.scribeai.recording

/**
 * Watches the loudest-sample readings (MediaRecorder.getMaxAmplitude(), 0..32767) while a recording runs and tells
 * the user early when the microphone is delivering nothing, instead of after a 30-minute lecture.
 *
 * - Digital silence: peak <= [SILENT_PEAK] (all samples zero: mic muted/blocked, another app holds it, or the app
 *   was silenced because it left the foreground). Warned after [SILENT_WARN_MS] of it in a row.
 * - Very quiet: peak < [QUIET_PEAK] for [QUIET_WARN_MS] in a row (a covered microphone, a far-away speaker).
 * A normal quiet room reads well above [QUIET_PEAK] (the microphone's own noise floor), so it does not trip.
 *
 * Time comes from the callers' own timestamps (active recording time), so pauses do not count and tests need no
 * real clock. Not thread safe: call from one thread.
 */
class SilenceGuard(
    private val silentWarnMs: Long = SILENT_WARN_MS,
    private val quietWarnMs: Long = QUIET_WARN_MS
) {
    enum class Level { OK, LOW_SOUND, NO_SOUND }

    data class Summary(
        val samples: Int,
        val peakAmplitude: Int,
        /** Share of samples (0-100) that were digital silence. */
        val silentPercent: Int,
        /** True when the whole recording was digital silence: nothing for a transcriber to hear. */
        val allSilent: Boolean,
        /** True when a live no-sound warning was raised at any point. */
        val warnedNoSound: Boolean
    )

    private var samples = 0
    private var silentSamples = 0
    private var peak = 0
    private var silentRunStart: Long? = null
    private var quietRunStart: Long? = null
    private var lastTime = 0L
    private var firstTime: Long? = null
    private var warnedNoSound = false

    var level: Level = Level.OK
        private set

    fun reset() {
        samples = 0; silentSamples = 0; peak = 0
        silentRunStart = null; quietRunStart = null
        lastTime = 0L; firstTime = null; warnedNoSound = false
        level = Level.OK
    }

    /** [activeMs] is the active recording time (pauses excluded) at the moment of the reading. */
    fun onSample(activeMs: Long, amplitude: Int): Level {
        val amp = amplitude.coerceAtLeast(0)
        if (firstTime == null) firstTime = activeMs
        lastTime = activeMs
        samples++
        if (amp > peak) peak = amp

        if (amp <= SILENT_PEAK) {
            silentSamples++
            if (silentRunStart == null) silentRunStart = activeMs
        } else silentRunStart = null

        if (amp < QUIET_PEAK) {
            if (quietRunStart == null) quietRunStart = activeMs
        } else quietRunStart = null

        level = when {
            silentRunStart != null && activeMs - silentRunStart!! >= silentWarnMs -> Level.NO_SOUND
            quietRunStart != null && activeMs - quietRunStart!! >= quietWarnMs -> Level.LOW_SOUND
            else -> Level.OK
        }
        if (level == Level.NO_SOUND) warnedNoSound = true
        return level
    }

    fun summary(): Summary {
        val span = (firstTime?.let { lastTime - it } ?: 0L)
        return Summary(
            samples = samples,
            peakAmplitude = peak,
            silentPercent = if (samples == 0) 0 else (silentSamples * 100) / samples,
            // Needs a few seconds of readings: a 1-second clip proves nothing.
            allSilent = samples > 0 && peak <= SILENT_PEAK && span >= MIN_SPAN_FOR_VERDICT_MS,
            warnedNoSound = warnedNoSound
        )
    }

    companion object {
        const val SILENT_PEAK = 1
        const val QUIET_PEAK = 40
        const val SILENT_WARN_MS = 5_000L
        const val QUIET_WARN_MS = 20_000L
        const val MIN_SPAN_FOR_VERDICT_MS = 2_000L
    }
}
