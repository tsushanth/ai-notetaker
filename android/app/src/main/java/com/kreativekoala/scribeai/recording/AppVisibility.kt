package com.kreativekoala.scribeai.recording

import android.app.Activity
import android.app.Application
import android.os.Bundle

/**
 * Whether any activity of the app is on screen. Only used to label why a recording ended (stop reason: background
 * vs error), never to decide whether to record. Registered once from the Application.
 */
object AppVisibility {
    @Volatile private var started = 0

    val isForeground: Boolean get() = started > 0

    fun init(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { started++ }
            override fun onActivityStopped(activity: Activity) { if (started > 0) started-- }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
