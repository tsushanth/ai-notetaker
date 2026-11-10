package com.kreativekoala.scribeai.onboarding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OnboardingStepTest {

    @Test
    fun comparisonGoesStraightToNotifications() {
        assertEquals(OnboardingStep.NOTIFICATIONS, OnboardingStep.COMPARISON.next())
    }

    @Test
    fun notificationsIsTheLastStep() {
        assertNull(OnboardingStep.NOTIFICATIONS.next())
        assertEquals(1f, OnboardingStep.NOTIFICATIONS.progress, 0.0001f)
    }

    @Test
    fun stepIndexesAreContiguous() {
        OnboardingStep.values().forEachIndexed { i, step -> assertEquals(i, step.index) }
    }
}
