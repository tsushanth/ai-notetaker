package com.kreativekoala.scribeai.recording

/** Free internal storage decisions. Recordings are written to the app's private files directory. */
object StoragePolicy {
    const val MIN_TO_START_BYTES = 50L * 1024 * 1024
    const val WARN_BELOW_BYTES = 100L * 1024 * 1024
    const val STOP_BELOW_BYTES = 20L * 1024 * 1024

    enum class Decision { OK, WARN, STOP }

    fun canStart(freeBytes: Long) = freeBytes >= MIN_TO_START_BYTES

    fun decide(freeBytes: Long): Decision = when {
        freeBytes < STOP_BELOW_BYTES -> Decision.STOP
        freeBytes < WARN_BELOW_BYTES -> Decision.WARN
        else -> Decision.OK
    }
}

/** Battery decisions. A charging phone is never warned. */
object BatteryPolicy {
    const val WARN_AT_PERCENT = 15
    const val STOP_AT_PERCENT = 3

    enum class Decision { OK, WARN, STOP }

    fun decide(percent: Int, charging: Boolean): Decision = when {
        charging || percent < 0 -> Decision.OK
        percent <= STOP_AT_PERCENT -> Decision.STOP
        percent <= WARN_AT_PERCENT -> Decision.WARN
        else -> Decision.OK
    }
}

/** Which microphone is feeding the recording, as a coarse label for diagnostics (no device names or addresses). */
enum class InputRoute(val wire: String) {
    BUILT_IN("builtin"), WIRED("wired"), BLUETOOTH("bluetooth"), USB("usb"), OTHER("other"), UNKNOWN("unknown");

    companion object {
        // AudioDeviceInfo.TYPE_* values, written as numbers so this can be unit-tested without the Android framework.
        fun fromDeviceType(type: Int?): InputRoute = when (type) {
            null -> UNKNOWN
            15 -> BUILT_IN                 // TYPE_BUILTIN_MIC
            3, 4 -> WIRED                  // TYPE_WIRED_HEADSET, TYPE_WIRED_HEADPHONES
            7, 8, 26 -> BLUETOOTH          // TYPE_BLUETOOTH_SCO, TYPE_BLUETOOTH_A2DP, TYPE_BLE_HEADSET
            11, 22 -> USB                  // TYPE_USB_DEVICE, TYPE_USB_HEADSET
            else -> OTHER
        }
    }
}
