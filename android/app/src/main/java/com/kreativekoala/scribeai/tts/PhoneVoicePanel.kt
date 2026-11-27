package com.kreativekoala.scribeai.tts

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.theme.AccentRed
import com.kreativekoala.scribeai.ui.theme.Purple80
import com.kreativekoala.scribeai.ui.theme.TextSecondary
import com.kreativekoala.scribeai.utils.AnalyticsService
import kotlinx.coroutines.launch

/** Whether the phone has a working internet connection, kept up to date while on screen. */
@Composable
fun rememberIsOnline(): Boolean {
    val context = LocalContext.current.applicationContext
    val connectivity = remember { context.getSystemService(ConnectivityManager::class.java) }
    fun usable(c: NetworkCapabilities?) = c != null &&
        c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    var online by remember {
        mutableStateOf(runCatching { usable(connectivity.getNetworkCapabilities(connectivity.activeNetwork)) }.getOrDefault(true))
    }
    DisposableEffect(connectivity) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                online = usable(capabilities)
            }

            override fun onLost(network: Network) {
                online = false
            }
        }
        val registered = runCatching { connectivity.registerDefaultNetworkCallback(callback) }.isSuccess
        onDispose { if (registered) runCatching { connectivity.unregisterNetworkCallback(callback) } }
    }
    return online
}

/**
 * Read Aloud with the phone's own voice. [problem] is held by the caller so it survives closing the section; when
 * it is set and the phone is online, [serverFallback] offers the server voice as before.
 */
@Composable
fun PhoneVoicePanel(
    text: String,
    noteLanguage: String?,
    reason: PhoneVoiceReason,
    online: Boolean,
    problem: PhoneVoiceStart?,
    onProblem: (PhoneVoiceStart?) -> Unit,
    onStartReading: () -> Unit,
    serverFallback: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val engine = remember { ReadAloudManager.get(context.applicationContext).engine }
    val state by engine.state.collectAsState()
    val scope = rememberCoroutineScope()
    var waitingForSound by remember { mutableStateOf(false) }
    var playbackFailed by remember { mutableStateOf(false) }
    val language = PhoneVoice.localeFor(noteLanguage).language

    fun report(ok: Boolean, code: String) = AnalyticsService.trackEvent(
        "read_aloud_phone",
        mapOf("ok" to ok, "code" to code, "reason" to reason.analyticsName, "language" to language),
    )

    LaunchedEffect(state) {
        if (!waitingForSound) return@LaunchedEffect
        when (state) {
            is TtsState.Speaking -> { waitingForSound = false; report(true, "started") }
            is TtsState.Failed -> { waitingForSound = false; playbackFailed = true; report(false, "engine_error") }
            else -> Unit
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            stringResource(
                if (reason == PhoneVoiceReason.OFFLINE) R.string.readaloud_phone_offline
                else R.string.readaloud_phone_non_english
            ),
            fontSize = 12.sp,
            color = TextSecondary,
        )

        val speaking = state as? TtsState.Speaking
        if (speaking != null) {
            LinearProgressIndicator(progress = { speaking.progressFraction }, modifier = Modifier.fillMaxWidth(), color = Purple80)
            Text(
                stringResource(R.string.readaloud_reading_progress, (speaking.progressFraction * 100).toInt()),
                fontSize = 11.sp,
                color = TextSecondary,
            )
        }

        if (problem != null || playbackFailed) {
            Text(
                stringResource(
                    if (problem == PhoneVoiceStart.NO_VOICE) R.string.readaloud_phone_no_voice
                    else R.string.readaloud_phone_failed
                ),
                fontSize = 12.sp,
                color = AccentRed,
            )
        }

        Button(
            onClick = {
                if (speaking != null) {
                    engine.stop()
                } else {
                    onStartReading()
                    onProblem(null)
                    playbackFailed = false
                    // Clears an earlier failure, so the same failure again is still noticed.
                    engine.stop()
                    waitingForSound = true
                    scope.launch {
                        val started = engine.speakIn(PhoneVoice.plainText(text), PhoneVoice.localeFor(noteLanguage), online)
                        if (started != PhoneVoiceStart.STARTED) {
                            waitingForSound = false
                            onProblem(started)
                            report(false, started.name.lowercase())
                        }
                    }
                }
            },
            enabled = text.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(40.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(20.dp),
        ) {
            Icon(
                if (speaking != null) Icons.Default.Stop else Icons.Default.PlayArrow,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(if (speaking != null) R.string.stop else R.string.ui_read), fontSize = 13.sp)
        }

        if ((problem != null || playbackFailed) && online) serverFallback()
    }
}
