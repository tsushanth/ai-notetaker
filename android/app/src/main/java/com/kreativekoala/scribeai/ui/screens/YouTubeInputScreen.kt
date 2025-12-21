package com.kreativekoala.scribeai.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
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
    var isProcessing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var showTranscriptInfo by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    val authToken by authManager.authToken.collectAsState()

    // Check auth with delay
    LaunchedEffect(authToken) {
        kotlinx.coroutines.delay(500)
        if (authToken == null) {
            errorMessage = "Please log in to continue"
            kotlinx.coroutines.delay(1500)
            onNavigateToLogin()
        }
    }

    // Show loading while auth initializes
    if (authToken == null) {
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
            TopAppBar(
                title = { Text("YouTube Transcripts") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showTranscriptInfo = true }) {
                        Icon(Icons.Default.Info, contentDescription = "Info", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkBackground,
                    titleContentColor = TextPrimary
                )
            )
        },
        containerColor = DarkBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
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
                        "Only videos with captions/subtitles are supported",
                        fontSize = 13.sp,
                        color = TextSecondary,
                        lineHeight = 18.sp
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            // Open YouTube Button
            OutlinedButton(
                onClick = {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://youtube.com"))
                    context.startActivity(intent)
                },
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = Purple80
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.OpenInNew, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Open YouTube")
            }

            Spacer(Modifier.height(24.dp))

            // URL Input
            OutlinedTextField(
                value = youtubeUrl,
                onValueChange = {
                    youtubeUrl = it
                    errorMessage = null
                },
                modifier = Modifier.fillMaxWidth(),
                placeholder = {
                    Text(
                        "Paste YouTube link here",
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
                isError = errorMessage != null,
                singleLine = true
            )

            if (errorMessage != null) {
                Spacer(Modifier.height(8.dp))
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = AccentRed.copy(alpha = 0.1f)
                    ),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            tint = AccentRed,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            errorMessage!!,
                            color = AccentRed,
                            fontSize = 12.sp
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Paste Button
            OutlinedButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val clipData = clipboard.primaryClip
                    if (clipData != null && clipData.itemCount > 0) {
                        youtubeUrl = clipData.getItemAt(0).text?.toString() ?: ""
                    }
                },
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = Purple80
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.ContentPaste, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Paste From Clipboard")
            }

            Spacer(Modifier.weight(1f))

            // Process Button
            Button(
                onClick = {
                    if (youtubeUrl.isBlank()) {
                        errorMessage = "Please enter a YouTube URL"
                        return@Button
                    }

                    if (!isValidYouTubeUrl(youtubeUrl)) {
                        errorMessage = "Please enter a valid YouTube URL"
                        return@Button
                    }

                    val currentToken = authToken
                    if (currentToken == null || authManager.isTokenExpired(currentToken)) {
                        errorMessage = "Session expired. Please log in again."
                        coroutineScope.launch {
                            authManager.clearAuth()
                            kotlinx.coroutines.delay(1000)
                            onNavigateToLogin()
                        }
                        return@Button
                    }

                    isProcessing = true
                    errorMessage = null

                    viewModel.processVideoUrl(
                        token = currentToken,
                        url = youtubeUrl,
                        onSuccess = {
                            isProcessing = false
                            onSuccess()
                        },
                        onError = { error ->
                            isProcessing = false

                            // Handle specific errors
                            when {
                                error.contains("No transcript available") ||
                                        error.contains("captions") ||
                                        error.contains("subtitles") -> {
                                    errorMessage = "This video doesn't have captions/subtitles. Please try another video."
                                }
                                error.contains("401") || error.contains("Unauthorized") -> {
                                    errorMessage = "Session expired. Please log in again."
                                    coroutineScope.launch {
                                        authManager.clearAuth()
                                        kotlinx.coroutines.delay(1000)
                                        onNavigateToLogin()
                                    }
                                }
                                else -> {
                                    errorMessage = "Failed to process video. Please try again."
                                }
                            }
                        }
                    )
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Purple80
                ),
                shape = RoundedCornerShape(12.dp),
                enabled = !isProcessing
            ) {
                if (isProcessing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = Color.White,
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.width(12.dp))
                    Text("Processing...")
                } else {
                    Icon(Icons.Default.Send, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Generate Notes",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }

    // Info Dialog
    if (showTranscriptInfo) {
        AlertDialog(
            onDismissRequest = { showTranscriptInfo = false },
            title = { Text("About YouTube Transcripts") },
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
                    Text("Got it", color = Purple80)
                }
            },
            containerColor = CardBackground
        )
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