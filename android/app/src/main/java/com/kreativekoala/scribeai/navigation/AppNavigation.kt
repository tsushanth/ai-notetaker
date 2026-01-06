package com.kreativekoala.scribeai.navigation

import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.kreativekoala.scribeai.ui.screens.*
import com.kreativekoala.scribeai.ui.meetings.MeetingsScreen
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.viewmodel.AuthViewModel
import com.kreativekoala.scribeai.viewmodel.AuthState
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import com.kreativekoala.scribeai.viewmodel.NoteViewModelFactory
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.kreativekoala.scribeai.data.local.ScribeDatabase
import com.kreativekoala.scribeai.onboarding.OnboardingManager
import com.kreativekoala.scribeai.onboarding.OnboardingScreen
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.NoteDetailState
import com.kreativekoala.scribeai.ui.components.ReviewPromptDialog
import com.kreativekoala.scribeai.data.local.NoteCacheRepository as LocalNoteRepository

sealed class Screen(val route: String) {
    object Onboarding : Screen("onboarding")
    object Login : Screen("login")
    object SignUp : Screen("signup")
    object Home : Screen("home")
    object NoteDetail : Screen("note/{noteId}") {
        fun createRoute(noteId: String) = "note/$noteId"
    }
    object Recording : Screen("recording")
    object YouTube : Screen("youtube")
    object PDFUpload : Screen("pdf-upload")
    object Scan : Screen("scan")
    object Meetings : Screen("meetings")
    object DebugToken : Screen("debug-token")
}

@Composable
fun AppNavigation(
    authManager: AuthManager,
    authViewModel: AuthViewModel,
    subscriptionManager: SubscriptionManager,
    navController: NavHostController = rememberNavController()
) {
    val context = LocalContext.current
    val onboardingManager = remember { OnboardingManager.getInstance(context) }
    val hasCompletedOnboarding by onboardingManager.hasCompletedOnboarding.collectAsState()

    // Calculate start destination ONCE at initial composition
    // Show onboarding for new users who haven't completed it and aren't logged in yet
    val startDestination = remember {
        when {
            authManager.authToken.value != null -> Screen.Home.route
            !hasCompletedOnboarding -> Screen.Onboarding.route
            else -> Screen.Login.route
        }
    }

    // Observe auth state for reactive navigation (sign out handling)
    val authState by authViewModel.authState.collectAsState()

    // Handle sign out - navigate to login when auth becomes Idle AND we're not on login
    LaunchedEffect(authState) {
        if (authState is AuthState.Idle) {
            val currentRoute = navController.currentBackStackEntry?.destination?.route
            if (currentRoute != Screen.Login.route && currentRoute != Screen.SignUp.route) {
                Log.d("AppNavigation", "Auth is Idle, navigating to Login from $currentRoute")
                navController.navigate(Screen.Login.route) {
                    popUpTo(0) { inclusive = true }  // Clear entire back stack
                }
            }
        }

        // Sync onboarding preferences to backend after successful authentication
        if (authState is AuthState.Authenticated) {
            val token = (authState as AuthState.Authenticated).token
            if (onboardingManager.needsSync()) {
                Log.d("AppNavigation", "Syncing onboarding preferences to backend")
                onboardingManager.syncPreferencesToBackend(token)
            }
        }
    }

    // Initialize NoteViewModel with dependencies
    val localNoteRepository = remember {
        LocalNoteRepository(ScribeDatabase.getInstance(context).noteCacheDao())
    }

    val noteViewModel: NoteViewModel = viewModel(
        factory = NoteViewModelFactory(
            localRepository = localNoteRepository,
            subscriptionManager = subscriptionManager
        )
    )

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = startDestination
        ) {
        // Onboarding Screen
        composable(Screen.Onboarding.route) {
            OnboardingScreen(
                onboardingManager = onboardingManager,
                subscriptionManager = subscriptionManager,
                onComplete = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Onboarding.route) { inclusive = true }
                    }
                }
            )
        }

        // Login Screen
        composable(Screen.Login.route) {
            LoginScreen(
                viewModel = authViewModel,
                onNavigateToHome = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                },
                onNavigateToSignUp = {
                    navController.navigate(Screen.SignUp.route)
                }
            )
        }

        // Sign Up Screen
        composable(Screen.SignUp.route) {
            SignUpScreen(
                viewModel = authViewModel,
                onNavigateToHome = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.SignUp.route) { inclusive = true }
                    }
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                }
            )
        }

        // Home Screen
        composable(Screen.Home.route) {
            HomeScreen(
                onNoteClick = { note ->
                    navController.navigate(Screen.NoteDetail.createRoute(note.id))
                },
                onRecordAudio = {
                    navController.navigate(Screen.Recording.route)
                },
                onYouTube = {
                    navController.navigate(Screen.YouTube.route)
                },
                onUploadDocument = {
                    navController.navigate(Screen.PDFUpload.route)
                },
                onScanDocument = {
                    navController.navigate(Screen.Scan.route)
                },
                onMeetings = {
                    navController.navigate(Screen.Meetings.route)
                },
                onDebugToken = {
                    navController.navigate(Screen.DebugToken.route)
                },
                onSignOut = {
                    // Clear note cache before signing out to prevent stale data
                    val userId = authManager.getCurrentUserId()
                    if (userId != null) {
                        noteViewModel.clearCache(userId)
                    }
                    authViewModel.signOut()
                },
                viewModel = noteViewModel,
                authManager = authManager,
                subscriptionManager = subscriptionManager,
            )
        }

        // Note Detail Screen
        composable(
            route = Screen.NoteDetail.route,
            arguments = listOf(navArgument("noteId") { type = NavType.StringType })
        ) { backStackEntry ->
            val noteId = backStackEntry.arguments?.getString("noteId") ?: return@composable
            val authToken by authManager.authToken.collectAsState(initial = null)

            // Load the note when screen opens
            LaunchedEffect(noteId, authToken) {
                if (authToken != null) {
                    noteViewModel.loadNoteById(authToken!!, noteId)
                }
            }

            // Observe the note state
            val noteState by noteViewModel.noteDetailState.collectAsState()

            Box(modifier = Modifier.fillMaxSize()) {
                when (val state = noteState) {
                    is NoteDetailState.Loading -> {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                    is NoteDetailState.Success -> {
                        NoteDetailScreen(
                            authManager = authManager,
                            note = state.note,
                            noteViewModel = noteViewModel,
                            onNavigateBack = { navController.popBackStack() },
                            onNoteDeleted = {
                                navController.popBackStack()
                            }
                        )
                    }
                    is NoteDetailState.Error -> {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.padding(16.dp)
                            ) {
                                Icon(
                                    Icons.Default.Error,
                                    contentDescription = null,
                                    modifier = Modifier.size(48.dp),
                                    tint = MaterialTheme.colorScheme.error
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    "Error loading note",
                                    style = MaterialTheme.typography.titleMedium
                                )
                                Text(
                                    state.message,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                Button(onClick = { navController.popBackStack() }) {
                                    Text("Go Back")
                                }
                            }
                        }
                    }
                }
            }
        }

        // Recording Screen
        composable(Screen.Recording.route) {
            RecordingScreen(
                authManager = authManager,
                subscriptionManager = subscriptionManager,
                onNavigateBack = { navController.navigateUp() },
                onNavigateToNote = { noteId ->
                    navController.navigate(Screen.NoteDetail.createRoute(noteId)) {
                        popUpTo(Screen.Home.route)
                    }
                },
                onSuccess = { noteId ->
                    // Refresh home screen when returning
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                }
            )
        }

        // YouTube Input Screen
        composable(Screen.YouTube.route) {
            YouTubeInputScreen(
                viewModel = noteViewModel,
                authManager = authManager,
                subscriptionManager = subscriptionManager,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToLogin = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onSuccess = { navController.popBackStack() }
            )
        }

        // PDF Upload Screen
        composable(Screen.PDFUpload.route) {
            PDFUploadScreen(
                viewModel = noteViewModel,
                authManager = authManager,
                subscriptionManager = subscriptionManager,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToLogin = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onSuccess = { navController.popBackStack() }
            )
        }

        // Scan Document Screen
        composable(Screen.Scan.route) {
            ScanDocumentScreen(
                viewModel = noteViewModel,
                authManager = authManager,
                subscriptionManager = subscriptionManager,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToLogin = {
                    navController.navigate(Screen.Login.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
                onSuccess = { navController.popBackStack() }
            )
        }

        // Meetings Screen
        composable(Screen.Meetings.route) {
            MeetingsScreen(
                authManager = authManager,
                subscriptionManager = subscriptionManager,
                onNavigateBack = { navController.popBackStack() },
                onNavigateToNote = { noteId ->
                    navController.navigate(Screen.NoteDetail.createRoute(noteId)) {
                        popUpTo(Screen.Home.route)
                    }
                }
            )
        }

        // Debug Token Screen
        composable(Screen.DebugToken.route) {
            DebugTokenScreen(
                authManager = authManager,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        }

        // Review prompt dialog (shown on top of navigation)
        ReviewPromptDialog()
    }
}