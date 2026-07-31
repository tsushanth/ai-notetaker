package com.kreativekoala.scribeai

import android.app.Application
import android.content.Context
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import com.kreativekoala.scribeai.phone.VoipService
import com.kreativekoala.scribeai.service.FacebookSDKHelper
import com.kreativekoala.scribeai.service.TikTokHelper

class ScribeAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        TikTokHelper.initialize(this)
        FacebookSDKHelper.initialize(this)
        ExperimentManager.init(this)
        PromoCodeManager.init(this)
        VoipService.init(applicationContext)
    }

    companion object {
        // Exposed so non-Activity code (Retrofit interceptors etc.) can read
        // SharedPreferences without threading context through every call.
        lateinit var appContext: Context
            private set
    }
}
