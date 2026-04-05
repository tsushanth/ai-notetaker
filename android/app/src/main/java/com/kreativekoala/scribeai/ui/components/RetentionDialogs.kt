package com.kreativekoala.scribeai.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.kreativekoala.scribeai.R
import com.kreativekoala.scribeai.data.models.DeletionReason
import com.kreativekoala.scribeai.data.models.UserStats
import com.kreativekoala.scribeai.ui.theme.*
import com.kreativekoala.scribeai.utils.FirebaseAnalyticsHelper

/**
 * Sign out confirmation dialog with retention value display
 */
@Composable
fun SignOutRetentionDialog(
    stats: UserStats?,
    isLoading: Boolean,
    onDismiss: () -> Unit,
    onStaySignedIn: () -> Unit,
    onSignOut: () -> Unit
) {
    LaunchedEffect(Unit) {
        FirebaseAnalyticsHelper.logSignOutAttempted()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = CardBackground)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Warning icon
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = Color(0xFFFFC107) // Yellow warning color
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Title
                Text(
                    text = stringResource(R.string.are_you_sure),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = stringResource(R.string.lose_access),
                    fontSize = 16.sp,
                    color = TextSecondary
                )

                Spacer(modifier = Modifier.height(24.dp))

                // Stats display
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        color = Purple80
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                } else if (stats != null) {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatRow(
                            icon = Icons.Default.Description,
                            value = "${stats.notesCount}",
                            label = stringResource(R.string.stat_notes_created)
                        )
                        StatRow(
                            icon = Icons.Default.Quiz,
                            value = "${stats.quizzesCount}",
                            label = stringResource(R.string.stat_quizzes_generated)
                        )
                        StatRow(
                            icon = Icons.Default.Style,
                            value = "${stats.flashcardsCount}",
                            label = stringResource(R.string.stat_flashcards_created)
                        )
                        if (stats.audioHours > 0) {
                            StatRow(
                                icon = Icons.Default.Headphones,
                                value = String.format("%.1f", stats.audioHours),
                                label = stringResource(R.string.stat_audio_hours)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))
                }

                // Buttons
                Button(
                    onClick = {
                        FirebaseAnalyticsHelper.logSignOutCancelled()
                        onStaySignedIn()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                ) {
                    Text(
                        text = stringResource(R.string.stay_signed_in),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                TextButton(
                    onClick = {
                        FirebaseAnalyticsHelper.logSignOutCompleted()
                        onSignOut()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = stringResource(R.string.sign_out_anyway),
                        fontSize = 16.sp,
                        color = TextSecondary
                    )
                }
            }
        }
    }
}

/**
 * Delete account confirmation dialog with retention value display
 */
@Composable
fun DeleteAccountRetentionDialog(
    stats: UserStats?,
    isLoading: Boolean,
    isDeleting: Boolean,
    onDismiss: () -> Unit,
    onKeepAccount: () -> Unit,
    onDelete: (DeletionReason) -> Unit
) {
    var showReasonPicker by remember { mutableStateOf(false) }
    var selectedReason by remember { mutableStateOf<DeletionReason?>(null) }

    LaunchedEffect(Unit) {
        FirebaseAnalyticsHelper.logDeleteAccountAttempted()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = CardBackground)
        ) {
            if (showReasonPicker) {
                // Reason selection view
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = stringResource(R.string.before_you_go),
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = stringResource(R.string.feedback_reason),
                        fontSize = 16.sp,
                        color = TextSecondary,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // Reason options
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        DeletionReason.values().forEach { reason ->
                            Surface(
                                onClick = { selectedReason = reason },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(12.dp),
                                color = if (selectedReason == reason)
                                    Purple80.copy(alpha = 0.2f) else DarkSurfaceVariant
                            ) {
                                Row(
                                    modifier = Modifier.padding(16.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = reason.displayName,
                                        fontSize = 16.sp,
                                        color = TextPrimary,
                                        modifier = Modifier.weight(1f)
                                    )
                                    if (selectedReason == reason) {
                                        Icon(
                                            imageVector = Icons.Default.CheckCircle,
                                            contentDescription = null,
                                            tint = Purple80
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Back button
                    Button(
                        onClick = { showReasonPicker = false },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                    ) {
                        Text(
                            text = stringResource(R.string.go_back),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Delete button
                    TextButton(
                        onClick = {
                            selectedReason?.let { reason ->
                                FirebaseAnalyticsHelper.logDeleteAccountCompleted(
                                    reason = reason.name,
                                    notesCount = stats?.notesCount ?: 0
                                )
                                onDelete(reason)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = selectedReason != null && !isDeleting
                    ) {
                        if (isDeleting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = AccentRed,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(
                                text = stringResource(R.string.delete_my_account),
                                fontSize = 16.sp,
                                color = if (selectedReason != null) AccentRed else TextTertiary
                            )
                        }
                    }
                }
            } else {
                // Initial confirmation view
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Delete icon
                    Icon(
                        imageVector = Icons.Default.Delete,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = AccentRed
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Title
                    Text(
                        text = stringResource(R.string.delete_account),
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = stringResource(R.string.delete_account_warning),
                        fontSize = 16.sp,
                        color = TextSecondary,
                        textAlign = TextAlign.Center
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // Stats display
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(32.dp),
                            color = Purple80
                        )
                        Spacer(modifier = Modifier.height(24.dp))
                    } else if (stats != null) {
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            StatRow(
                                icon = Icons.Default.Description,
                                value = "${stats.notesCount}",
                                label = stringResource(R.string.stat_notes_created)
                            )
                            StatRow(
                                icon = Icons.Default.Quiz,
                                value = "${stats.quizzesCount}",
                                label = stringResource(R.string.stat_quizzes_generated)
                            )
                            StatRow(
                                icon = Icons.Default.Style,
                                value = "${stats.flashcardsCount}",
                                label = stringResource(R.string.stat_flashcards_created)
                            )
                        }

                        Spacer(modifier = Modifier.height(24.dp))
                    }

                    // Buttons
                    Button(
                        onClick = {
                            FirebaseAnalyticsHelper.logDeleteAccountCancelled()
                            onKeepAccount()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Purple80)
                    ) {
                        Text(
                            text = stringResource(R.string.keep_my_account),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    TextButton(
                        onClick = { showReasonPicker = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = stringResource(R.string.delete_anyway),
                            fontSize = 16.sp,
                            color = AccentRed
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatRow(
    icon: ImageVector,
    value: String,
    label: String
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = DarkSurfaceVariant
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = Purple80
            )
            Spacer(modifier = Modifier.width(16.dp))
            Text(
                text = value,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = label,
                fontSize = 16.sp,
                color = TextSecondary
            )
        }
    }
}
