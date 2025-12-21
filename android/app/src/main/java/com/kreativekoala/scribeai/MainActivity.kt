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
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.ErrorReportingService
import com.kreativekoala.scribeai.utils.SubscriptionManager
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

        // Initialize TutorialManager
        val database = ScribeDatabase.getInstance(applicationContext)
        val localNoteRepository = NoteCacheRepository(database.noteCacheDao())
        val tutorialManager = TutorialManager(
            context = applicationContext,
            localRepository = localNoteRepository
        )

        // Initialize billing client
        subscriptionManager.initialize {
            subscriptionManager.checkExistingSubscriptions()
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
}