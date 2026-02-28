package com.kreativekoala.scribeai

import android.app.Application
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration

class ScribeAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        configureRevenueCat()
    }

    private fun configureRevenueCat() {
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.WARN

        Purchases.configure(
            PurchasesConfiguration.Builder(this, "goog_pAhdzyfYlxyurpQQRymOTJMuMmv")
                .build()
        )
    }
}
