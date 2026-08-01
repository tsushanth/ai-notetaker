package com.kreativekoala.scribeai.ui.screens

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.NoteViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// File size limits
private const val MAX_FILE_SIZE_MB = 50
private const val MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024L
private const val TAG = "PDFUploadScreen"
private const val BASE_URL = "https://ai-notetaker-backend.fly.dev"

// Upload states
sealed class UploadScreenState {
    object SelectFile : UploadScreenState()
    object Uploading : UploadScreenState()
    data class Processing(val currentStep: Int, val steps: List<PDFProcessingStep>) : UploadScreenState()
    data class Success(val noteId: String) : UploadScreenState()
    data class Error(val message: String) : UploadScreenState()
}

data class PDFProcessingStep(
    val name: String,
    val status: String // pending, in_progress, completed, failed
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PDFUploadScreen(
    authManager: AuthManager,
    onNavigateBack: () -> Unit,
    onNavigateToLogin: () -> Unit = {},
    onSuccess: (noteId: String) -> Unit = {},
    viewModel: NoteViewModel,
    subscriptionManager: SubscriptionManager
) {
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    var fileName by remember { mutableStateOf("") }
    var fileSize by remember { mutableStateOf(0L) }
    var mimeType by remember { mutableStateOf("") }
    var screenState by remember { mutableStateOf<UploadScreenState>(UploadScreenState.SelectFile) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    val authToken by authManager.authToken.collectAsState()

    // Auth check
    LaunchedEffect(authToken) {
        if (authToken == null) {
            delay(500)
            if (authToken == null) {
                errorMessage = "Please log in to continue"
                delay(1500)
                onNavigateToLogin()
            }
        } else if (authManager.isTokenExpired(authToken!!)) {
            authManager.clearAuth()
            errorMessage = "Session expired. Please log in again."
            delay(1500)
            onNavigateToLogin()
        }
    }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val info = getFileInfoFromUri(context, it)
            val size = info.second
            val mime = info.third

            if (size > MAX_FILE_SIZE_BYTES) {
                errorMessage = "File too large (${formatFileSize(size)}). Maximum size is ${MAX_FILE_SIZE_MB}MB"
                selectedFileUri = null
                return@let
            }

            selectedFileUri = it
            fileName = info.first
            fileSize = size
            mimeType = mime
            errorMessage = null
            screenState = UploadScreenState.SelectFile
        }
    }

    // Loading state while auth initializes
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
                title = { Text(stringResource(R.string.upload_pdf)) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (screenState is UploadScreenState.SelectFile ||
                            screenState is UploadScreenState.Error ||
                            screenState is UploadScreenState.Success) {
                            onNavigateBack()
                        }
                    }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    if (screenState is UploadScreenState.Uploading ||
                        screenState is UploadScreenState.Processing) {
                        TextButton(onClick = {
                            screenState = UploadScreenState.SelectFile
                            // Note: In production, you'd also want to cancel the upload/processing
                        }) {
                            Text(stringResource(R.string.cancel), color = AccentRed)
                        }
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
        when (val state = screenState) {
            is UploadScreenState.SelectFile -> {
                FileSelectionContent(
                    modifier = Modifier.padding(padding),
                    selectedFileUri = selectedFileUri,
                    fileName = fileName,
                    fileSize = fileSize,
                    errorMessage = errorMessage,
                    onSelectFile = { filePickerLauncher.launch("*/*") },
                    onUpload = {
                        if (selectedFileUri == null) {
                            errorMessage = "Please select a file first"
                            return@FileSelectionContent
                        }

                        val token = authToken ?: return@FileSelectionContent

                        coroutineScope.launch {
                            startUploadFlow(
                                context = context,
                                uri = selectedFileUri!!,
                                fileName = fileName,
                                fileSize = fileSize,
                                mimeType = mimeType,
                                token = token,
                                onStateChange = { screenState = it },
                                onError = { errorMessage = it }
                            )
                        }
                    }
                )
            }

            is UploadScreenState.Uploading -> {
                UploadingContent(
                    modifier = Modifier.padding(padding),
                    fileName = fileName
                )
            }

            is UploadScreenState.Processing -> {
                ProcessingContent(
                    modifier = Modifier.padding(padding),
                    currentStep = state.currentStep,
                    steps = state.steps
                )
            }

            is UploadScreenState.Success -> {
                subscriptionManager.incrementLifetimeNotebooks()
                SuccessContent(
                    modifier = Modifier.padding(padding),
                    onViewNote = { onSuccess(state.noteId) },
                    onUploadAnother = {
                        selectedFileUri = null
                        fileName = ""
                        fileSize = 0L
                        screenState = UploadScreenState.SelectFile
                    }
                )
            }

            is UploadScreenState.Error -> {
                ErrorContent(
                    modifier = Modifier.padding(padding),
                    message = state.message,
                    onRetry = {
                        screenState = UploadScreenState.SelectFile
                    }
                )
            }
        }
    }
}

@Composable
private fun FileSelectionContent(
    modifier: Modifier = Modifier,
    selectedFileUri: Uri?,
    fileName: String,
    fileSize: Long,
    errorMessage: String?,
    onSelectFile: () -> Unit,
    onUpload: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(32.dp))

        // Upload Area
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(200.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(DarkSurfaceVariant)
                .border(
                    width = 2.dp,
                    color = if (selectedFileUri != null) Purple80 else TextTertiary.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(16.dp)
                )
                .clickable(
                    onClick = onSelectFile,
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() }
                ),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(
                    if (selectedFileUri != null) Icons.Default.CheckCircle else Icons.Default.CloudUpload,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = if (selectedFileUri != null) Purple80 else TextTertiary
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    if (selectedFileUri != null) stringResource(R.string.file_selected) else stringResource(R.string.tap_to_select),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (selectedFileUri != null) Purple80 else TextSecondary
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (selectedFileUri != null) {
                        "$fileName\n${formatFileSize(fileSize)}"
                    } else {
                        stringResource(R.string.supported_formats)
                    },
                    fontSize = 14.sp,
                    color = TextTertiary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 32.dp)
                )
            }
        }

        // Error message
        if (errorMessage != null) {
            Spacer(Modifier.height(16.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = AccentRed.copy(alpha = 0.1f)),
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
                    Text(errorMessage, color = AccentRed, fontSize = 12.sp)
                }
            }
        }

        Spacer(Modifier.height(32.dp))

        // Supported Formats Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = CardBackground),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    stringResource(R.string.supported_formats),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(Modifier.height(12.dp))

                val formats = listOf(
                    Icons.Default.PictureAsPdf to "PDF Documents",
                    Icons.Default.Description to "Word Documents (.docx)",
                    Icons.Default.Slideshow to "PowerPoint (.pptx)",
                    Icons.Default.TextSnippet to "Text Files (.txt)"
                )

                formats.forEach { (icon, label) ->
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(icon, null, Modifier.size(20.dp), tint = Purple80)
                        Spacer(Modifier.width(12.dp))
                        Text(label, fontSize = 14.sp, color = TextSecondary)
                    }
                }

                Spacer(Modifier.height(8.dp))
                Divider(color = TextTertiary.copy(alpha = 0.2f))
                Spacer(Modifier.height(8.dp))

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Info, null, Modifier.size(16.dp), tint = TextTertiary)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Maximum file size: ${MAX_FILE_SIZE_MB}MB",
                        fontSize = 12.sp,
                        color = TextTertiary
                    )
                }
            }
        }

        Spacer(Modifier.weight(1f))

        // Upload Button
        Button(
            onClick = onUpload,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Purple80,
                disabledContainerColor = Purple80.copy(alpha = 0.5f)
            ),
            shape = RoundedCornerShape(12.dp),
            enabled = selectedFileUri != null
        ) {
            Icon(Icons.Default.Upload, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.create_note), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun UploadingContent(
    modifier: Modifier = Modifier,
    fileName: String
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(64.dp),
            color = Purple80,
            strokeWidth = 4.dp
        )

        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(R.string.uploading),
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary
        )

        Spacer(Modifier.height(8.dp))

        Text(
            fileName,
            fontSize = 14.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(48.dp))

        Text(
            stringResource(R.string.processing_info),
            fontSize = 14.sp,
            color = TextTertiary,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun ProcessingContent(
    modifier: Modifier = Modifier,
    currentStep: Int,
    steps: List<PDFProcessingStep>
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(48.dp))

        // Progress Steps
        steps.forEachIndexed { index, step ->
            PDFProcessingStepItem(
                step = step,
                isLast = index == steps.lastIndex
            )
        }

        Spacer(Modifier.weight(1f))

        // Info card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = CardBackground),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    stringResource(R.string.processing_info),
                    fontSize = 14.sp,
                    color = TextTertiary,
                    textAlign = TextAlign.Center
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Notification prompt
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = DarkSurfaceVariant),
            shape = RoundedCornerShape(12.dp)
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Notifications,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(24.dp)
                    )
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            "Get notified when your notes are ready",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary
                        )
                        Text(
                            "Notes usually take a few minutes to generate. We'll let you know when they're ready.",
                            fontSize = 12.sp,
                            color = TextSecondary
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))

                Button(
                    onClick = { /* Request notification permission */ },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple80),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Notify me")
                }
            }
        }

        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun PDFProcessingStepItem(
    step: PDFProcessingStep,
    isLast: Boolean
) {
    val infiniteTransition = rememberInfiniteTransition(label = "step")
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "rotation"
    )

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
                    .background(
                        when (step.status) {
                            "completed" -> Purple80
                            "in_progress" -> Purple80.copy(alpha = 0.3f)
                            "failed" -> AccentRed
                            else -> TextTertiary.copy(alpha = 0.3f)
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                when (step.status) {
                    "completed" -> Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                    "in_progress" -> CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Purple80,
                        strokeWidth = 2.dp
                    )
                    "failed" -> Icon(
                        Icons.Default.Close,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                    else -> {} // Empty for pending
                }
            }

            // Connector line
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(40.dp)
                        .background(
                            if (step.status == "completed") Purple80.copy(alpha = 0.5f)
                            else TextTertiary.copy(alpha = 0.2f)
                        )
                )
            }
        }

        Spacer(Modifier.width(16.dp))

        // Step text
        Text(
            text = step.name,
            fontSize = 16.sp,
            fontWeight = if (step.status == "in_progress") FontWeight.SemiBold else FontWeight.Normal,
            color = when (step.status) {
                "completed" -> TextPrimary
                "in_progress" -> TextPrimary
                "failed" -> AccentRed
                else -> TextTertiary
            },
            modifier = Modifier.padding(top = 4.dp)
        )
    }
}

@Composable
private fun SuccessContent(
    modifier: Modifier = Modifier,
    onViewNote: () -> Unit,
    onUploadAnother: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            modifier = Modifier.size(96.dp),
            tint = Purple80
        )

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
            color = TextSecondary
        )

        Spacer(Modifier.height(48.dp))

        Button(
            onClick = onViewNote,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(stringResource(R.string.view_note), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.height(16.dp))

        OutlinedButton(
            onClick = onUploadAnother,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Purple80)
        ) {
            Text(stringResource(R.string.upload_pdf), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun ErrorContent(
    modifier: Modifier = Modifier,
    message: String,
    onRetry: () -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Error,
            contentDescription = null,
            modifier = Modifier.size(96.dp),
            tint = AccentRed
        )

        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(R.string.error_processing_failed),
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
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Text(stringResource(R.string.try_again_button), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ==================== Upload Flow Logic ====================

private suspend fun startUploadFlow(
    context: Context,
    uri: Uri,
    fileName: String,
    fileSize: Long,
    mimeType: String,
    token: String,
    onStateChange: (UploadScreenState) -> Unit,
    onError: (String) -> Unit
) {
    val client = OkHttpClient.Builder()
        .connectTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    try {
        // Step 1: Request signed upload URL
        Log.d(TAG, "Step 1: Requesting signed upload URL")
        onStateChange(UploadScreenState.Uploading)

        val requestUploadBody = JSONObject().apply {
            put("fileName", fileName)
            put("fileSize", fileSize)
            put("mimeType", mimeType)
        }.toString().toRequestBody("application/json".toMediaType())

        val requestUploadRequest = Request.Builder()
            .url("$BASE_URL/api/uploads/request-upload")
            .post(requestUploadBody)
            .addHeader("Authorization", "Bearer $token")
            .build()

        val requestUploadResponse = withContext(Dispatchers.IO) {
            client.newCall(requestUploadRequest).execute()
        }

        if (!requestUploadResponse.isSuccessful) {
            val errorBody = requestUploadResponse.body?.string()
            val errorMsg = try {
                JSONObject(errorBody ?: "{}").optString("error", "Failed to get upload URL")
            } catch (e: Exception) {
                "Failed to get upload URL (${requestUploadResponse.code})"
            }
            throw Exception(errorMsg)
        }

        val uploadData = JSONObject(requestUploadResponse.body?.string() ?: "{}")
            .getJSONObject("data")
        val signedUrl = uploadData.getString("uploadUrl")
        val jobId = uploadData.getString("jobId")

        Log.d(TAG, "Got signed URL and jobId: $jobId")

        // Step 2: Upload directly to Supabase
        Log.d(TAG, "Step 2: Uploading to Supabase")

        val fileBytes = withContext(Dispatchers.IO) {
            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                ?: throw Exception("Failed to read file")
        }

        val uploadRequest = Request.Builder()
            .url(signedUrl)
            .put(fileBytes.toRequestBody(mimeType.toMediaType()))
            .build()

        val uploadResponse = withContext(Dispatchers.IO) {
            client.newCall(uploadRequest).execute()
        }

        if (!uploadResponse.isSuccessful) {
            throw Exception("Upload failed: ${uploadResponse.code}")
        }

        Log.d(TAG, "Upload complete, starting processing")

        // Step 3: Trigger processing
        val processBody = JSONObject().apply {
            put("jobId", jobId)
            put("title", fileName.substringBeforeLast("."))
        }.toString().toRequestBody("application/json".toMediaType())

        val processRequest = Request.Builder()
            .url("$BASE_URL/api/uploads/process")
            .post(processBody)
            .addHeader("Authorization", "Bearer $token")
            .build()

        val processResponse = withContext(Dispatchers.IO) {
            client.newCall(processRequest).execute()
        }

        if (!processResponse.isSuccessful) {
            throw Exception("Failed to start processing")
        }

        // Step 4: Poll for status
        Log.d(TAG, "Step 4: Polling for status")
        pollForStatus(client, token, jobId, onStateChange)

    } catch (e: Exception) {
        Log.e(TAG, "Upload flow error", e)
        onStateChange(UploadScreenState.Error(e.message ?: "Upload failed"))
    }
}

private suspend fun pollForStatus(
    client: OkHttpClient,
    token: String,
    jobId: String,
    onStateChange: (UploadScreenState) -> Unit
) {
    var attempts = 0
    val maxAttempts = 60 // 2 minutes max with 2 second intervals

    while (attempts < maxAttempts) {
        delay(2000) // Poll every 2 seconds

        try {
            val statusRequest = Request.Builder()
                .url("$BASE_URL/api/uploads/status/$jobId")
                .get()
                .addHeader("Authorization", "Bearer $token")
                .build()

            val response = withContext(Dispatchers.IO) {
                client.newCall(statusRequest).execute()
            }

            if (!response.isSuccessful) {
                attempts++
                continue
            }

            val data = JSONObject(response.body?.string() ?: "{}").getJSONObject("data")
            val status = data.getString("status")
            val step = data.getInt("step")
            val stepsArray = data.getJSONArray("steps")

            val steps = (0 until stepsArray.length()).map { i ->
                val stepObj = stepsArray.getJSONObject(i)
                PDFProcessingStep(
                    name = stepObj.getString("name"),
                    status = stepObj.getString("status")
                )
            }

            when (status) {
                "completed" -> {
                    val noteId = data.optString("noteId", "")
                    onStateChange(UploadScreenState.Success(noteId))
                    return
                }
                "failed" -> {
                    val error = data.optString("error", "Processing failed")
                    onStateChange(UploadScreenState.Error(error))
                    return
                }
                else -> {
                    onStateChange(UploadScreenState.Processing(step, steps))
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "Status poll error", e)
        }

        attempts++
    }

    onStateChange(UploadScreenState.Error("Processing timed out. Please try again."))
}

// ==================== Utility Functions ====================

private fun getFileInfoFromUri(context: Context, uri: Uri): Triple<String, Long, String> {
    var fileName = "document.pdf"
    var fileSize = 0L
    var mimeType = "application/pdf"

    try {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1) {
                    fileName = cursor.getString(nameIndex) ?: fileName
                }
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex != -1) {
                    fileSize = cursor.getLong(sizeIndex)
                }
            }
        }

        // Get mime type
        mimeType = context.contentResolver.getType(uri) ?: guessMimeType(fileName)

        if (fileSize == 0L) {
            context.contentResolver.openInputStream(uri)?.use { stream ->
                fileSize = stream.available().toLong()
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "Error getting file info", e)
        fileName = uri.lastPathSegment ?: fileName
    }

    return Triple(fileName, fileSize, mimeType)
}

private fun guessMimeType(fileName: String): String {
    return when {
        fileName.endsWith(".pdf", ignoreCase = true) -> "application/pdf"
        fileName.endsWith(".docx", ignoreCase = true) ->
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fileName.endsWith(".pptx", ignoreCase = true) ->
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        fileName.endsWith(".txt", ignoreCase = true) -> "text/plain"
        else -> "application/octet-stream"
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> String.format("%.1f KB", bytes / 1024.0)
        bytes < 1024 * 1024 * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024.0))
        else -> String.format("%.1f GB", bytes / (1024.0 * 1024.0 * 1024.0))
    }
}