package com.kreativekoala.scribeai.utils

import org.junit.Assert.assertEquals
import org.junit.Test

class FeatureFlagsTest {
    private val off = FeatureFlagValues()

    @Test
    fun everythingIsOffByDefault() {
        assertEquals(FeatureFlagValues(false, false, false, false), off)
    }

    @Test
    fun brokenOrMissingBodiesLeaveEverythingOff() {
        listOf(null, "", "not json", "{}", """{"success":true}""", """{"data":null}""", """{"data":"x"}""", """{"data":[1]}""").forEach {
            assertEquals(it, off, FeatureFlags.parse(it))
        }
    }

    @Test
    fun onlyALiteralTrueSwitchesAFlagOn() {
        assertEquals(
            FeatureFlagValues(phoneCalls = false, learn = true, create = false, compete = false),
            FeatureFlags.parse("""{"success":true,"data":{"phone_calls":"true","learn":true,"create":1,"compete":"yes"}}""")
        )
        assertEquals(
            FeatureFlagValues(true, true, true, true),
            FeatureFlags.parse("""{"success":true,"data":{"phone_calls":true,"learn":true,"create":true,"compete":true}}""")
        )
    }
}
