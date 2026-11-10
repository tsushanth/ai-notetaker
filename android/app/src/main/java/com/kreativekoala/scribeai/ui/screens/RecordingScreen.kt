package com.kreativekoala.scribeai.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.recording.Failure
import com.kreativekoala.scribeai.recording.FailureKind
import com.kreativekoala.scribeai.recording.Interruption
import com.kreativekoala.scribeai.recording.Notice
import com.kreativekoala.scribeai.recording.PendingRecording
import com.kreativekoala.scribeai.recording.RecordingPhase
import com.kreativekoala.scribeai.recording.RecordingSession
import com.kreativekoala.scribeai.recording.RecordingUi
import com.kreativekoala.scribeai.recording.RecordingViewModel
import com.kreativekoala.scribeai.recording.SendPhase
import com.kreativekoala.scribeai.recording.UploadProgress
import com.kreativekoala.scribeai.ui.components.TurboRecordButton
import com.kreativekoala.scribeai.ui.components.TurboWaveform
import com.kreativekoala.scribeai.ui.components.turboLip
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.*

private val WarningAmber = Color(0xFFFFB74D)

// Screen states. The recording itself lives in RecordingService; these are derived from its state, the files on disk
// and the real sending progress (see RecordingViewModel), so rotation or leaving the screen loses nothing.
private sealed class RecordingScreenState {
    object Idle : RecordingScreenState()
    object Recording : RecordingScreenState()
    object Paused : RecordingScreenState()
    object ReviewingRecording : RecordingScreenState()
    data class Processing(val progress: UploadProgress?, val uploaded: Boolean) : RecordingScreenState()
    data class Success(val noteId: String) : RecordingScreenState()
    /** [recordingId] is set when the audio still exists (on the phone or the server) and [failure] says whether a retry can help. */
    data class Error(val failure: Failure?, val serverText: String?, val recordingId: String?) : RecordingScreenState()
}

private fun RecordingUi.toScreenState(): RecordingScreenState {
    if (session.isActive) return if (session.isPaused) RecordingScreenState.Paused else RecordingScreenState.Recording
    val p = progress
    val r = review
    return when {
        p?.phase == SendPhase.DONE -> RecordingScreenState.Success(p.noteId ?: "")
        p?.phase == SendPhase.FAILED -> RecordingScreenState.Error(p.failure, r?.failureMessage, r?.id)
        p != null && r != null -> RecordingScreenState.Processing(p, r.serverRecordingId != null)
        r?.phase == RecordingPhase.FAILED -> RecordingScreenState.Error(
            Failure(runCatching { FailureKind.valueOf(r.failureKind ?: "") }.getOrDefault(FailureKind.UNKNOWN)), r.failureMessage, r.id
        )
        r != null && r.phase == RecordingPhase.RECORDED -> RecordingScreenState.ReviewingRecording
        r != null -> RecordingScreenState.Processing(null, r.serverRecordingId != null) // sending was under way: progress arrives shortly
        else -> RecordingScreenState.Idle
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordingScreen(
    authManager: AuthManager,
    subscriptionManager: SubscriptionManager,
    onNavigateBack: () -> Unit,
    onNavigateToNote: (String) -> Unit = {},
    onSuccess: (noteId: String) -> Unit = {},
    viewModel: RecordingViewModel = viewModel()
) {
    val context = LocalContext.current
    val ui by viewModel.ui.collectAsState()
    val title by viewModel.title.collectAsState()
    val screenState = ui.toScreenState()

    // Permission handling
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        )
    }
    var permissionDenied by remember { mutableStateOf(false) }
    var askedNotifications by rememberSaveable { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
        if (!granted) permissionDenied = true
    }

    // Android 13+: the ongoing "Recording" notification is only shown with this permission. Recording works without
    // it, so whatever the user answers, recording starts.
    val notificationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
        viewModel.startRecording()
    }

    fun beginRecording() {
        val needsNotificationPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsNotificationPermission && !askedNotifications) {
            askedNotifications = true
            notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            viewModel.startRecording()
        }
    }

    // After two refusals Android stops showing the permission dialog and the launcher does nothing, so the button
    // would be dead. Send the user to the app's settings page instead.
    fun requestMicPermission() {
        val activity = context.findActivity()
        val blocked = permissionDenied && activity != null &&
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.RECORD_AUDIO)
        if (blocked) {
            try {
                context.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                Log.w("RecordingScreen", "Could not open app settings", e)
            }
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Request permission on launch if needed
    LaunchedEffect(Unit) {
        if (!hasPermission) permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Back while recording: the recording is running in the background service, so ask what to do with it.
    // Back from the review screen just leaves: the recording is stored and stays in the unsent list.
    val recordingActive = screenState is RecordingScreenState.Recording || screenState is RecordingScreenState.Paused
    var showLeaveDialog by remember { mutableStateOf(false) }
    BackHandler(enabled = recordingActive) { showLeaveDialog = true }
    BackHandler(enabled = screenState is RecordingScreenState.ReviewingRecording) {
        viewModel.leaveReview()
        onNavigateBack()
    }

    // The note counter, once per finished recording.
    LaunchedEffect(screenState) {
        val s = screenState
        if (s is RecordingScreenState.Success && s.noteId.isNotEmpty() && viewModel.markSuccessSeen(s.noteId)) {
            subscriptionManager.incrementLifetimeNotebooks()
        }
    }

    val snackbar = remember { SnackbarHostState() }
    val noticeText = ui.notice?.let { noticeText(it) }
    LaunchedEffect(ui.notice) {
        if (noticeText != null) {
            snackbar.showSnackbar(noticeText)
            viewModel.clearNotice()
        }
    }

    if (showLeaveDialog) {
        AlertDialog(
            onDismissRequest = { showLeaveDialog = false },
            title = { Text(stringResource(R.string.rec_leave_title)) },
            text = { Text(stringResource(R.string.rec_leave_text) + "\n\n" + clockText(ui.session.elapsedMs)) },
            confirmButton = {
                Row {
                    TextButton(onClick = {
                        showLeaveDialog = false
                        viewModel.stopAndDiscard()
                        onNavigateBack()
                    }) { Text(stringResource(R.string.discard), color = AccentRed) }
                    TextButton(onClick = {
                        showLeaveDialog = false
                        viewModel.stop()
                    }) { Text(stringResource(R.string.rec_stop_and_save)) }
                }
            },
            dismissButton = {
                TextButton(onClick = { showLeaveDialog = false }) { Text(stringResource(R.string.rec_keep_recording)) }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        stringResource(R.string.record_audio),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary
                    )
                },
                navigationIcon = {
                    IconButton(onClick = {
                        if (recordingActive) showLeaveDialog = true
                        else {
                            if (screenState is RecordingScreenState.ReviewingRecording) viewModel.leaveReview()
                            onNavigateBack()
                        }
                    }) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = stringResource(R.string.back),
                            tint = TextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkBackground)
            )
        },
        containerColor = DarkBackground
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (val state = screenState) {
                is RecordingScreenState.Idle -> {
                    IdleContent(
                        hasPermission = hasPermission,
                        pending = ui.pending,
                        onRequestPermission = { requestMicPermission() },
                        onStartRecording = { beginRecording() },
                        onSend = { viewModel.send(it) },
                        onOpen = { viewModel.review(it) },
                        onDiscardPending = { viewModel.discard(it) }
                    )
                }

                is RecordingScreenState.Recording,
                is RecordingScreenState.Paused -> {
                    RecordingContent(
                        isRecording = state is RecordingScreenState.Recording,
                        duration = ui.session.elapsedMs,
                        warning = sessionWarningText(ui.session),
                        onPause = { viewModel.pause() },
                        onResume = { viewModel.resume() },
                        onStop = { viewModel.stop() },
                        onDiscard = { viewModel.stopAndDiscard() }
                    )
                }

                is RecordingScreenState.ReviewingRecording -> {
                    val r = ui.review
                    ReviewContent(
                        duration = r?.durationMs ?: 0L,
                        silent = r?.allSilent == true,
                        title = title,
                        onTitleChange = { viewModel.title.value = it },
                        onProcess = { r?.let { viewModel.send(it.id) } },
                        onDiscard = { r?.let { viewModel.discard(it.id) } }
                    )
                }

                is RecordingScreenState.Processing -> {
                    RecordingProcessingContent(progress = state.progress, uploaded = state.uploaded)
                }

                is RecordingScreenState.Success -> {
                    SuccessContent(
                        noteId = state.noteId,
                        onViewNote = {
                            viewModel.finishSuccess()
                            onSuccess(state.noteId)
                            onNavigateToNote(state.noteId)
                        },
                        onGoHome = {
                            viewModel.finishSuccess()
                            onSuccess(state.noteId)
                            onNavigateBack()
                        }
                    )
                }

                is RecordingScreenState.Error -> {
                    val id = state.recordingId
                    val canRetry = id != null && (state.failure?.kind?.retryable == true || state.failure?.kind == FailureKind.DAILY_LIMIT)
                    ErrorContent(
                        message = failureText(state.failure, state.serverText),
                        primaryLabel = stringResource(if (canRetry) R.string.try_again_button else R.string.rec_record_again),
                        onPrimary = {
                            if (id == null) return@ErrorContent
                            if (canRetry) viewModel.retry(id) else viewModel.discard(id)
                        },
                        onGoBack = onNavigateBack
                    )
                }
            }
        }
    }
}

@Composable
private fun noticeText(n: Notice): String = stringResource(
    when (n) {
        Notice.TOO_SHORT -> R.string.rec_too_short_notice
        Notice.NO_PERMISSION -> R.string.rec_err_permission
        Notice.LOW_STORAGE -> R.string.rec_err_low_storage
        Notice.NOT_ALLOWED -> R.string.rec_err_not_allowed
        Notice.RECORDER_FAILED -> R.string.rec_err_recorder
    }
)

/** The most important thing to tell the user about the recording that is running, or null. */
@Composable
private fun sessionWarningText(s: RecordingSession.Snapshot): String? = when {
    s.interruption == Interruption.FOCUS_TRANSIENT && s.isPaused -> stringResource(R.string.rec_paused_transient)
    s.interruption == Interruption.FOCUS_LOST && s.isPaused -> stringResource(R.string.rec_paused_audio_taken)
    RecordingSession.Warning.MIC_SILENCED in s.warnings -> stringResource(R.string.rec_warn_mic_silenced_long)
    RecordingSession.Warning.NO_SOUND in s.warnings -> stringResource(R.string.rec_warn_no_sound_long)
    RecordingSession.Warning.LOW_STORAGE in s.warnings -> stringResource(R.string.rec_warn_low_storage_long)
    RecordingSession.Warning.LOW_BATTERY in s.warnings -> stringResource(R.string.rec_warn_low_battery_long)
    RecordingSession.Warning.LOW_SOUND in s.warnings -> stringResource(R.string.rec_warn_low_sound_long)
    else -> null
}

/** Plain-language reason for a failure. The server's own sentence is used only where it is already user-facing. */
@Composable
private fun failureText(f: Failure?, serverText: String?): String = when (f?.kind) {
    FailureKind.SILENT -> stringResource(R.string.rec_fail_silent)
    FailureKind.NO_SPEECH -> stringResource(R.string.rec_fail_no_speech)
    FailureKind.LANGUAGE -> stringResource(R.string.rec_fail_language)
    FailureKind.TOO_SHORT -> stringResource(R.string.rec_fail_too_short)
    FailureKind.TOO_LARGE -> stringResource(R.string.rec_fail_too_large)
    FailureKind.DAILY_LIMIT -> (f.serverText ?: serverText)?.takeIf { it.isNotBlank() } ?: stringResource(R.string.rec_fail_daily_limit)
    FailureKind.SERVICE -> stringResource(R.string.rec_fail_service)
    FailureKind.NETWORK -> stringResource(R.string.rec_fail_network)
    FailureKind.AUTH -> stringResource(R.string.rec_fail_auth)
    FailureKind.UNKNOWN, null -> (f?.serverText ?: serverText)?.takeIf { it.isNotBlank() } ?: stringResource(R.string.rec_fail_unknown)
}


private fun clockText(millis: Long): String {
    val total = millis / 1000
    return "%02d:%02d:%02d".format(total / 3600, (total % 3600) / 60, total % 60)
}

@Composable
private fun IdleContent(
    hasPermission: Boolean,
    pending: List<PendingRecording>,
    onRequestPermission: () -> Unit,
    onStartRecording: () -> Unit,
    onSend: (String) -> Unit,
    onOpen: (String) -> Unit,
    onDiscardPending: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))
        Text(
            clockText(0),
            fontSize = 56.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )
        Spacer(Modifier.height(24.dp))
        TurboWaveform(active = false)
        Spacer(Modifier.height(24.dp))

        if (pending.isNotEmpty()) {
            PendingList(pending, onSend, onOpen, onDiscardPending)
            Spacer(Modifier.height(24.dp))
        }

        if (!hasPermission) {
            Text(
                stringResource(R.string.record_audio_subtitle),
                fontSize = 15.sp,
                color = TextSecondary,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(20.dp))
            Box(modifier = Modifier.fillMaxWidth().padding(bottom = 3.dp)) {
                Button(
                    onClick = onRequestPermission,
                    colors = ButtonDefaults.buttonColors(containerColor = Purple80, contentColor = Color.White),
                    shape = CircleShape,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .turboLip(CircleShape, Purple40)
                ) {
                    Icon(Icons.Default.Mic, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.grant_microphone_permission), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            TurboRecordButton(
                icon = Icons.Default.Mic,
                contentDescription = stringResource(R.string.start_recording),
                onClick = onStartRecording
            )
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.tap_to_start_recording),
                fontSize = 14.sp,
                color = TextSecondary
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** Recordings that were not sent yet: recovered after the app was closed, failed, or still sending. */
@Composable
private fun PendingList(
    pending: List<PendingRecording>,
    onSend: (String) -> Unit,
    onOpen: (String) -> Unit,
    onDiscard: (String) -> Unit
) {
    val dateFormat = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT) }
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = CardBackground),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(stringResource(R.string.rec_unsent_title), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
            pending.take(3).forEach { p ->
                Spacer(Modifier.height(12.dp))
                val inFlight = p.phase == RecordingPhase.UPLOADING || p.phase == RecordingPhase.UPLOADED ||
                    p.phase == RecordingPhase.TRANSCRIBING || p.phase == RecordingPhase.WAITING
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            formatDuration(p.durationMs) + "  ·  " + dateFormat.format(Date(p.createdAtMs)),
                            fontSize = 14.sp,
                            color = TextPrimary
                        )
                        val sub = when {
                            p.phase == RecordingPhase.FAILED -> failureText(
                                Failure(runCatching { FailureKind.valueOf(p.failureKind ?: "") }.getOrDefault(FailureKind.UNKNOWN)), p.failureMessage
                            )
                            p.stopReason == "process_death" -> stringResource(R.string.rec_unsent_recovered)
                            inFlight -> stringResource(R.string.rec_sending)
                            else -> null
                        }
                        if (sub != null) Text(sub, fontSize = 12.sp, color = TextSecondary, lineHeight = 16.sp)
                    }
                    when {
                        inFlight || p.phase == RecordingPhase.FAILED -> TextButton(onClick = { onOpen(p.id) }) { Text(stringResource(R.string.rec_open)) }
                        else -> TextButton(onClick = { onSend(p.id) }) { Text(stringResource(R.string.rec_send)) }
                    }
                    TextButton(onClick = { onDiscard(p.id) }) { Text(stringResource(R.string.discard), color = AccentRed) }
                }
            }
        }
    }
}


@Composable
private fun RecordingContent(
    isRecording: Boolean,
    duration: Long,
    warning: String?,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    onDiscard: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.weight(1f))
        Text(
            clockText(duration),
            fontSize = 56.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )
        Spacer(Modifier.height(8.dp))
        Text(
            if (isRecording) stringResource(R.string.recording_status) else stringResource(R.string.paused),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = if (isRecording) AccentRed else TextSecondary
        )
        Spacer(Modifier.height(24.dp))
        TurboWaveform(active = isRecording)
        if (warning != null) {
            Spacer(Modifier.height(16.dp))
            Text(warning, fontSize = 14.sp, color = WarningAmber, textAlign = TextAlign.Center, lineHeight = 20.sp)
        }
        Spacer(Modifier.weight(1f))

        // Control buttons
        Row(
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Discard button
            Box(modifier = Modifier.padding(bottom = 3.dp)) {
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .turboLip(CircleShape)
                        .clip(CircleShape)
                        .background(DarkSurfaceVariant)
                        .clickable(onClick = onDiscard),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = stringResource(R.string.discard),
                        tint = TextSecondary
                    )
                }
            }

            // Pause/Resume button
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Box(modifier = Modifier.padding(bottom = 3.dp)) {
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .turboLip(CircleShape, Purple40)
                            .clip(CircleShape)
                            .background(Purple80)
                            .clickable { if (isRecording) onPause() else onResume() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            if (isRecording) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (isRecording) stringResource(R.string.pause) else stringResource(R.string.resume),
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }
            }

            // Stop button
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(AccentRed)
                    .clickable(onClick = onStop),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Stop,
                    contentDescription = stringResource(R.string.stop),
                    tint = Color.White,
                    modifier = Modifier.size(28.dp)
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun ReviewContent(
    duration: Long,
    silent: Boolean,
    title: String,
    onTitleChange: (String) -> Unit,
    onProcess: () -> Unit,
    onDiscard: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        Icon(
            Icons.Default.AudioFile,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = Purple80
        )

        Spacer(Modifier.height(16.dp))

        Text(
            stringResource(R.string.recording_complete),
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            stringResource(R.string.duration_format, formatDuration(duration)),
            fontSize = 16.sp,
            color = TextSecondary
        )

        if (silent) {
            // Nothing was heard for the whole recording: sending it would only cost a server call.
            Spacer(Modifier.height(16.dp))
            Text(
                stringResource(R.string.rec_silent_review),
                fontSize = 14.sp,
                color = WarningAmber,
                textAlign = TextAlign.Center,
                lineHeight = 20.sp
            )
        }

        Spacer(Modifier.height(32.dp))

        // Title input
        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            label = { Text(stringResource(R.string.title_optional)) },
            placeholder = { Text(stringResource(R.string.title_placeholder)) },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Purple80,
                unfocusedBorderColor = DarkSurfaceVariant,
                focusedLabelColor = Purple80,
                cursorColor = Purple80,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary
            ),
            shape = RoundedCornerShape(12.dp),
            singleLine = true
        )

        Spacer(Modifier.weight(1f))

        // Process button
        Button(
            onClick = onProcess,
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Icon(Icons.Default.AutoAwesome, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(if (silent) R.string.rec_send_anyway else R.string.process_recording),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(Modifier.height(12.dp))

        TextButton(onClick = onDiscard) {
            Text(stringResource(if (silent) R.string.rec_record_again else R.string.discard_recording), color = TextSecondary)
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun RecordingProcessingContent(progress: UploadProgress?, uploaded: Boolean) {
    val phase = progress?.phase ?: SendPhase.QUEUED
    val uploadDone = uploaded || phase == SendPhase.TRANSCRIBING || phase == SendPhase.DONE
    val waiting = phase == SendPhase.WAITING_RETRY

    // Seconds until the next automatic retry, counted down on screen.
    var secondsLeft by remember(progress?.retryAtMs) { mutableStateOf(secondsUntil(progress?.retryAtMs)) }
    LaunchedEffect(progress?.retryAtMs) {
        while (progress?.retryAtMs != null) {
            secondsLeft = secondsUntil(progress.retryAtMs)
            delay(1000)
        }
    }

    val uploadTitle = when {
        uploadDone -> stringResource(R.string.step_uploading_audio)
        phase == SendPhase.UPLOADING -> stringResource(R.string.rec_uploading_percent, progress?.percent ?: 0)
        phase == SendPhase.QUEUED -> stringResource(R.string.rec_queued)
        else -> stringResource(R.string.step_uploading_audio)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
    ) {
        Spacer(Modifier.height(16.dp))

        // Two steps, both real: the upload is measured in bytes sent, the transcription ends when the server says so.
        ProcessingStepItem(
            title = uploadTitle,
            isCompleted = uploadDone,
            isCurrent = !uploadDone,
            isLast = false
        )
        if (phase == SendPhase.UPLOADING && !uploadDone) {
            LinearProgressIndicator(
                progress = { (progress?.percent ?: 0) / 100f },
                modifier = Modifier.fillMaxWidth().padding(start = 48.dp, bottom = 8.dp),
                color = Purple80
            )
        }
        ProcessingStepItem(
            title = stringResource(R.string.step_transcribing_audio),
            isCompleted = false,
            isCurrent = uploadDone,
            isLast = true
        )

        Spacer(Modifier.height(32.dp))

        val statusText = when {
            waiting && progress?.retryAtMs != null && secondsLeft > 0 -> stringResource(R.string.rec_retry_in, secondsLeft)
            waiting -> stringResource(R.string.rec_waiting_network)
            uploadDone -> stringResource(R.string.rec_transcribing_hint)
            else -> stringResource(R.string.processing_info)
        }
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = CardBackground),
            shape = RoundedCornerShape(16.dp)
        ) {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    if (waiting) Icons.Default.CloudOff else Icons.Default.Info,
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(Modifier.width(12.dp))
                Text(statusText, fontSize = 14.sp, color = TextSecondary, lineHeight = 20.sp)
            }
        }

        if (uploadDone) {
            Spacer(Modifier.height(16.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = CardBackground),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CloudDone, contentDescription = null, tint = Color(0xFF4CAF50), modifier = Modifier.size(24.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.upload_complete_safe), fontSize = 14.sp, color = TextSecondary)
                }
            }
        }
    }
}

private fun secondsUntil(timeMs: Long?): Int =
    if (timeMs == null) 0 else ((timeMs - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)


@Composable
private fun ProcessingStepItem(
    title: String,
    isCompleted: Boolean,
    isCurrent: Boolean,
    isLast: Boolean
) {
    val iconColor = when {
        isCompleted -> Purple80
        isCurrent -> Purple80.copy(alpha = 0.5f)
        else -> DarkSurfaceVariant
    }

    val textColor = when {
        isCompleted -> TextPrimary
        isCurrent -> TextPrimary
        else -> TextTertiary
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top
    ) {
        // Step indicator column
        Column(
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Circle indicator
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(if (isCompleted) Purple80 else Color.Transparent)
                    .then(
                        if (!isCompleted) Modifier.border(2.dp, iconColor, CircleShape)
                        else Modifier
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (isCompleted) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                } else if (isCurrent) {
                    // Loading indicator
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Purple80,
                        strokeWidth = 2.dp
                    )
                }
            }

            // Connecting line
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(32.dp)
                        .background(if (isCompleted) Purple80 else DarkSurfaceVariant)
                )
            }
        }

        Spacer(Modifier.width(16.dp))

        // Step title
        Text(
            text = title,
            fontSize = 16.sp,
            fontWeight = if (isCurrent) FontWeight.Medium else FontWeight.Normal,
            color = textColor,
            modifier = Modifier.padding(top = 4.dp)
        )
    }
}

@Composable
private fun SuccessContent(
    noteId: String,
    onViewNote: () -> Unit,
    onGoHome: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Success animation
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .background(Color(0xFF4CAF50).copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = Color(0xFF4CAF50)
            )
        }

        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(R.string.note_ready),
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            stringResource(R.string.note_ready_description),
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(48.dp))

        Button(
            onClick = onViewNote,
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Icon(Icons.Default.Visibility, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.view_note), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.height(12.dp))

        TextButton(onClick = onGoHome) {
            Text(stringResource(R.string.go_to_home), color = TextSecondary)
        }
    }
}

@Composable
private fun ErrorContent(
    message: String,
    primaryLabel: String,
    onPrimary: () -> Unit,
    onGoBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Error,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = AccentRed
        )

        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(R.string.something_went_wrong),
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            message,
            fontSize = 14.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(48.dp))

        Button(
            onClick = onPrimary,
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(primaryLabel, fontSize = 16.sp)
        }

        Spacer(Modifier.height(12.dp))

        TextButton(onClick = onGoBack) {
            Text(stringResource(R.string.go_back), color = TextSecondary)
        }
    }
}


// Helper functions
private fun formatDuration(millis: Long): String {
    val seconds = (millis / 1000) % 60
    val minutes = (millis / (1000 * 60)) % 60
    val hours = millis / (1000 * 60 * 60)

    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, seconds)
    } else {
        String.format("%02d:%02d", minutes, seconds)
    }
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}
