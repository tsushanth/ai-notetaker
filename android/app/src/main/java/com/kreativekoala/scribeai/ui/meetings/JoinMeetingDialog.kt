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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.scribeai.R
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
        title = { Text(stringResource(R.string.join_a_meeting)) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = stringResource(R.string.meeting_link),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Meeting URL input
                OutlinedTextField(
                    value = meetingUrl,
                    onValueChange = { meetingUrl = it },
                    label = { Text(stringResource(R.string.meeting_link)) },
                    placeholder = { Text(stringResource(R.string.meeting_link_placeholder)) },
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
                                        stringResource(R.string.invalid_youtube_url),
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
                    label = { Text(stringResource(R.string.meeting_title_optional)) },
                    placeholder = { Text(stringResource(R.string.meeting_title_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                // Supported platforms
                Text(
                    text = stringResource(R.string.join_meeting_subtitle),
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
                Text(stringResource(R.string.send_bot))
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
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
