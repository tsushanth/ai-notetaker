package com.kreativekoala.scribeai

import android.app.Application
import com.kreativekoala.scribeai.service.TikTokHelper

class ScribeAIApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        TikTokHelper.initialize(this)
    }
}
