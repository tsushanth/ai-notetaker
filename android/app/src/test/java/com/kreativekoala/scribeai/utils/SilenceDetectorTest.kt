package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SilenceDetectorTest {

    @Test
    fun allZeroReadingsAreSilent() {
        val d = SilenceDetector()
        repeat(5) { d.add(0) }
        assertTrue(d.isSilent)
    }

    @Test
    fun anyNonZeroReadingMeansSound() {
        val d = SilenceDetector()
        d.add(0); d.add(0); d.add(1); d.add(0)
        assertFalse(d.isSilent)
    }

    @Test
    fun tooFewReadingsNeverCallItSilent() {
        // The first reading after start() is always 0, and a tap-start/stop has only one or two.
        val d = SilenceDetector()
        assertFalse(d.isSilent)
        d.add(0)
        assertFalse(d.isSilent)
        d.add(0)
        assertFalse(d.isSilent)
        d.add(0)
        assertTrue(d.isSilent)
    }

    @Test
    fun quietButRealSoundIsNotSilent() {
        // Production recordings that reached the server peaked at about -16 dBFS, far above zero.
        val d = SilenceDetector()
        listOf(0, 1800, 5300, 900).forEach { d.add(it) }
        assertFalse(d.isSilent)
    }

    @Test
    fun resetStartsOver() {
        val d = SilenceDetector()
        repeat(4) { d.add(0) }
        assertTrue(d.isSilent)
        d.reset()
        assertFalse(d.isSilent)
        d.add(500)
        repeat(3) { d.add(0) }
        assertFalse(d.isSilent)
    }
}
