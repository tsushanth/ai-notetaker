package com.kreativekoala.scribeai.tts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * Bottom sheet that synthesizes the supplied transcript using the on-device
 * engine and streams playback state back into the UI. Self-contained — owns
 * its own engine lifecycle for the duration of the sheet's lifetime.
 *
 * Phase A behaviour: system TextToSpeech. The engine's [TtsEngine.pause]/
 * [TtsEngine.resume] are best-effort; system TTS doesn't support true pause,
 * so the sheet treats Pause as Stop+restart-from-start when resumed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadAloudSheet(
    text: String,
    onDismiss: () -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    // Process-wide singleton. Reused across sheet open/close so the engine
    // (TextToSpeech instance + downloaded voices) stays warm.
    val manager = remember { ReadAloudManager.get(context.applicationContext) }
    val engine = manager.engine

    val state by engine.state.collectAsState()
    val voices by engine.voices.collectAsState()
    val preferredVoiceId by manager.preferredVoiceId.collectAsState(initial = null)

    var voiceMenuOpen by remember { mutableStateOf(false) }
    var selectedVoiceId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    LaunchedEffect(Unit) { engine.prepare() }
    LaunchedEffect(preferredVoiceId, voices) {
        if (selectedVoiceId == null) {
            selectedVoiceId = preferredVoiceId ?: defaultVoiceForDevice(voices)?.id
        }
    }

    val activeVoice = voices.firstOrNull { it.id == selectedVoiceId }
        ?: defaultVoiceForDevice(voices)
        ?: voices.firstOrNull()

    ModalBottomSheet(
        onDismissRequest = {
            engine.stop()
            onDismiss()
        },
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 8.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.VolumeUp, contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Text("Read Aloud", style = MaterialTheme.typography.titleLarge)
            }

            // Voice picker
            Box {
                OutlinedButton(
                    onClick = { voiceMenuOpen = true },
                    enabled = voices.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(activeVoice?.displayName ?: "Loading voices…")
                }
                DropdownMenu(
                    expanded = voiceMenuOpen,
                    onDismissRequest = { voiceMenuOpen = false },
                ) {
                    voices.forEach { voice ->
                        DropdownMenuItem(
                            text = { Text(voice.displayName) },
                            onClick = {
                                selectedVoiceId = voice.id
                                voiceMenuOpen = false
                                scope.launch { manager.setPreferredVoice(voice.id) }
                            },
                        )
                    }
                }
            }

            // State + progress
            Spacer(Modifier.height(4.dp))
            when (val s = state) {
                TtsState.Idle, TtsState.Ready -> {
                    Text(
                        if (voices.isEmpty()) "Preparing…"
                        else "Tap Read to start.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                TtsState.Preparing -> {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    Text("Preparing voice engine…", style = MaterialTheme.typography.bodySmall)
                }
                is TtsState.Speaking -> {
                    @Suppress("DEPRECATION")
                    LinearProgressIndicator(
                        progress = s.progressFraction,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text("Reading… ${(s.progressFraction * 100).toInt()}%",
                        style = MaterialTheme.typography.bodySmall)
                }
                TtsState.Paused -> {
                    Text("Paused — tap Resume to continue.",
                        style = MaterialTheme.typography.bodySmall)
                }
                is TtsState.Failed -> {
                    Text(s.message, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
            }

            // Primary control
            when (state) {
                is TtsState.Speaking -> {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        OutlinedButton(
                            onClick = { engine.stop() },
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Filled.Stop, contentDescription = null,
                                modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Stop")
                        }
                    }
                }
                else -> {
                    Button(
                        onClick = {
                            scope.launch {
                                engine.speak(text, voiceId = activeVoice?.id)
                            }
                        },
                        enabled = activeVoice != null && text.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = null,
                            modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Read")
                    }
                }
            }

            TextButton(
                onClick = {
                    engine.stop()
                    onDismiss()
                },
                modifier = Modifier.align(Alignment.End),
            ) {
                Text("Done")
            }

            Spacer(Modifier.padding(WindowInsetsBottom()))
        }
    }
}

@Composable
private fun WindowInsetsBottom() = PaddingValues(bottom = 8.dp)

/**
 * Pick a sensible default voice when the user hasn't chosen one yet.
 *
 * Priority:
 *  1. Voice whose locale matches device language + country exactly (e.g. en-US).
 *  2. Voice whose language matches the device language (any region — e.g. any en-*).
 *  3. Any English voice (sensible global fallback for an English-first app).
 *  4. null — caller falls back to `voices.firstOrNull()`.
 */
private fun defaultVoiceForDevice(voices: List<TtsVoice>): TtsVoice? {
    if (voices.isEmpty()) return null
    val device = Locale.getDefault()
    val deviceTag = device.toLanguageTag()
    val deviceLang = device.language

    voices.firstOrNull { it.locale.equals(deviceTag, ignoreCase = true) }?.let { return it }
    voices.firstOrNull { it.locale.startsWith("$deviceLang-", ignoreCase = true) ||
                          it.locale.equals(deviceLang, ignoreCase = true) }?.let { return it }
    voices.firstOrNull { it.locale.startsWith("en-", ignoreCase = true) ||
                          it.locale.equals("en", ignoreCase = true) }?.let { return it }
    return null
}
