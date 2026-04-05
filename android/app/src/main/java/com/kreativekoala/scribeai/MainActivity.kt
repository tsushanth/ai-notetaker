package com.kreativekoala.scribeai

import android.app.Activity
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.DisposableEffect
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
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView

class MainActivity : AppCompatActivity() {

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

        // Track app open count (once per cold-start session)
        subscriptionManager.incrementAppOpenCount()

        // Initialize RevenueCat with auth manager for server sync
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

                    // Observe subscription state to reactively dismiss paywall
                    val subscriptionState by subscriptionManager.subscriptionState.collectAsState()
                    val isSubscribed = subscriptionState is SubscriptionManager.SubscriptionState.Subscribed
                    val products by subscriptionManager.products.collectAsState()

                    // Track whether the user has manually dismissed the paywall this session
                    var paywallDismissed by remember { mutableStateOf(false) }
                    val shouldShowPaywall = subscriptionManager.shouldShowHardPaywall() && !isSubscribed && !paywallDismissed

                    // FIXED: Pass the SAME authManager to AppNavigation
                    AppNavigation(
                        authManager = authManager,  // Same instance
                        authViewModel = authViewModel,
                        subscriptionManager = subscriptionManager
                    )

                    // PaywallKit soft paywall overlay
                    if (shouldShowPaywall) {
                        val activity = this@MainActivity as Activity

                        // Wait for products to load before showing paywall
                        if (products.isEmpty()) {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Color(0xFF0A0A0F)),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(color = Color(0xFF6C63FF))
                            }
                        } else {
                            // Map SubscriptionManager RC packages to PaywallProduct
                            val paywallProducts = products.map { pkg ->
                                val productId = pkg.product.id
                                PaywallProduct(
                                    id = productId,
                                    localizedPrice = pkg.product.price.formatted,
                                    price = pkg.product.price.amountMicros / 1_000_000.0,
                                    currencyCode = pkg.product.price.currencyCode,
                                    trialDays = 3,
                                    period = when {
                                        productId.contains("yearly") || productId.contains("annual") -> PaywallProduct.Period.YEARLY
                                        productId.contains("weekly") -> PaywallProduct.Period.WEEKLY
                                        else -> PaywallProduct.Period.MONTHLY
                                    }
                                )
                            }

                            val features = listOf(
                                PaywallFeature("\uD83D\uDCDD", "Unlimited Notes", "Create without limits"),
                                PaywallFeature("\uD83C\uDFA4", "Transcription", "Voice to text"),
                                PaywallFeature("\uD83E\uDD16", "AI Summaries", "Smart note summaries"),
                                PaywallFeature("\uD83D\uDCC1", "Organization", "Folders and tags"),
                                PaywallFeature("☁\uFE0F", "Cloud Sync", "Sync across devices")
                            )

                            PaywallView(
                                appId = "scribeai",
                                appName = "ScribeAI",
                                features = features,
                                products = paywallProducts,
                                theme = PaywallTheme(
                                    accent = Color(0xFF6C63FF),
                                    accent2 = Color(0xFF9C27B0)
                                ),
                                showWinback = true,
                                isDismissible = true,
                                onPurchase = { productId ->
                                    subscriptionManager.launchSubscriptionFlow(
                                        activity = activity,
                                        productId = productId,
                                        onSuccess = { paywallDismissed = true },
                                        onError = { /* handled by billing client listener */ }
                                    )
                                },
                                onRestore = {
                                    subscriptionManager.restorePurchases(
                                        onSuccess = { paywallDismissed = true },
                                        onError = { /* silently ignore */ }
                                    )
                                },
                                onDismiss = { paywallDismissed = true }
                            )
                        }
                    }
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