package com.kreativekoala.scribeai.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingPoliciesTest {
    private val mb = 1024L * 1024

    @Test
    fun storageThresholds() {
        assertFalse(StoragePolicy.canStart(49 * mb))
        assertTrue(StoragePolicy.canStart(50 * mb))
        assertEquals(StoragePolicy.Decision.STOP, StoragePolicy.decide(19 * mb))
        assertEquals(StoragePolicy.Decision.WARN, StoragePolicy.decide(60 * mb))
        assertEquals(StoragePolicy.Decision.OK, StoragePolicy.decide(500 * mb))
    }

    @Test
    fun batteryThresholds() {
        assertEquals(BatteryPolicy.Decision.OK, BatteryPolicy.decide(80, false))
        assertEquals(BatteryPolicy.Decision.WARN, BatteryPolicy.decide(14, false))
        assertEquals(BatteryPolicy.Decision.STOP, BatteryPolicy.decide(3, false))
        assertEquals(BatteryPolicy.Decision.OK, BatteryPolicy.decide(2, true)) // charging: never stop
        assertEquals(BatteryPolicy.Decision.OK, BatteryPolicy.decide(-1, false)) // unknown level
    }

    @Test
    fun inputRoutes() {
        assertEquals(InputRoute.BUILT_IN, InputRoute.fromDeviceType(15))
        assertEquals(InputRoute.WIRED, InputRoute.fromDeviceType(3))
        assertEquals(InputRoute.BLUETOOTH, InputRoute.fromDeviceType(7))
        assertEquals(InputRoute.USB, InputRoute.fromDeviceType(22))
        assertEquals(InputRoute.OTHER, InputRoute.fromDeviceType(99))
        assertEquals(InputRoute.UNKNOWN, InputRoute.fromDeviceType(null))
    }

    @Test
    fun sixtyFourKbpsFitsRoughlyAnHourAndAHalfUnderTheUploadLimit() {
        val bytesPerHour = RecordingConfig.BIT_RATE / 8L * 3600
        assertTrue(bytesPerHour < 30L * 1024 * 1024)
        assertTrue(RecordingConfig.MAX_FILE_BYTES < 50L * 1024 * 1024) // backend limit
        val minutesAtCap = RecordingConfig.MAX_FILE_BYTES / (RecordingConfig.BIT_RATE / 8L) / 60
        assertTrue("minutes at cap = $minutesAtCap", minutesAtCap in 80..120)
    }
}
