package com.kreativekoala.scribeai.recording

import java.io.File
import java.io.RandomAccessFile

/**
 * Reads the frame headers of an ADTS AAC file. Used after a crash: a recording written as ADTS is playable up to its
 * last complete frame, so recovery only needs to cut a half-written last frame and work out the real length.
 */
object AdtsInspector {
    private val SAMPLE_RATES = intArrayOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)
    private const val SAMPLES_PER_FRAME = 1024
    private const val HEADER_BYTES = 7

    data class Info(
        /** Bytes of complete frames from the start of the file. Everything after this is a partial or damaged tail. */
        val validBytes: Long,
        val frames: Long,
        val sampleRate: Int,
        val durationMs: Long,
        /** True when the file had bytes after the last complete frame. */
        val hadDamagedTail: Boolean
    ) {
        val isEmpty: Boolean get() = frames == 0L
    }

    /** Header fields of the frame at the start of [h] (at least 7 bytes), or null if it is not a valid ADTS header. */
    internal fun parseHeader(h: ByteArray): Pair<Int, Int>? {
        if (h.size < HEADER_BYTES) return null
        val b0 = h[0].toInt() and 0xFF
        val b1 = h[1].toInt() and 0xFF
        val b2 = h[2].toInt() and 0xFF
        val b3 = h[3].toInt() and 0xFF
        val b4 = h[4].toInt() and 0xFF
        val b5 = h[5].toInt() and 0xFF
        if (b0 != 0xFF || (b1 and 0xF6) != 0xF0) return null // sync word 0xFFF, layer 00
        val freqIndex = (b2 shr 2) and 0x0F
        if (freqIndex >= SAMPLE_RATES.size) return null
        val frameLength = ((b3 and 0x03) shl 11) or (b4 shl 3) or (b5 shr 5)
        if (frameLength < HEADER_BYTES) return null
        return SAMPLE_RATES[freqIndex] to frameLength
    }

    fun scan(file: File): Info {
        if (!file.exists()) return Info(0, 0, 0, 0, false)
        RandomAccessFile(file, "r").use { raf ->
            val length = raf.length()
            var pos = 0L
            var frames = 0L
            var rate = 0
            val header = ByteArray(HEADER_BYTES)
            while (pos + HEADER_BYTES <= length) {
                raf.seek(pos)
                raf.readFully(header)
                val parsed = parseHeader(header) ?: break
                val (sr, frameLen) = parsed
                if (rate == 0) rate = sr else if (sr != rate) break // a stream never changes rate mid-file
                if (pos + frameLen > length) break // half-written last frame
                pos += frameLen
                frames++
            }
            val durationMs = if (rate == 0) 0L else frames * SAMPLES_PER_FRAME * 1000L / rate
            return Info(pos, frames, rate, durationMs, hadDamagedTail = pos < length)
        }
    }

    /** Cuts the damaged tail (if any) and returns what the file now holds. */
    fun repair(file: File): Info {
        val info = scan(file)
        if (info.hadDamagedTail) {
            RandomAccessFile(file, "rw").use { it.setLength(info.validBytes) }
        }
        return info.copy(hadDamagedTail = false)
    }
}
