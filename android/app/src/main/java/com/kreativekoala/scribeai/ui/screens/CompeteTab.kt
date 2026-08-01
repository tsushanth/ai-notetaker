package com.kreativekoala.scribeai.ui.screens

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.data.models.Note

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CompeteTab(note: Note, authToken: String?) {
    if (authToken == null) return

    val url = "${BuildConfig.BASE_URL.trimEnd('/')}/compete-create/${note.id}?token=$authToken"

    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                setBackgroundColor(android.graphics.Color.parseColor("#0a0a0b"))
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
                loadUrl(url)
            }
        },
        modifier = Modifier.fillMaxSize()
    )
}
