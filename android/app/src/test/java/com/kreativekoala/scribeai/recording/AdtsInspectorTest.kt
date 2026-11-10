package com.kreativekoala.scribeai.recording

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AdtsInspectorTest {
    @get:Rule val tmp = TemporaryFolder()

    /** One valid ADTS frame: 7-byte header (no CRC) + payload, for a 16 kHz mono AAC-LC stream. */
    private fun frame(payload: Int = 100, freqIndex: Int = 8): ByteArray {
        val len = 7 + payload
        val h = ByteArray(7)
        h[0] = 0xFF.toByte()
        h[1] = 0xF1.toByte()                                   // MPEG-4, layer 0, no CRC
        h[2] = ((1 shl 6) or (freqIndex shl 2) or 0).toByte()   // AAC-LC, sampling index, channel high bit 0
        h[3] = ((1 shl 6) or ((len shr 11) and 0x03)).toByte()  // channel config 1, length bits 12-11
        h[4] = ((len shr 3) and 0xFF).toByte()
        h[5] = (((len and 0x07) shl 5) or 0x1F).toByte()
        h[6] = 0xFC.toByte()
        return h + ByteArray(payload) { 0x11 }
    }

    private fun fileOf(vararg chunks: ByteArray): File {
        val f = tmp.newFile()
        f.writeBytes(chunks.fold(ByteArray(0)) { a, b -> a + b })
        return f
    }

    @Test
    fun countsFramesAndDuration() {
        val f = fileOf(*Array(160) { frame() }) // 160 frames of 1024 samples at 16 kHz = 10.24 s
        val info = AdtsInspector.scan(f)
        assertEquals(160, info.frames)
        assertEquals(16_000, info.sampleRate)
        assertEquals(10_240, info.durationMs)
        assertEquals(f.length(), info.validBytes)
        assertFalse(info.hadDamagedTail)
    }

    @Test
    fun halfWrittenLastFrameIsCutOff() {
        val full = Array(50) { frame() }
        val half = frame().copyOf(40) // process killed in the middle of writing a frame
        val f = fileOf(*full, half)
        val before = f.length()
        val info = AdtsInspector.repair(f)
        assertEquals(50, info.frames)
        assertEquals(50L * 107, f.length())
        assertTrue(before > f.length())
        // and a second scan is clean
        assertFalse(AdtsInspector.scan(f).hadDamagedTail)
    }

    @Test
    fun truncatedInsideTheHeaderIsCutOff() {
        val f = fileOf(*Array(10) { frame() }, byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x60))
        assertEquals(10, AdtsInspector.repair(f).frames)
    }

    @Test
    fun garbageTailAfterValidFramesIsCutOff() {
        val f = fileOf(*Array(10) { frame() }, ByteArray(64) { 0x55 })
        val info = AdtsInspector.repair(f)
        assertEquals(10, info.frames)
        assertEquals(1070L, f.length())
    }

    @Test
    fun emptyAndMissingFilesHaveNoFrames() {
        assertTrue(AdtsInspector.scan(fileOf()).isEmpty)
        assertTrue(AdtsInspector.scan(File(tmp.root, "missing.aac")).isEmpty)
    }

    @Test
    fun nonAdtsDataIsEmpty() {
        val f = fileOf(ByteArray(500) { 0x00 })
        val info = AdtsInspector.scan(f)
        assertTrue(info.isEmpty)
        assertEquals(0L, info.validBytes)
    }

    @Test
    fun sampleRateChangeMidFileEndsTheValidPart() {
        val f = fileOf(*Array(5) { frame(freqIndex = 8) }, *Array(5) { frame(freqIndex = 4) })
        assertEquals(5, AdtsInspector.scan(f).frames)
    }
}
