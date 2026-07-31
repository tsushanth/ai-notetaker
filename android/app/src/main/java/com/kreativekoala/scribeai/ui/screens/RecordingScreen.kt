package com.kreativekoala.scribeai.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

// Processing steps for recording
enum class RecordingStep(val titleResId: Int, val index: Int) {
    UPLOADING_AUDIO(R.string.step_uploading_audio, 0),
    TRANSCRIBING_AUDIO(R.string.step_transcribing_audio, 1),
    IDENTIFYING_SPEAKERS(R.string.step_identifying_speakers, 2),
    ANALYZING_CONTENT(R.string.step_analyzing_content, 3),
    SUMMARIZING_KEY_POINTS(R.string.step_summarizing_key_points, 4),
    FINALIZING_NOTE(R.string.step_finalizing_note, 5)
}

// Screen states
sealed class RecordingScreenState {
    object Idle : RecordingScreenState()
    object Recording : RecordingScreenState()
    object Paused : RecordingScreenState()
    object ReviewingRecording : RecordingScreenState()
    data class Processing(
        val currentStep: RecordingStep,
        val completedSteps: Set<RecordingStep> = emptySet(),
        val uploadComplete: Boolean = false
    ) : RecordingScreenState()
    data class Success(val noteId: String) : RecordingScreenState()
    data class Error(val message: String) : RecordingScreenState()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordingScreen(
    authManager: AuthManager,
    subscriptionManager: SubscriptionManager,
    onNavigateBack: () -> Unit,
    onNavigateToNote: (String) -> Unit = {},
    onSuccess: (noteId: String) -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var screenState by remember { mutableStateOf<RecordingScreenState>(RecordingScreenState.Idle) }
    var recordingDuration by remember { mutableLongStateOf(0L) }
    var audioFile by remember { mutableStateOf<File?>(null) }
    var mediaRecorder by remember { mutableStateOf<MediaRecorder?>(null) }
    var recordingTitle by remember { mutableStateOf("") }

    // Permission handling
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasPermission = granted
    }

    // Timer for recording duration
    LaunchedEffect(screenState) {
        if (screenState == RecordingScreenState.Recording) {
            while (screenState == RecordingScreenState.Recording) {
                delay(1000)
                recordingDuration += 1000
            }
        }
    }

    // Request permission on launch if needed
    LaunchedEffect(Unit) {
        if (!hasPermission) {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Cleanup on dispose
    DisposableEffect(Unit) {
        onDispose {
            mediaRecorder?.release()
            mediaRecorder = null
        }
    }

    fun startRecording() {
        try {
            val fileName = "recording_${System.currentTimeMillis()}.m4a"
            val file = File(context.cacheDir, fileName)
            audioFile = file

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128000)
                setAudioSamplingRate(44100)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }

            recordingDuration = 0L
            screenState = RecordingScreenState.Recording
            Log.d("RecordingScreen", "Recording started: ${file.absolutePath}")
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Failed to start recording", e)
            screenState = RecordingScreenState.Error(context.getString(R.string.error_start_recording, e.message))
        }
    }

    fun pauseRecording() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                mediaRecorder?.pause()
                screenState = RecordingScreenState.Paused
            }
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Failed to pause recording", e)
        }
    }

    fun resumeRecording() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                mediaRecorder?.resume()
                screenState = RecordingScreenState.Recording
            }
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Failed to resume recording", e)
        }
    }

    fun stopRecording() {
        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            screenState = RecordingScreenState.ReviewingRecording
            Log.d("RecordingScreen", "Recording stopped. File size: ${audioFile?.length() ?: 0}")
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Failed to stop recording", e)
            screenState = RecordingScreenState.Error(context.getString(R.string.error_stop_recording, e.message))
        }
    }

    fun discardRecording() {
        audioFile?.delete()
        audioFile = null
        recordingDuration = 0L
        recordingTitle = ""
        screenState = RecordingScreenState.Idle
    }

    fun processRecording() {
        val file = audioFile ?: return
        val token = authManager.getCurrentToken() ?: run {
            screenState = RecordingScreenState.Error(context.getString(R.string.error_not_authenticated))
            return
        }

        scope.launch {
            try {
                // Start processing UI
                screenState = RecordingScreenState.Processing(
                    currentStep = RecordingStep.UPLOADING_AUDIO
                )

                // Step 1: Upload audio
                val recordingId = uploadAudio(file, token, recordingTitle)

                if (recordingId == null) {
                    screenState = RecordingScreenState.Error(context.getString(R.string.error_upload_failed))
                    return@launch
                }

                // Update to show upload complete
                screenState = RecordingScreenState.Processing(
                    currentStep = RecordingStep.TRANSCRIBING_AUDIO,
                    completedSteps = setOf(RecordingStep.UPLOADING_AUDIO),
                    uploadComplete = true
                )

                // Step 2: Start transcription
                val result = startTranscription(recordingId, token)

                if (result == null) {
                    screenState = RecordingScreenState.Error(context.getString(R.string.error_transcribe_failed))
                    return@launch
                }

                // Animate through remaining steps
                val steps = listOf(
                    RecordingStep.TRANSCRIBING_AUDIO,
                    RecordingStep.IDENTIFYING_SPEAKERS,
                    RecordingStep.ANALYZING_CONTENT,
                    RecordingStep.SUMMARIZING_KEY_POINTS,
                    RecordingStep.FINALIZING_NOTE
                )

                val completedSteps = mutableSetOf(RecordingStep.UPLOADING_AUDIO)

                for (step in steps) {
                    screenState = RecordingScreenState.Processing(
                        currentStep = step,
                        completedSteps = completedSteps.toSet(),
                        uploadComplete = true
                    )
                    delay(800) // Brief delay to show progress
                    completedSteps.add(step)
                }

                // Success!
                val noteId = result.optString("note_id", "")

                // Increment lifetime notebooks counter
                subscriptionManager.incrementLifetimeNotebooks()

                screenState = RecordingScreenState.Success(noteId)

                // Cleanup
                file.delete()

            } catch (e: Exception) {
                Log.e("RecordingScreen", "Processing failed", e)
                screenState = RecordingScreenState.Error(e.message ?: context.getString(R.string.error_processing_failed))
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { },
                navigationIcon = {
                    IconButton(onClick = {
                        when (screenState) {
                            is RecordingScreenState.Recording,
                            is RecordingScreenState.Paused -> {
                                // Stop and discard if recording
                                mediaRecorder?.release()
                                mediaRecorder = null
                                audioFile?.delete()
                            }
                            else -> { }
                        }
                        onNavigateBack()
                    }) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = stringResource(R.string.back),
                            tint = TextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkBackground
                )
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
                        onRequestPermission = { permissionLauncher.launch(Manifest.permission.RECORD_AUDIO) },
                        onStartRecording = { startRecording() }
                    )
                }

                is RecordingScreenState.Recording,
                is RecordingScreenState.Paused -> {
                    RecordingContent(
                        isRecording = state == RecordingScreenState.Recording,
                        duration = recordingDuration,
                        onPause = { pauseRecording() },
                        onResume = { resumeRecording() },
                        onStop = { stopRecording() },
                        onDiscard = { discardRecording() }
                    )
                }

                is RecordingScreenState.ReviewingRecording -> {
                    ReviewContent(
                        duration = recordingDuration,
                        title = recordingTitle,
                        onTitleChange = { recordingTitle = it },
                        onProcess = { processRecording() },
                        onDiscard = { discardRecording() }
                    )
                }

                is RecordingScreenState.Processing -> {
                    RecordingProcessingContent(
                        currentStep = state.currentStep,
                        completedSteps = state.completedSteps,
                        uploadComplete = state.uploadComplete
                    )
                }

                is RecordingScreenState.Success -> {
                    SuccessContent(
                        noteId = state.noteId,
                        onViewNote = {
                            onSuccess(state.noteId)
                            onNavigateToNote(state.noteId)
                        },
                        onGoHome = {
                            onSuccess(state.noteId)
                            onNavigateBack()
                        }
                    )
                }

                is RecordingScreenState.Error -> {
                    ErrorContent(
                        message = state.message,
                        onRetry = { screenState = RecordingScreenState.Idle },
                        onGoBack = onNavigateBack
                    )
                }
            }
        }
    }
}

@Composable
private fun IdleContent(
    hasPermission: Boolean,
    onRequestPermission: () -> Unit,
    onStartRecording: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Mic,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = Purple80
        )

        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(R.string.record_audio),
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            stringResource(R.string.record_audio_subtitle),
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(48.dp))

        if (!hasPermission) {
            Button(
                onClick = onRequestPermission,
                colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                Icon(Icons.Default.Mic, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.grant_microphone_permission), fontSize = 16.sp)
            }
        } else {
            // Large record button
            Button(
                onClick = onStartRecording,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE53935)),
                shape = CircleShape,
                modifier = Modifier.size(100.dp)
            ) {
                Icon(
                    Icons.Default.Mic,
                    contentDescription = stringResource(R.string.start_recording),
                    modifier = Modifier.size(48.dp)
                )
            }

            Spacer(Modifier.height(16.dp))

            Text(
                stringResource(R.string.tap_to_start_recording),
                fontSize = 14.sp,
                color = TextSecondary
            )
        }
    }
}

@Composable
private fun RecordingContent(
    isRecording: Boolean,
    duration: Long,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit,
    onDiscard: () -> Unit
) {
    // Pulsing animation for recording indicator
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(500),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Recording indicator
        Box(
            modifier = Modifier
                .size(120.dp)
                .scale(if (isRecording) scale else 1f)
                .clip(CircleShape)
                .background(Color(0xFFE53935).copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFE53935)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    if (isRecording) Icons.Default.Mic else Icons.Default.Pause,
                    contentDescription = null,
                    modifier = Modifier.size(40.dp),
                    tint = Color.White
                )
            }
        }

        Spacer(Modifier.height(32.dp))

        // Duration
        Text(
            formatDuration(duration),
            fontSize = 48.sp,
            fontWeight = FontWeight.Light,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            if (isRecording) stringResource(R.string.recording_status) else stringResource(R.string.paused),
            fontSize = 16.sp,
            color = if (isRecording) Color(0xFFE53935) else TextSecondary
        )

        Spacer(Modifier.height(48.dp))

        // Control buttons
        Row(
            horizontalArrangement = Arrangement.spacedBy(24.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Discard button
            OutlinedButton(
                onClick = onDiscard,
                shape = CircleShape,
                modifier = Modifier.size(56.dp),
                contentPadding = PaddingValues(0.dp),
                border = ButtonDefaults.outlinedButtonBorder.copy(
                    brush = androidx.compose.ui.graphics.SolidColor(TextSecondary)
                )
            ) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = stringResource(R.string.discard),
                    tint = TextSecondary
                )
            }

            // Pause/Resume button
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                Button(
                    onClick = { if (isRecording) onPause() else onResume() },
                    colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                    shape = CircleShape,
                    modifier = Modifier.size(72.dp),
                    contentPadding = PaddingValues(0.dp)
                ) {
                    Icon(
                        if (isRecording) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isRecording) stringResource(R.string.pause) else stringResource(R.string.resume),
                        modifier = Modifier.size(32.dp)
                    )
                }
            }

            // Stop button
            Button(
                onClick = onStop,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE53935)),
                shape = CircleShape,
                modifier = Modifier.size(56.dp),
                contentPadding = PaddingValues(0.dp)
            ) {
                Icon(
                    Icons.Default.Stop,
                    contentDescription = stringResource(R.string.stop),
                    modifier = Modifier.size(28.dp)
                )
            }
        }
    }
}

@Composable
private fun ReviewContent(
    duration: Long,
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
            Text(stringResource(R.string.process_recording), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.height(12.dp))

        TextButton(onClick = onDiscard) {
            Text(stringResource(R.string.discard_recording), color = TextSecondary)
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun RecordingProcessingContent(
    currentStep: RecordingStep,
    completedSteps: Set<RecordingStep>,
    uploadComplete: Boolean
) {
    val steps = RecordingStep.entries

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp)
    ) {
        Spacer(Modifier.height(16.dp))

        // Progress steps
        steps.forEachIndexed { index, step ->
            val isCompleted = step in completedSteps
            val isCurrent = step == currentStep && step !in completedSteps

            ProcessingStepItem(
                title = stringResource(step.titleResId),
                isCompleted = isCompleted,
                isCurrent = isCurrent,
                isLast = index == steps.lastIndex
            )
        }

        Spacer(Modifier.height(40.dp))

        // Upload complete message
        AnimatedVisibility(
            visible = uploadComplete,
            enter = fadeIn() + slideInVertically()
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = CardBackground
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CloudDone,
                        contentDescription = null,
                        tint = Color(0xFF4CAF50),
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        stringResource(R.string.upload_complete_safe),
                        fontSize = 14.sp,
                        color = TextSecondary
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // Info card about processing time
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = CardBackground
            ),
            shape = RoundedCornerShape(16.dp)
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.Top
            ) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = Purple80,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    stringResource(R.string.processing_info),
                    fontSize = 14.sp,
                    color = TextSecondary,
                    lineHeight = 20.sp
                )
            }
        }
    }
}

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
    onRetry: () -> Unit,
    onGoBack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
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
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.try_again_button), fontSize = 16.sp)
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

private suspend fun uploadAudio(file: File, token: String, title: String): String? {
    return withContext(Dispatchers.IO) {
        try {
            val client = OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(120, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()

            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "audio",
                    file.name,
                    file.asRequestBody("audio/mp4".toMediaType())
                )
                .addFormDataPart("title", title.ifEmpty {
                    "Recording ${SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(Date())}"
                })
                .build()

            val request = Request.Builder()
                .url("https://ai-notetaker-backend.fly.dev/api/recordings/upload")
                .addHeader("Authorization", "Bearer $token")
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            Log.d("RecordingScreen", "Upload response: ${response.code} - $responseBody")

            if (response.isSuccessful && responseBody != null) {
                val json = JSONObject(responseBody)
                val data = json.optJSONObject("data")
                data?.optString("id")
            } else {
                Log.e("RecordingScreen", "Upload failed: ${response.code}")
                null
            }
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Upload error", e)
            null
        }
    }
}

private suspend fun startTranscription(recordingId: String, token: String): JSONObject? {
    return withContext(Dispatchers.IO) {
        try {
            val client = OkHttpClient.Builder()
                .connectTimeout(60, TimeUnit.SECONDS)
                .readTimeout(300, TimeUnit.SECONDS) // 5 min for transcription
                .build()

            val json = JSONObject().apply {
                put("recording_id", recordingId)
            }

            val requestBody = json.toString()
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("https://ai-notetaker-backend.fly.dev/api/recordings/transcribe")
                .addHeader("Authorization", "Bearer $token")
                .addHeader("Content-Type", "application/json")
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            Log.d("RecordingScreen", "Transcription response: ${response.code} - $responseBody")

            if (response.isSuccessful && responseBody != null) {
                val responseJson = JSONObject(responseBody)
                responseJson.optJSONObject("data")
            } else {
                Log.e("RecordingScreen", "Transcription failed: ${response.code}")
                null
            }
        } catch (e: Exception) {
            Log.e("RecordingScreen", "Transcription error", e)
            null
        }
    }
}