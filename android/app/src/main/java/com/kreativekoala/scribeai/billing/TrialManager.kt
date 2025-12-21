package com.kreativekoala.scribeai.billing

import android.content.Context
import android.content.SharedPreferences
import java.util.concurrent.TimeUnit

class TrialManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "trial_prefs"
        private const val KEY_FIRST_INSTALL_TIME = "first_install_time"
        private const val TRIAL_DAYS = 7
    }

    init {
        // Record first install time if not already recorded
        if (!prefs.contains(KEY_FIRST_INSTALL_TIME)) {
            prefs.edit().putLong(KEY_FIRST_INSTALL_TIME, System.currentTimeMillis()).apply()
        }
    }

    fun getFirstInstallTime(): Long {
        return prefs.getLong(KEY_FIRST_INSTALL_TIME, System.currentTimeMillis())
    }

    fun getDaysLeftInTrial(): Int {
        val firstInstallTime = getFirstInstallTime()
        val currentTime = System.currentTimeMillis()
        val daysPassed = TimeUnit.MILLISECONDS.toDays(currentTime - firstInstallTime)
        val daysLeft = TRIAL_DAYS - daysPassed.toInt()
        return maxOf(0, daysLeft) // Never return negative
    }

    fun isTrialExpired(): Boolean {
        return getDaysLeftInTrial() <= 0
    }

    fun getTrialExpiryDate(): Long {
        val firstInstallTime = getFirstInstallTime()
        return firstInstallTime + TimeUnit.DAYS.toMillis(TRIAL_DAYS.toLong())
    }

    fun shouldShowSubscriptionScreen(): Boolean {
        // Show if trial expired
        return isTrialExpired()
    }

    // For testing purposes - reset trial
    fun resetTrial() {
        prefs.edit().putLong(KEY_FIRST_INSTALL_TIME, System.currentTimeMillis()).apply()
    }
}