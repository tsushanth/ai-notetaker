package com.kreativekoala.scribeai

import android.app.Activity
import android.os.Bundle
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
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
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.scribeai.ui.screens.TurboPaywallContent

class MainActivity : AppCompatActivity() {

    // Create AuthManager at class level so it's a single instance
    private lateinit var authManager: AuthManager
    private lateinit var subscriptionManager: SubscriptionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PromoCodeManager.handleIntent(intent)

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

        // Track app open count (once per cold-start session)
        subscriptionManager.incrementAppOpenCount()

        // Initialize billing with auth manager for server sync
        subscriptionManager.setAuthManager(authManager)
        subscriptionManager.initialize {
            subscriptionManager.refreshAccessStatus()
        }

        // Identify RC user when auth is available
        lifecycleScope.launch {
            authManager.userId.filterNotNull().first().let { userId ->
                subscriptionManager.identify(userId)
            }
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