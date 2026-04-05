package com.kreativekoala.scribeai.ui.meetings

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.data.models.Meeting
import com.kreativekoala.scribeai.data.models.MeetingPlatform
import com.kreativekoala.scribeai.data.models.MeetingStatus
import com.kreativekoala.scribeai.utils.AuthManager
import com.kreativekoala.scribeai.utils.SubscriptionManager
import com.kreativekoala.scribeai.viewmodel.MeetingUiState
import com.kreativekoala.scribeai.viewmodel.MeetingViewModel

/**
 * Main meetings screen showing list of meeting bot recordings
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingsScreen(
    authManager: AuthManager,
    subscriptionManager: SubscriptionManager,
    onNavigateBack: () -> Unit,
    onNavigateToNote: (String) -> Unit
) {
    val token by authManager.authToken.collectAsState(initial = null)
    val meetingViewModel: MeetingViewModel = viewModel()
    val uiState by meetingViewModel.uiState.collectAsState()
    val isRefreshing by meetingViewModel.isRefreshing.collectAsState()
    var showCreateDialog by remember { mutableStateOf(false) }

    LaunchedEffect(token) {
        token?.let { meetingViewModel.loadMeetings(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.meeting_bot)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(onClick = { showCreateDialog = true }) {
                        Icon(Icons.Default.Add, contentDescription = stringResource(R.string.join_a_meeting))
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = uiState) {
                is MeetingUiState.Loading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center)
                    )
                }
                is MeetingUiState.Success -> {
                    if (state.meetings.isEmpty()) {
                        EmptyMeetingsView(onCreateMeeting = { showCreateDialog = true })
                    } else {
                        MeetingsList(
                            meetings = state.meetings,
                            isRefreshing = isRefreshing,
                            onRefresh = { token?.let { meetingViewModel.loadMeetings(it) } },
                            onCancel = { token?.let { t -> meetingViewModel.cancelMeeting(t, it.id) } },
                            onDelete = { token?.let { t -> meetingViewModel.deleteMeeting(t, it.id) } },
                            onViewNote = { meeting ->
                                meeting.noteId?.let { onNavigateToNote(it) }
                            }
                        )
                    }
                }
                is MeetingUiState.Error -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = state.message,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { token?.let { meetingViewModel.loadMeetings(it) } }) {
                            Text(stringResource(R.string.retry))
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog && token != null) {
        JoinMeetingDialog(
            viewModel = meetingViewModel,
            token = token!!,
            onDismiss = { showCreateDialog = false }
        )
    }
}

/**
 * Empty state view when no meetings exist
 */
@Composable
fun EmptyMeetingsView(onCreateMeeting: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.VideoCall,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = stringResource(R.string.no_meetings),
            style = MaterialTheme.typography.headlineSmall
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = stringResource(R.string.no_meetings_hint),
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(32.dp))

        Button(onClick = onCreateMeeting) {
            Icon(Icons.Default.Add, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(R.string.join_a_meeting))
        }
    }
}

/**
 * List of meetings with refresh button
 */
@Composable
fun MeetingsList(
    meetings: List<Meeting>,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onCancel: (Meeting) -> Unit,
    onDelete: (Meeting) -> Unit,
    onViewNote: (Meeting) -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(meetings, key = { it.id }) { meeting ->
                MeetingCard(
                    meeting = meeting,
                    onCancel = { onCancel(meeting) },
                    onDelete = { onDelete(meeting) },
                    onViewNote = { onViewNote(meeting) }
                )
            }
        }

        // Show loading indicator when refreshing
        if (isRefreshing) {
            CircularProgressIndicator(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 16.dp)
            )
        }
    }
}

/**
 * Individual meeting card
 */
@Composable
fun MeetingCard(
    meeting: Meeting,
    onCancel: () -> Unit,
    onDelete: () -> Unit,
    onViewNote: () -> Unit
) {
    var showDeleteConfirmation by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Platform icon
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(
                        getPlatformColor(meeting.platform).copy(alpha = 0.1f),
                        shape = MaterialTheme.shapes.medium
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.VideoCall,
                    contentDescription = null,
                    tint = getPlatformColor(meeting.platform),
                    modifier = Modifier.size(28.dp)
                )
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Content
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = meeting.title ?: "Untitled Meeting",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Status indicator
                    StatusIndicator(status = meeting.status)

                    Spacer(modifier = Modifier.width(6.dp))

                    Text(
                        text = meeting.status.displayText,
                        style = MaterialTheme.typography.bodySmall,
                        color = getStatusColor(meeting.status)
                    )
                }

                meeting.formattedDuration?.let { duration ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Duration: $duration",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Action buttons
            when {
                meeting.isCancellable -> {
                    IconButton(onClick = onCancel) {
                        Icon(
                            Icons.Default.Cancel,
                            contentDescription = stringResource(R.string.cancel),
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
                meeting.status == MeetingStatus.COMPLETED && meeting.noteId != null -> {
                    TextButton(onClick = onViewNote) {
                        Text(stringResource(R.string.view_note))
                    }
                }
                meeting.status in listOf(MeetingStatus.FAILED, MeetingStatus.CANCELLED) -> {
                    IconButton(onClick = { showDeleteConfirmation = true }) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = stringResource(R.string.delete),
                            tint = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }
        }
    }

    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirmation = false },
            title = { Text(stringResource(R.string.delete)) },
            text = { Text(stringResource(R.string.delete_note_detail_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onDelete()
                        showDeleteConfirmation = false
                    }
                ) {
                    Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirmation = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }
}

/**
 * Animated status indicator
 */
@Composable
fun StatusIndicator(status: MeetingStatus) {
    when {
        status == MeetingStatus.RECORDING -> {
            // Pulsing red dot for recording
            val infiniteTransition = rememberInfiniteTransition(label = "pulse")
            val alpha by infiniteTransition.animateFloat(
                initialValue = 1f,
                targetValue = 0.3f,
                animationSpec = infiniteRepeatable(
                    animation = tween(800),
                    repeatMode = RepeatMode.Reverse
                ),
                label = "pulseAlpha"
            )
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .alpha(alpha)
                    .background(Color.Red, shape = CircleShape)
            )
        }
        status.isActive -> {
            // Small progress indicator for active states
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 2.dp
            )
        }
        else -> {
            // Static icon for completed states
            Icon(
                imageVector = when (status) {
                    MeetingStatus.COMPLETED -> Icons.Default.CheckCircle
                    MeetingStatus.FAILED -> Icons.Default.Error
                    MeetingStatus.CANCELLED -> Icons.Default.Cancel
                    else -> Icons.Default.Circle
                },
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = getStatusColor(status)
            )
        }
    }
}

/**
 * Get color for meeting platform
 */
fun getPlatformColor(platform: MeetingPlatform): Color {
    return when (platform) {
        MeetingPlatform.ZOOM -> Color(0xFF2D8CFF)
        MeetingPlatform.GOOGLE_MEET -> Color(0xFF00897B)
        MeetingPlatform.TEAMS -> Color(0xFF6264A7)
        MeetingPlatform.WEBEX -> Color(0xFFFF7A00)
        MeetingPlatform.OTHER -> Color.Gray
    }
}

/**
 * Get color for meeting status
 */
@Composable
fun getStatusColor(status: MeetingStatus): Color {
    return when (status) {
        MeetingStatus.COMPLETED -> Color(0xFF4CAF50)
        MeetingStatus.FAILED, MeetingStatus.CANCELLED -> MaterialTheme.colorScheme.error
        MeetingStatus.RECORDING -> Color.Red
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}
