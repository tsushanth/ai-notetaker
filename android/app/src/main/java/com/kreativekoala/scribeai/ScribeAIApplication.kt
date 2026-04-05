package com.kreativekoala.scribeai

import android.app.Application
import com.kreativekoala.scribeai.service.TikTokHelper
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration

class ScribeAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        TikTokHelper.initialize(this)
        ExperimentManager.init(this)

        Purchases.logLevel = LogLevel.DEBUG
        Purchases.configure(
            PurchasesConfiguration.Builder(this, "goog_pAhdzyfYlxyurpQQRymOTJMuMmv").build()
        )
    }
}
