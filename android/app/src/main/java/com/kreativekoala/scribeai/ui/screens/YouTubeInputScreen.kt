package com.kreativekoala.scribeai.ui.screens

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.components.*
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AnalyticsService
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YouTubeInputScreen(
    viewModel: NoteViewModel = viewModel(),
    authManager: AuthManager,
    onNavigateBack: () -> Unit,
    onNavigateToLogin: () -> Unit = {},
    onSuccess: () -> Unit = {},
    subscriptionManager: SubscriptionManager
) {
    var youtubeUrl by remember { mutableStateOf("") }
    var showTranscriptInfo by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    // Processing state
    var processingState by remember { mutableStateOf<ProcessingState>(ProcessingState.Idle) }
    var processingSteps by remember { mutableStateOf(createYouTubeProcessingSteps(context)) }
    var currentStepIndex by remember { mutableIntStateOf(0) }
    var uploadComplete by remember { mutableStateOf(false) }

    val authToken by authManager.authToken.collectAsState()

    // Check auth with delay
    LaunchedEffect(authToken) {
        delay(500)
        if (authToken == null) {
            processingState = ProcessingState.Error("Please log in to continue")
            delay(1500)
            onNavigateToLogin()
        }
    }

    // Show loading while auth initializes
    if (authToken == null && processingState is ProcessingState.Idle) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(DarkBackground),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Purple80)
        }
        return
    }

    Scaffold(
        topBar = {
            if (processingState is ProcessingState.Idle) {
                TopAppBar(
                    title = { Text(stringResource(R.string.youtube_url)) },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back), tint = TextPrimary)
                        }
                    },
                    actions = {
                        IconButton(onClick = { showTranscriptInfo = true }) {
                            Icon(Icons.Default.Info, contentDescription = null, tint = TextSecondary)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = DarkBackground,
                        titleContentColor = TextPrimary
                    )
                )
            }
        },
        containerColor = DarkBackground
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = processingState) {
                is ProcessingState.Idle -> {
                    YouTubeInputContent(
                        youtubeUrl = youtubeUrl,
                        onUrlChange = { youtubeUrl = it },
                        onPasteFromClipboard = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            val clipData = clipboard.primaryClip
                            if (clipData != null && clipData.itemCount > 0) {
                                youtubeUrl = clipData.getItemAt(0).text?.toString() ?: ""
                            }
                        },
                        onGenerateNotes = {
                            if (youtubeUrl.isBlank()) {
                                processingState = ProcessingState.Error("Please enter a YouTube URL")
                                return@YouTubeInputContent
                            }

                            if (!isValidYouTubeUrl(youtubeUrl)) {
                                processingState = ProcessingState.Error(
                                    "Please enter a valid YouTube URL.\n\n" +
                                    "Supported formats:\n" +
                                    "• youtube.com/watch?v=...\n" +
                                    "• youtu.be/...\n" +
                                    "• youtube.com/shorts/..."
                                )
                                return@YouTubeInputContent
                            }

                            val currentToken = authToken
                            if (currentToken == null || authManager.isTokenExpired(currentToken)) {
                                processingState = ProcessingState.Error("Session expired. Please log in again.")
                                coroutineScope.launch {
                                    authManager.clearAuth()
                                    delay(1000)
                                    onNavigateToLogin()
                                }
                                return@YouTubeInputContent
                            }

                            // Track analytics
                            AnalyticsService.trackYoutubeProcessed()

                            // Initialize processing
                            processingSteps = createYouTubeProcessingSteps(context)
                            currentStepIndex = 0
                            uploadComplete = false
                            processingState = ProcessingState.Processing(
                                steps = processingSteps,
                                currentIndex = 0,
                                uploadComplete = false
                            )

                            // Start processing
                            coroutineScope.launch {
                                // Step 1: Sending URL - set to in progress
                                processingSteps = updateStepInList(processingSteps, 0, StepStatus.IN_PROGRESS)
                                currentStepIndex = 0
                                processingState = ProcessingState.Processing(processingSteps, 0, false)

                                viewModel.processVideoUrl(
                                    token = currentToken,
                                    url = youtubeUrl,
                                    onSuccess = {
                                        coroutineScope.launch {
                                            // Complete step 1
                                            processingSteps = updateStepInList(processingSteps, 0, StepStatus.COMPLETED)
                                            uploadComplete = true
                                            processingState = ProcessingState.Processing(processingSteps, 0, true)

                                            // Animate through remaining steps
                                            for (i in 1 until processingSteps.size) {
                                                delay(800)
                                                processingSteps = updateStepInList(processingSteps, i, StepStatus.IN_PROGRESS)
                                                currentStepIndex = i
                                                processingState = ProcessingState.Processing(processingSteps, i, true)

                                                delay(600)
                                                processingSteps = updateStepInList(processingSteps, i, StepStatus.COMPLETED)
                                                processingState = ProcessingState.Processing(processingSteps, i, true)
                                            }

                                            // Show success
                                            delay(300)
                                            processingState = ProcessingState.Success()
                                            AnalyticsService.trackNoteCreated("youtube")
                                        }
                                    },
                                    onError = { error ->
                                        val errorMessage = when {
                                            error.contains("No transcript available") ||
                                            error.contains("captions") ||
                                            error.contains("subtitles") -> {
                                                "This video doesn't have captions/subtitles available.\n\nPlease try a different video with captions enabled."
                                            }
                                            error.contains("401") || error.contains("Unauthorized") -> {
                                                "Session expired.\n\nPlease log in again."
                                            }
                                            error.contains("private") || error.contains("unavailable") -> {
                                                "This video is private or unavailable.\n\nPlease check the URL and try again."
                                            }
                                            error.contains("timeout") || error.contains("timed out") -> {
                                                "Request timed out.\n\nThe video might be too long. Please try a shorter video."
                                            }
                                            else -> {
                                                "Failed to process video.\n\nPlease try again."
                                            }
                                        }
                                        processingState = ProcessingState.Error(errorMessage)
                                        AnalyticsService.trackProcessingError("youtube", error)
                                    }
                                )
                            }
                        }
                    )
                }

                is ProcessingState.Processing -> {
                    ProcessingStepsView(
                        steps = state.steps,
                        currentIndex = state.currentIndex,
                        uploadComplete = state.uploadComplete
                    )
                }

                is ProcessingState.Success -> {
                    ProcessingSuccessView(
                        onViewNote = {
                            onSuccess()
                        },
                        onGoHome = {
                            onSuccess()
                        }
                    )
                }

                is ProcessingState.Error -> {
                    ProcessingErrorView(
                        message = state.message,
                        onRetry = {
                            processingState = ProcessingState.Idle
                            processingSteps = createYouTubeProcessingSteps(context)
                            currentStepIndex = 0
                            uploadComplete = false
                        },
                        onGoBack = onNavigateBack
                    )
                }
            }
        }
    }

    // Info Dialog
    if (showTranscriptInfo) {
        AlertDialog(
            onDismissRequest = { showTranscriptInfo = false },
            title = { Text(stringResource(R.string.youtube_url)) },
            text = {
                Column {
                    Text(
                        "This feature extracts captions/subtitles from YouTube videos.",
                        fontSize = 14.sp,
                        color = TextSecondary
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Requirements:",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "• Video must have captions enabled\n• Auto-generated or manual subtitles\n• Works with most public videos",
                        fontSize = 13.sp,
                        color = TextSecondary,
                        lineHeight = 20.sp
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showTranscriptInfo = false }) {
                    Text(stringResource(R.string.close), color = Purple80)
                }
            },
            containerColor = CardBackground
        )
    }
}

@Composable
private fun YouTubeInputContent(
    youtubeUrl: String,
    onUrlChange: (String) -> Unit,
    onPasteFromClipboard: () -> Unit,
    onGenerateNotes: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        // YouTube Icon
        Box(
            modifier = Modifier
                .size(80.dp)
                .background(AccentRed.copy(alpha = 0.2f), RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.VideoLibrary,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = AccentRed
            )
        }

        Spacer(Modifier.height(24.dp))

        // Info Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = CardBackground
            ),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.Top
            ) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    stringResource(R.string.paste_youtube_url),
                    fontSize = 13.sp,
                    color = TextSecondary,
                    lineHeight = 18.sp
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        // URL Input Label
        Text(
            stringResource(R.string.youtube_url_placeholder),
            fontSize = 14.sp,
            color = TextSecondary
        )

        Spacer(Modifier.height(8.dp))

        // URL Input
        OutlinedTextField(
            value = youtubeUrl,
            onValueChange = onUrlChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = {
                Text(
                    stringResource(R.string.youtube_url_placeholder),
                    color = TextTertiary
                )
            },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Purple80,
                unfocusedBorderColor = DarkSurfaceVariant,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                cursorColor = Purple80
            ),
            shape = RoundedCornerShape(12.dp),
            singleLine = true
        )

        Spacer(Modifier.height(16.dp))

        // Paste Button
        OutlinedButton(
            onClick = onPasteFromClipboard,
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = Purple80
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Default.ContentPaste, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.paste_from_clipboard))
        }

        Spacer(Modifier.weight(1f))

        // Generate Notes Button
        Button(
            onClick = onGenerateNotes,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (youtubeUrl.isNotBlank() && isValidYouTubeUrl(youtubeUrl))
                    Purple80 else Purple80.copy(alpha = 0.5f)
            ),
            shape = RoundedCornerShape(12.dp),
            enabled = youtubeUrl.isNotBlank()
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(R.string.create_note),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(Modifier.height(32.dp))
    }
}

// Helper functions

private fun createYouTubeProcessingSteps(context: android.content.Context): List<ProcessingStep> {
    return YouTubeProcessingStep.entries.map { step ->
        ProcessingStep(title = context.getString(step.titleResId), status = StepStatus.PENDING)
    }
}

private fun updateStepInList(
    steps: List<ProcessingStep>,
    index: Int,
    status: StepStatus
): List<ProcessingStep> {
    return steps.mapIndexed { i, step ->
        if (i == index) step.copy(status = status) else step
    }
}

fun isValidYouTubeUrl(url: String): Boolean {
    val youtubePatterns = listOf(
        "youtube.com/watch",
        "youtu.be/",
        "youtube.com/embed/",
        "youtube.com/v/",
        "youtube.com/shorts/"
    )
    return youtubePatterns.any { url.contains(it, ignoreCase = true) }
}
