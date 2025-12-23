package com.kreativekoala.scribeai.ui.components

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.scribeai.ui.theme.*

// MARK: - Processing Step Types

/**
 * YouTube processing steps
 */
enum class YouTubeProcessingStep(val title: String) {
    SENDING_URL("Sending video URL"),
    FETCHING_TRANSCRIPT("Fetching transcript"),
    ANALYZING_CONTENT("Analyzing content"),
    SUMMARIZING_KEY_POINTS("Summarizing key points"),
    FINALIZING_NOTE("Finalizing your note")
}

/**
 * Audio recording processing steps
 */
enum class RecordingProcessingStep(val title: String) {
    UPLOADING_AUDIO("Uploading audio"),
    TRANSCRIBING_AUDIO("Transcribing audio"),
    IDENTIFYING_SPEAKERS("Identifying speakers"),
    ANALYZING_CONTENT("Analyzing content"),
    SUMMARIZING_KEY_POINTS("Summarizing key points"),
    FINALIZING_NOTE("Finalizing your note")
}

/**
 * PDF/Document processing steps
 */
enum class DocumentProcessingStep(val title: String) {
    UPLOADING_DOCUMENT("Uploading document"),
    EXTRACTING_TEXT("Extracting text"),
    ANALYZING_CONTENT("Analyzing content"),
    SUMMARIZING_KEY_POINTS("Summarizing key points"),
    FINALIZING_NOTE("Finalizing your note")
}

/**
 * Scan processing steps
 */
enum class ScanProcessingStep(val title: String) {
    UPLOADING_IMAGES("Uploading scanned images"),
    PERFORMING_OCR("Extracting text (OCR)"),
    ANALYZING_CONTENT("Analyzing content"),
    SUMMARIZING_KEY_POINTS("Summarizing key points"),
    FINALIZING_NOTE("Finalizing your note")
}

// MARK: - Generic Processing Step

enum class StepStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED
}

data class ProcessingStep(
    val title: String,
    val status: StepStatus = StepStatus.PENDING
)

// MARK: - Processing State

sealed class ProcessingState {
    object Idle : ProcessingState()
    data class Processing(
        val steps: List<ProcessingStep>,
        val currentIndex: Int,
        val uploadComplete: Boolean = false
    ) : ProcessingState()
    data class Success(val noteId: String? = null) : ProcessingState()
    data class Error(val message: String) : ProcessingState()
}

// MARK: - Processing Steps View

@Composable
fun ProcessingStepsView(
    steps: List<ProcessingStep>,
    currentIndex: Int,
    uploadComplete: Boolean,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(horizontal = 24.dp),
        contentPadding = PaddingValues(vertical = 24.dp)
    ) {
        // Steps
        itemsIndexed(steps) { index, step ->
            ProcessingStepRow(
                step = step,
                isLast = index == steps.lastIndex
            )
        }

        // Upload complete message
        if (uploadComplete) {
            item {
                Spacer(Modifier.height(40.dp))
                UploadCompleteCard()
            }
        }
    }
}

@Composable
private fun ProcessingStepRow(
    step: ProcessingStep,
    isLast: Boolean
) {
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
                            StepStatus.COMPLETED -> Purple80
                            StepStatus.IN_PROGRESS -> Color.Transparent
                            StepStatus.PENDING -> Color.Transparent
                        }
                    )
                    .then(
                        if (step.status == StepStatus.PENDING) {
                            Modifier.background(Color.Transparent)
                        } else Modifier
                    ),
                contentAlignment = Alignment.Center
            ) {
                when (step.status) {
                    StepStatus.COMPLETED -> {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = "Completed",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    StepStatus.IN_PROGRESS -> {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            color = Purple80,
                            strokeWidth = 2.dp
                        )
                    }
                    StepStatus.PENDING -> {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(Color.Transparent)
                        ) {
                            // Draw border circle for pending
                            Surface(
                                modifier = Modifier.fillMaxSize(),
                                shape = CircleShape,
                                color = Color.Transparent,
                                border = androidx.compose.foundation.BorderStroke(2.dp, DarkSurfaceVariant)
                            ) {}
                        }
                    }
                }
            }

            // Connecting line
            if (!isLast) {
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .height(32.dp)
                        .background(
                            if (step.status == StepStatus.COMPLETED) Purple80 else DarkSurfaceVariant
                        )
                )
            }
        }

        Spacer(Modifier.width(16.dp))

        // Step title
        Text(
            text = step.title,
            fontSize = 16.sp,
            fontWeight = if (step.status == StepStatus.IN_PROGRESS) FontWeight.Medium else FontWeight.Normal,
            color = when (step.status) {
                StepStatus.COMPLETED, StepStatus.IN_PROGRESS -> TextPrimary
                StepStatus.PENDING -> TextTertiary
            },
            modifier = Modifier.padding(top = 4.dp)
        )
    }
}

@Composable
private fun UploadCompleteCard() {
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
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.CloudDone,
                contentDescription = null,
                tint = AccentGreen,
                modifier = Modifier.size(24.dp)
            )
            Spacer(Modifier.width(12.dp))
            Text(
                "Upload is complete. It's safe to leave now.",
                fontSize = 14.sp,
                color = TextSecondary
            )
        }
    }
}

// MARK: - Success View

@Composable
fun ProcessingSuccessView(
    onViewNote: () -> Unit,
    onGoHome: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(Modifier.weight(1f))

        // Success icon
        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .background(AccentGreen.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = "Success",
                tint = AccentGreen,
                modifier = Modifier.size(64.dp)
            )
        }

        Spacer(Modifier.height(24.dp))

        Text(
            "Your note is ready!",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(12.dp))

        Text(
            "We've processed your content and created study materials.",
            fontSize = 16.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.weight(1f))

        // Buttons
        Button(
            onClick = onViewNote,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.Visibility, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                "View Note",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(Modifier.height(16.dp))

        TextButton(onClick = onGoHome) {
            Text(
                "Go to Home",
                fontSize = 16.sp,
                color = TextSecondary
            )
        }

        Spacer(Modifier.height(32.dp))
    }
}

// MARK: - Error View

@Composable
fun ProcessingErrorView(
    message: String,
    onRetry: () -> Unit,
    onGoBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Spacer(Modifier.weight(1f))

        // Error icon
        Icon(
            Icons.Default.Error,
            contentDescription = "Error",
            tint = AccentRed,
            modifier = Modifier.size(64.dp)
        )

        Spacer(Modifier.height(24.dp))

        Text(
            "Something went wrong",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary
        )

        Spacer(Modifier.height(12.dp))

        Text(
            message,
            fontSize = 14.sp,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 32.dp)
        )

        Spacer(Modifier.weight(1f))

        // Buttons
        Button(
            onClick = onRetry,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Purple80),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(
                "Try Again",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(Modifier.height(16.dp))

        TextButton(onClick = onGoBack) {
            Text(
                "Go Back",
                fontSize = 16.sp,
                color = TextSecondary
            )
        }

        Spacer(Modifier.height(32.dp))
    }
}
