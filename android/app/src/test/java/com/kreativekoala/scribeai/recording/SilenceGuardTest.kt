package com.kreativekoala.scribeai.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SilenceGuardTest {
    /** Feeds [amps] one reading every 500 ms starting at [from]; returns the last level. */
    private fun feed(g: SilenceGuard, amps: List<Int>, from: Long = 0L): SilenceGuard.Level {
        var level = SilenceGuard.Level.OK
        amps.forEachIndexed { i, a -> level = g.onSample(from + i * 500L, a) }
        return level
    }

    private fun constant(value: Int, seconds: Int) = List(seconds * 2) { value }

    @Test
    fun allZeroBufferRaisesNoSoundAfterFiveSeconds() {
        val g = SilenceGuard()
        assertEquals(SilenceGuard.Level.OK, feed(g, constant(0, 4)))
        assertEquals(SilenceGuard.Level.NO_SOUND, feed(g, constant(0, 7)))
        assertTrue(g.summary().warnedNoSound)
    }

    @Test
    fun normalSpeechNeverWarns() {
        val g = SilenceGuard()
        val speech = List(120) { 800 + (it * 97) % 9000 }
        assertEquals(SilenceGuard.Level.OK, feed(g, speech))
        val s = g.summary()
        assertFalse(s.allSilent)
        assertFalse(s.warnedNoSound)
        assertEquals(0, s.silentPercent)
    }

    @Test
    fun quietRoomNoiseFloorDoesNotTrip() {
        // A real microphone's own noise floor reads tens to low hundreds on the 0..32767 scale.
        val g = SilenceGuard()
        assertEquals(SilenceGuard.Level.OK, feed(g, constant(60, 60)))
    }

    @Test
    fun veryQuietForTwentySecondsIsLowSound() {
        val g = SilenceGuard()
        assertEquals(SilenceGuard.Level.OK, feed(g, constant(10, 15)))
        assertEquals(SilenceGuard.Level.LOW_SOUND, feed(g, constant(10, 10), from = 15_000))
    }

    @Test
    fun warningClearsWhenSoundReturns() {
        val g = SilenceGuard()
        feed(g, constant(0, 8))
        assertEquals(SilenceGuard.Level.NO_SOUND, g.level)
        assertEquals(SilenceGuard.Level.OK, g.onSample(8_000, 3000))
        // ...but the recording still remembers it warned
        assertTrue(g.summary().warnedNoSound)
    }

    @Test
    fun shortSilentBlipsInSpeechDoNotWarn() {
        val g = SilenceGuard()
        val amps = List(60) { if (it % 10 == 0) 0 else 2500 }
        assertEquals(SilenceGuard.Level.OK, feed(g, amps))
        assertEquals(10, g.summary().silentPercent)
    }

    @Test
    fun wholeRecordingOfZerosIsAllSilent() {
        val g = SilenceGuard()
        feed(g, constant(0, 30))
        val s = g.summary()
        assertTrue(s.allSilent)
        assertEquals(100, s.silentPercent)
        assertEquals(0, s.peakAmplitude)
    }

    @Test
    fun aOneSecondClipIsNotCalledSilent() {
        val g = SilenceGuard()
        feed(g, listOf(0, 0))
        assertFalse(g.summary().allSilent) // too little data to say
    }

    @Test
    fun oneLoudSampleMeansNotSilent() {
        val g = SilenceGuard()
        feed(g, constant(0, 30) + listOf(900))
        assertFalse(g.summary().allSilent)
        assertEquals(900, g.summary().peakAmplitude)
    }

    @Test
    fun negativeReadingsAreTreatedAsSilence() {
        val g = SilenceGuard()
        feed(g, List(20) { -1 })
        assertEquals(0, g.summary().peakAmplitude)
    }

    @Test
    fun resetStartsOver() {
        val g = SilenceGuard()
        feed(g, constant(0, 10))
        g.reset()
        assertEquals(0, g.summary().samples)
        assertEquals(SilenceGuard.Level.OK, g.level)
    }
}
