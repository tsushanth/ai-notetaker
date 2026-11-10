package com.kreativekoala.scribeai

import android.app.Application
import android.content.Context
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import com.kreativekoala.scribeai.phone.VoipService
import com.kreativekoala.scribeai.service.FacebookSDKHelper
import com.kreativekoala.scribeai.service.TikTokHelper
import com.kreativekoala.scribeai.utils.FeatureFlags
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class ScribeAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        FailureReporter.init(this, "scribeai", "afr_4e157f1621b41e23192afbecf48be0f6", BuildConfig.VERSION_NAME)
        appContext = applicationContext
        com.kreativekoala.scribeai.recording.AppVisibility.init(this)
        TikTokHelper.initialize(this)
        FacebookSDKHelper.initialize(this)
        ExperimentManager.init(this)
        PromoCodeManager.init(this)
        VoipService.init(applicationContext)
        FeatureFlags.load(applicationContext)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { FeatureFlags.refresh(applicationContext) }
    }

    companion object {
        // Exposed so non-Activity code (Retrofit interceptors etc.) can read
        // SharedPreferences without threading context through every call.
        lateinit var appContext: Context
            private set
    }
}
