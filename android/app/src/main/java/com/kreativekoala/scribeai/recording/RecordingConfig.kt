package com.kreativekoala.scribeai.recording

/**
 * Numbers that shape a voice-note recording. Kept in one place so the service, the guards and the tests agree.
 *
 * Format: raw AAC-LC in ADTS frames, 16 kHz mono, 64 kbps. An ADTS file is a plain sequence of self-describing
 * frames, so it stays playable up to the last complete frame even if the process dies mid-recording (an MP4/M4A
 * only becomes playable when its index is written at stop). 64 kbps is about 29 MB per hour; the backend upload
 * limit is 50 MB, so a recording can run about 100 minutes (the old 128 kbps / 44.1 kHz setting hit the limit
 * at about 52 minutes).
 */
object RecordingConfig {
    const val SAMPLE_RATE_HZ = 16_000
    const val BIT_RATE = 64_000
    const val CHANNELS = 1
    const val FILE_EXTENSION = "aac"
    const val UPLOAD_MIME = "audio/aac"

    /** MediaRecorder stops by itself at this size (below the backend's 50 MB upload limit). */
    const val MAX_FILE_BYTES = 45L * 1024 * 1024

    /** Recordings shorter than this are dropped, they cannot hold a usable transcript. */
    const val MIN_USEFUL_MS = 1_000L

    /** How often the service reads the loudest-sample value, checks storage and battery. */
    const val METER_INTERVAL_MS = 500L
    const val HEALTH_CHECK_INTERVAL_MS = 10_000L

    /** Finished-but-unsent recordings that ended in a final failure are removed after this long. */
    const val STALE_FAILED_MS = 7L * 24 * 60 * 60 * 1000
}
