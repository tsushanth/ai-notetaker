package com.kreativekoala.scribeai.ui.meetings

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.kreativekoala.scribeai.data.models.MeetingPlatform
import com.kreativekoala.scribeai.viewmodel.CreateMeetingState
import com.kreativekoala.scribeai.viewmodel.MeetingViewModel

/**
 * Dialog for entering a meeting URL to join
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinMeetingDialog(
    viewModel: MeetingViewModel,
    token: String,
    onDismiss: () -> Unit
) {
    var meetingUrl by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var validationResult by remember { mutableStateOf<Pair<Boolean, MeetingPlatform?>>(false to null) }

    val createState by viewModel.createState.collectAsState()

    // Update validation when URL changes
    LaunchedEffect(meetingUrl) {
        validationResult = if (meetingUrl.isBlank()) {
            false to null
        } else {
            viewModel.validateMeetingUrl(meetingUrl)
        }
    }

    // Dismiss on success
    LaunchedEffect(createState) {
        if (createState is CreateMeetingState.Success) {
            viewModel.resetCreateState()
            onDismiss()
        }
    }

    AlertDialog(
        onDismissRequest = {
            if (createState !is CreateMeetingState.Loading) {
                viewModel.resetCreateState()
                onDismiss()
            }
        },
        title = { Text("Join a Meeting") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = "Paste your meeting link and our bot will join to record and transcribe.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Meeting URL input
                OutlinedTextField(
                    value = meetingUrl,
                    onValueChange = { meetingUrl = it },
                    label = { Text("Meeting Link") },
                    placeholder = { Text("https://zoom.us/j/...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    isError = meetingUrl.isNotBlank() && !validationResult.first,
                    supportingText = {
                        when {
                            meetingUrl.isBlank() -> null
                            validationResult.first -> {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                        tint = Color(0xFF4CAF50)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        "${validationResult.second?.displayName} detected",
                                        color = Color(0xFF4CAF50)
                                    )
                                }
                            }
                            else -> {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Default.Error,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp),
                                        tint = MaterialTheme.colorScheme.error
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        "Invalid meeting URL",
                                        color = MaterialTheme.colorScheme.error
                                    )
                                }
                            }
                        }
                    }
                )

                // Title input (optional)
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title (optional)") },
                    placeholder = { Text("e.g., Team Standup") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Supported platforms
                Text(
                    text = "Supported: Zoom, Google Meet, Teams, Webex",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Error message
                if (createState is CreateMeetingState.Error) {
                    Text(
                        text = (createState as CreateMeetingState.Error).message,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    // Prepend https:// if no protocol is specified
                    val normalizedUrl = if (!meetingUrl.startsWith("http://") && !meetingUrl.startsWith("https://")) {
                        "https://$meetingUrl"
                    } else {
                        meetingUrl
                    }
                    viewModel.createMeeting(
                        token = token,
                        meetingUrl = normalizedUrl,
                        title = title.ifBlank { null }
                    )
                },
                enabled = validationResult.first && createState !is CreateMeetingState.Loading
            ) {
                if (createState is CreateMeetingState.Loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text("Send Bot")
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    viewModel.resetCreateState()
                    onDismiss()
                },
                enabled = createState !is CreateMeetingState.Loading
            ) {
                Text("Cancel")
            }
        }
    )
}
