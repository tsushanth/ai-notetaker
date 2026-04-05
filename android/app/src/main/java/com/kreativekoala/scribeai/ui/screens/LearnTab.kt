package com.kreativekoala.scribeai.ui.screens

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.data.models.Note
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LearnTab(
    note: Note,
    authToken: String?,
    authManager: AuthManager
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var sessionId by remember { mutableStateOf<String?>(null) }
    var isStarting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    if (sessionId != null && authToken != null) {
        // WebView showing the learn page
        val learnUrl = "${BuildConfig.BASE_URL}/learn/$sessionId?token=$authToken"

        AndroidView(
            factory = {
                WebView(it).apply {
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
            modifier = Modifier.fillMaxSize()
        )
    } else {
        // Landing state
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
                    "Your personal AI tutor will create interactive lessons, games, and quizzes tailored to your learning style and progress.",
                    fontSize = 14.sp,
                    color = TextSecondary,
                    textAlign = TextAlign.Center
                )

                if (error != null) {
                    Text(
                        error!!,
                        fontSize = 13.sp,
                        color = Color(0xFFFF4444),
                        textAlign = TextAlign.Center
                    )
                }

                Button(
                    onClick = {
                        if (authToken == null) {
                            error = "Please sign in to use the AI Tutor"
                            return@Button
                        }
                        isStarting = true
                        error = null
                        scope.launch {
                            try {
                                val result = withContext(Dispatchers.IO) {
                                    val client = OkHttpClient()
                                    val request = Request.Builder()
                                        .url("${BuildConfig.BASE_URL}/api/learn/${note.id}/start")
                                        .addHeader("Authorization", "Bearer $authToken")
                                        .post("{}".toRequestBody("application/json".toMediaType()))
                                        .build()
                                    val response = client.newCall(request).execute()
                                    val body = response.body?.string()
                                    JSONObject(body ?: "{}")
                                }
                                if (result.optBoolean("success")) {
                                    val session = result.optJSONObject("data")?.optJSONObject("session")
                                    sessionId = session?.optString("id")
                                    if (sessionId == null) error = "Failed to start session"
                                } else {
                                    error = result.optString("error", "Failed to start session")
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Connection error"
                            }
                            isStarting = false
                        }
                    },
                    enabled = !isStarting,
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
                    } else {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Start Learning", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
