package com.kreativekoala.scribeai.ui.screens

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.data.models.Note

private val BgColor = Color(0xFF0a0a0b)
private val PurpleColor = Color(0xFF9333ea)

/// Loads the server-rendered Create page (same one iOS uses). That page
/// already includes the prompt, suggestions, generate flow, and the user's
/// previous creations as a history list — so by pointing the WebView at it,
/// we get exact parity with iOS for free.
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CreateTab(
    note: Note,
    authToken: String?
) {
    if (authToken == null) return
    val context = LocalContext.current

    // Hold the WebView so the toolbar can drive it (back-navigation,
    // open-in-browser of the current URL).
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    val createUrl = "${BuildConfig.BASE_URL.trimEnd('/')}/create/${note.id}?token=$authToken"

    BackHandler(enabled = webViewRef?.canGoBack() == true) {
        webViewRef?.goBack()
    }

    Column(modifier = Modifier.fillMaxSize().background(BgColor)) {
        // Toolbar: only show Open-in-Browser; in-page back is handled by
        // the system back gesture (wired via BackHandler above).
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End
        ) {
            TextButton(onClick = {
                val current = webViewRef?.url ?: createUrl
                openUrlInBrowser(context, current)
            }) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text("Open in browser", color = PurpleColor, fontSize = 14.sp)
                    Text("↗", color = PurpleColor, fontSize = 14.sp)
                }
            }
        }

        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = false
                    setBackgroundColor(android.graphics.Color.parseColor("#0a0a0b"))
                    webViewClient = WebViewClient()
                    webChromeClient = WebChromeClient()
                    loadUrl(createUrl)
                    webViewRef = this
                }
            },
            update = { wv ->
                // If the noteId or token changes, reload.
                if (wv.url != createUrl && wv.url?.startsWith(BuildConfig.BASE_URL.trimEnd('/') + "/create/") != true) {
                    wv.loadUrl(createUrl)
                }
            }
        )
    }
}

/// Open the current Create page URL in the user's default browser.
/// Useful when the embedded WebView doesn't render some feature correctly.
private fun openUrlInBrowser(context: android.content.Context, url: String) {
    try {
        val intent = android.content.Intent(
            android.content.Intent.ACTION_VIEW,
            android.net.Uri.parse(url)
        ).apply {
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(android.content.Intent.createChooser(intent, "Open with"))
    } catch (e: Exception) {
        android.widget.Toast.makeText(
            context,
            "Couldn't open in browser: ${e.message ?: "unknown error"}",
            android.widget.Toast.LENGTH_LONG
        ).show()
    }
}
