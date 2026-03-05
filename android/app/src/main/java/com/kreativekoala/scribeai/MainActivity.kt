package com.kreativekoala.scribeai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.kreativekoala.scribeai.data.local.NoteCacheRepository
import com.kreativekoala.scribeai.data.local.ScribeDatabase
import com.kreativekoala.scribeai.navigation.AppNavigation
import com.kreativekoala.scribeai.ui.theme.AINotetakerTheme
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.ErrorReportingService
import com.kreativekoala.scribeai.utils.FirebaseAnalyticsHelper
import com.kreativekoala.scribeai.utils.InAppReviewHelper
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.utils.ThemeManager
import com.kreativekoala.scribeai.utils.TutorialManager
import com.kreativekoala.scribeai.viewmodel.AuthViewModel
import com.kreativekoala.scribeai.viewmodel.AuthViewModelFactory

class MainActivity : ComponentActivity() {

    // Create AuthManager at class level so it's a single instance
    private lateinit var authManager: AuthManager
    private lateinit var subscriptionManager: SubscriptionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize managers ONCE - these are the single instances
        authManager = AuthManager(applicationContext)
        subscriptionManager = SubscriptionManager(applicationContext)

        // Initialize error reporting service
        ErrorReportingService.initialize(applicationContext, authManager)

        // Initialize analytics service and track app launch
        AnalyticsService.initialize(applicationContext, authManager)
        AnalyticsService.trackAppLaunch()

        // Initialize in-app review helper
        InAppReviewHelper.initialize(applicationContext)

        // Initialize theme manager
        ThemeManager.initialize(applicationContext)

        // Initialize Firebase Analytics (free, unlimited)
        FirebaseAnalyticsHelper.initialize(applicationContext)
        FirebaseAnalyticsHelper.logAppOpen()

        // Initialize TutorialManager
        val database = ScribeDatabase.getInstance(applicationContext)
        val localNoteRepository = NoteCacheRepository(database.noteCacheDao())
        val tutorialManager = TutorialManager(
            context = applicationContext,
            localRepository = localNoteRepository,
            authManager = authManager
        )

        // Initialize billing client with auth manager for server sync
        subscriptionManager.setAuthManager(authManager)
        subscriptionManager.initialize {
            subscriptionManager.checkExistingSubscriptions()
            // Refresh access status from server when billing is ready
            subscriptionManager.refreshAccessStatus()
        }

        setContent {
            AINotetakerTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    // FIXED: Pass the SAME authManager instance to the factory
                    val authViewModel: AuthViewModel = ViewModelProvider(
                        this,
                        AuthViewModelFactory(
                            application = application,
                            authManager = authManager,  // FIXED: Pass the same instance
                            tutorialManager = tutorialManager
                        )
                    ).get(AuthViewModel::class.java)

                    // Clean up when composition leaves
                    DisposableEffect(Unit) {
                        onDispose {
                            subscriptionManager.cleanup()
                        }
                    }

                    // FIXED: Pass the SAME authManager to AppNavigation
                    AppNavigation(
                        authManager = authManager,  // Same instance
                        authViewModel = authViewModel,
                        subscriptionManager = subscriptionManager
                    )
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        AnalyticsService.startSession()
    }

    override fun onStop() {
        super.onStop()
        AnalyticsService.endSession()
    }
}