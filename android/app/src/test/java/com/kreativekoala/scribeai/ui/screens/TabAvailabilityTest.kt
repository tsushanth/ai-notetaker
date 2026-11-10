package com.kreativekoala.scribeai.ui.screens

import com.kreativekoala.scribeai.utils.FeatureFlagValues
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TabAvailabilityTest {
    @Test
    fun learnCreateAndCompeteAreHiddenUntilTheirFlagIsOn() {
        val off = FeatureFlagValues()
        assertFalse(isTabAvailable(1, off))
        assertFalse(isTabAvailable(2, off))
        assertFalse(isTabAvailable(3, off))
        assertTrue(isTabAvailable(1, off.copy(learn = true)))
        assertFalse(isTabAvailable(2, off.copy(learn = true)))
        assertTrue(isTabAvailable(3, off.copy(compete = true)))
    }

    @Test
    fun everyOtherTabIsAlwaysAvailable() {
        for (tab in listOf(0, 4, 5, 6, 7, 8)) assertTrue(isTabAvailable(tab, FeatureFlagValues()))
    }
}
