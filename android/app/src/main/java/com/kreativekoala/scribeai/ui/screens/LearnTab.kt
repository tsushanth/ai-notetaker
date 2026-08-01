package com.kreativekoala.scribeai.ui.screens

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.LearnSessionManager

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LearnTab(
    note: Note,
    authToken: String?,
    @Suppress("UNUSED_PARAMETER") authManager: AuthManager
) {
    // Read state from the process-lifetime manager, so switching tabs while
    // a lesson is being prepared doesn't lose the in-flight request — when
    // the user comes back the session is still being created (or already is).
    val sessionState by LearnSessionManager.stateFor(note.id).collectAsState()

    when (val state = sessionState) {
        is LearnSessionManager.State.Ready -> {
            if (authToken == null) {
                // Auth lost between the start call and now — fall back to landing
                LearnLanding(note = note, authToken = authToken, state = state)
            } else {
                val learnUrl = "${BuildConfig.BASE_URL.trimEnd('/')}/learn/${state.sessionId}?token=$authToken"
                AndroidView(
                    factory = { ctx ->
                        WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.allowContentAccess = true
                            setBackgroundColor(android.graphics.Color.parseColor("#0a0a0b"))
                            webViewClient = WebViewClient()
                            webChromeClient = WebChromeClient()
                            loadUrl(learnUrl)
                        }
                    },
                    update = { wv ->
                        if (wv.url != learnUrl) wv.loadUrl(learnUrl)
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        else -> LearnLanding(note = note, authToken = authToken, state = state)
    }
}

@Composable
private fun LearnLanding(
    note: Note,
    authToken: String?,
    state: LearnSessionManager.State
) {
    val isStarting = state is LearnSessionManager.State.Starting
    val errorMessage = (state as? LearnSessionManager.State.Failed)?.message

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Icon(
                Icons.Default.School,
                contentDescription = null,
                tint = Purple80,
                modifier = Modifier.size(64.dp)
            )

            Text(
                "AI Tutor",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )

            Text(
                if (isStarting)
                    "Preparing your lesson… You can switch tabs and come back; we'll keep working in the background."
                else
                    "Your personal AI tutor will create interactive lessons, games, and quizzes tailored to your learning style and progress.",
                fontSize = 14.sp,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )

            errorMessage?.let {
                Text(
                    it,
                    fontSize = 13.sp,
                    color = Color(0xFFFF4444),
                    textAlign = TextAlign.Center
                )
            }

            Button(
                onClick = {
                    val token = authToken ?: return@Button
                    if (errorMessage != null) {
                        // Reset before retrying so the manager will dispatch a new request
                        LearnSessionManager.reset(note.id)
                    }
                    LearnSessionManager.startIfNeeded(note.id, token)
                },
                enabled = !isStarting && authToken != null,
                colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                if (isStarting) {
                    CircularProgressIndicator(
                        color = Color.White,
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Preparing lesson…", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                } else {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (errorMessage != null) "Try Again" else "Start Learning",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}
