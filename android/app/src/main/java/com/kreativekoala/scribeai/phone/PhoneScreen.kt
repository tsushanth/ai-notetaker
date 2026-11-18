package com.kreativekoala.scribeai.phone

import androidx.compose.material.icons.automirrored.filled.ArrowBack
import com.kreativekoala.scribeai.R
import androidx.compose.ui.res.stringResource
import android.Manifest
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.kreativekoala.scribeai.utils.AuthManager
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import com.kreativekoala.scribeai.utils.AppStrings

private class PhoneViewModelFactory(
    private val authManager: AuthManager
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return PhoneViewModel(authManager) as T
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalPermissionsApi::class)
@Composable
fun PhoneScreen(
    authManager: AuthManager,
    onNavigateBack: () -> Unit,
) {
    val viewModel: PhoneViewModel = viewModel(factory = PhoneViewModelFactory(authManager))
    val uiState by viewModel.uiState.collectAsState()
    val isMuted by viewModel.isMuted.collectAsState()
    val isSpeakerOn by viewModel.isSpeakerOn.collectAsState()

    var pendingCallAfterPermission by remember { mutableStateOf(false) }
    val micPermission = rememberPermissionState(Manifest.permission.RECORD_AUDIO) { granted ->
        if (granted && pendingCallAfterPermission) {
            pendingCallAfterPermission = false
            viewModel.initiateCall()
        }
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    var showVerificationSheet by remember { mutableStateOf(false) }

    if (uiState.hasActiveCall) {
        ActiveCallSheet(
            call = uiState.activeCall,
            callState = uiState.activeCallState,
            isMuted = isMuted,
            isSpeakerOn = isSpeakerOn,
            onToggleMute = { viewModel.toggleMute() },
            onToggleSpeaker = { viewModel.toggleSpeaker() },
            onHangup = { viewModel.hangupCall() },
            onDismiss = { viewModel.clearActiveCall() }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.ui_phone)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(onClick = { showVerificationSheet = true }) {
                        Icon(Icons.Default.AddCircle, contentDescription = stringResource(R.string.ui_verify_phone))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            TabRow(
                selectedTabIndex = uiState.selectedTab.ordinal,
                modifier = Modifier.fillMaxWidth()
            ) {
                Tab(
                    selected = uiState.selectedTab == PhoneTab.CALLS,
                    onClick = { viewModel.selectTab(PhoneTab.CALLS) },
                    text = { Text(stringResource(R.string.ui_calls)) }
                )
                Tab(
                    selected = uiState.selectedTab == PhoneTab.DIALER,
                    onClick = { viewModel.selectTab(PhoneTab.DIALER) },
                    text = { Text(stringResource(R.string.ui_dialer)) }
                )
            }

            when (uiState.selectedTab) {
                PhoneTab.CALLS -> CallsContent(
                    calls = uiState.phoneCalls,
                    isLoading = uiState.isLoading,
                    hasVerifiedPhone = uiState.hasVerifiedPhones,
                    onLoadMore = { viewModel.loadMoreCalls() },
                    onCallClick = { call ->
                        if (uiState.hasVerifiedPhones) {
                            if (micPermission.status.isGranted) viewModel.callFromHistory(call)
                            else {
                                pendingCallAfterPermission = true
                                micPermission.launchPermissionRequest()
                            }
                        } else {
                            showVerificationSheet = true
                        }
                    },
                    onVerifyClick = { showVerificationSheet = true }
                )
                PhoneTab.DIALER -> DialerContent(
                    dialerNumber = uiState.dialerNumber,
                    hasVerifiedPhone = uiState.hasVerifiedPhones,
                    onNumberChange = { viewModel.updateDialerNumber(it) },
                    onDigitClick = { viewModel.appendDialerDigit(it) },
                    onDeleteClick = { viewModel.deleteDialerDigit() },
                    onStartCall = {
                        if (micPermission.status.isGranted) viewModel.initiateCall()
                        else {
                            pendingCallAfterPermission = true
                            micPermission.launchPermissionRequest()
                        }
                    },
                    onVerifyPhoneClick = { showVerificationSheet = true }
                )
            }
        }
    }

    if (showVerificationSheet) {
        VerificationBottomSheet(
            verificationState = uiState.verificationState,
            verificationPhoneNumber = uiState.verificationPhoneNumber,
            verificationCode = uiState.verificationCode,
            verificationError = uiState.verificationError,
            verifiedPhones = uiState.verifiedPhones,
            onPhoneNumberChange = { viewModel.updateVerificationPhoneNumber(it) },
            onCodeChange = { viewModel.updateVerificationCode(it) },
            onSendCode = { viewModel.sendVerificationCode() },
            onVerify = { viewModel.checkVerificationCode() },
            onReset = { viewModel.resetVerification() },
            onDeletePhone = { viewModel.deleteVerifiedPhone(it) },
            onDismiss = {
                showVerificationSheet = false
                viewModel.resetVerification()
            }
        )
    }
}

@Composable
private fun CallsContent(
    calls: List<PhoneCall>,
    isLoading: Boolean,
    hasVerifiedPhone: Boolean,
    onLoadMore: () -> Unit,
    onCallClick: (PhoneCall) -> Unit,
    onVerifyClick: () -> Unit,
) {
    if (isLoading && calls.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    if (calls.isEmpty()) {
        EmptyCallsContent(hasVerifiedPhone = hasVerifiedPhone, onVerifyClick = onVerifyClick)
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(calls) { call ->
            PhoneCallCard(call = call, onCallClick = onCallClick)
        }
        item {
            LaunchedEffect(Unit) { onLoadMore() }
        }
    }
}

@Composable
private fun PhoneCallCard(call: PhoneCall, onCallClick: (PhoneCall) -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onCallClick(call) },
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(
                        when (call.status) {
                            PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.15f)
                            PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3).copy(alpha = 0.15f)
                            PhoneCallStatus.RINGING -> Color(0xFFFF9800).copy(alpha = 0.15f)
                            PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336).copy(alpha = 0.15f)
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Icons.Default.PhoneCallback
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Icons.Default.Phone
                        PhoneCallStatus.RINGING -> Icons.Default.PhoneInTalk
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Icons.Default.PhoneMissed
                        else -> Icons.Default.Phone
                    },
                    contentDescription = null,
                    tint = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50)
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3)
                        PhoneCallStatus.RINGING -> Color(0xFFFF9800)
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f)) {
                Text(
                    text = call.toName ?: call.formattedToNumber,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = stringResource(call.status.labelRes),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    call.recordingDuration?.let {
                        Text(
                            text = "• ${call.formattedDuration}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatCallDate(call.startedAt ?: call.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { onCallClick(call) }) {
                Icon(
                    Icons.Default.Phone,
                    contentDescription = stringResource(R.string.ui_call),
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun EmptyCallsContent(hasVerifiedPhone: Boolean, onVerifyClick: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Phone,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.ui_no_calls_yet), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(8.dp))
        Text(
            text = if (hasVerifiedPhone)
                stringResource(R.string.phone_calls_empty_verified)
            else
                stringResource(R.string.phone_calls_empty_unverified),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
        if (!hasVerifiedPhone) {
            Spacer(Modifier.height(24.dp))
            Button(onClick = onVerifyClick) {
                Icon(Icons.Default.Phone, null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.ui_verify_phone_number))
            }
        }
    }
}

@Composable
private fun DialerContent(
    dialerNumber: String,
    hasVerifiedPhone: Boolean,
    onNumberChange: (String) -> Unit,
    onDigitClick: (String) -> Unit,
    onDeleteClick: () -> Unit,
    onStartCall: () -> Unit,
    onVerifyPhoneClick: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        OutlinedTextField(
            value = dialerNumber,
            onValueChange = onNumberChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(fontSize = 28.sp, textAlign = TextAlign.Center),
            placeholder = {
                Text(stringResource(R.string.ui_enter_phone_number), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true
        )

        Spacer(Modifier.height(16.dp))

        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            DialPad(onDigitClick = onDigitClick, onDeleteClick = onDeleteClick)
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            FloatingActionButton(
                onClick = { if (hasVerifiedPhone) onStartCall() else onVerifyPhoneClick() },
                containerColor = if (hasVerifiedPhone) Color(0xFF4CAF50) else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(72.dp)
            ) {
                Icon(
                    Icons.Default.Phone,
                    contentDescription = stringResource(R.string.ui_call),
                    tint = Color.White,
                    modifier = Modifier.size(32.dp)
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(stringResource(R.string.ui_call), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!hasVerifiedPhone) {
                Text(
                    stringResource(R.string.ui_verify_phone_to_call),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun DialPad(onDigitClick: (String) -> Unit, onDeleteClick: () -> Unit) {
    val digits = listOf(
        listOf("1" to "", "2" to "ABC", "3" to "DEF"),
        listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
        listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ"),
        listOf("*" to "", "0" to "+", "#" to "")
    )
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        digits.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                row.forEach { (digit, letters) ->
                    DialPadButton(digit = digit, letters = letters, onClick = { onDigitClick(digit) })
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Spacer(Modifier.size(72.dp))
            DialPadButton(digit = "+", letters = "", onClick = { onDigitClick("+") })
            IconButton(onClick = onDeleteClick, modifier = Modifier.size(72.dp)) {
                Icon(Icons.Default.Backspace, contentDescription = stringResource(R.string.delete))
            }
        }
    }
}

@Composable
private fun DialPadButton(digit: String, letters: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.size(72.dp),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(text = digit, style = MaterialTheme.typography.headlineMedium)
            if (letters.isNotEmpty()) {
                Text(
                    text = letters,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ActiveCallSheet(
    call: PhoneCall?,
    callState: ActiveCallState,
    isMuted: Boolean,
    isSpeakerOn: Boolean,
    onToggleMute: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onHangup: () -> Unit,
    onDismiss: () -> Unit,
) {
    if (call == null) return

    val isCallActive = callState in listOf(
        ActiveCallState.INITIATING,
        ActiveCallState.RINGING,
        ActiveCallState.CONNECTED,
        ActiveCallState.RECORDING
    )

    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { value ->
            if (isCallActive) value != SheetValue.Hidden else true
        }
    )

    ModalBottomSheet(
        onDismissRequest = { if (!isCallActive) onDismiss() },
        sheetState = sheetState,
        dragHandle = if (isCallActive) ({ /* hidden during active call */ }) else null
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (callState == ActiveCallState.CONNECTED || callState == ActiveCallState.RECORDING) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(Color.Red))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.rec_channel_recording), color = Color.Red, fontWeight = FontWeight.Bold)
                }
            }

            val statusText = when (callState) {
                ActiveCallState.INITIATING -> stringResource(R.string.phone_status_connecting)
                ActiveCallState.RINGING -> stringResource(R.string.phone_status_ringing_dots)
                ActiveCallState.CONNECTED, ActiveCallState.RECORDING -> stringResource(R.string.phone_status_connected_recording)
                ActiveCallState.ENDED -> stringResource(R.string.phone_status_call_ended)
                ActiveCallState.DECLINED -> stringResource(R.string.phone_status_call_declined)
                ActiveCallState.BUSY -> stringResource(R.string.phone_status_line_busy)
                ActiveCallState.NO_ANSWER -> stringResource(R.string.phone_status_no_answer)
                ActiveCallState.ERROR -> stringResource(R.string.phone_status_call_failed)
                else -> ""
            }
            val statusColor = when (callState) {
                ActiveCallState.DECLINED, ActiveCallState.BUSY, ActiveCallState.NO_ANSWER, ActiveCallState.ERROR ->
                    MaterialTheme.colorScheme.error
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyMedium,
                color = statusColor,
                fontWeight = if (callState in listOf(
                        ActiveCallState.DECLINED, ActiveCallState.BUSY,
                        ActiveCallState.NO_ANSWER, ActiveCallState.ERROR
                    )
                ) FontWeight.Bold else FontWeight.Normal
            )

            Spacer(Modifier.height(16.dp))

            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(50.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.height(16.dp))

            Text(
                text = call.toName ?: call.formattedToNumber,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            if (call.toName != null) {
                Text(
                    text = call.formattedToNumber,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.height(32.dp))

            Row(
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleMute,
                        containerColor = if (isMuted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                            contentDescription = stringResource(if (isMuted) R.string.phone_unmute else R.string.phone_mute),
                            tint = if (isMuted) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(if (isMuted) R.string.phone_unmute else R.string.phone_mute), style = MaterialTheme.typography.labelSmall)
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onHangup,
                        containerColor = Color.Red,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            Icons.Default.CallEnd,
                            contentDescription = stringResource(R.string.ui_end_call),
                            modifier = Modifier.size(32.dp),
                            tint = Color.White
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.ui_end_call), style = MaterialTheme.typography.labelSmall)
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleSpeaker,
                        containerColor = if (isSpeakerOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.VolumeDown,
                            contentDescription = stringResource(if (isSpeakerOn) R.string.phone_speaker_off else R.string.phone_speaker_on),
                            tint = if (isSpeakerOn) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.ui_speaker), style = MaterialTheme.typography.labelSmall)
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VerificationBottomSheet(
    verificationState: VerificationState,
    verificationPhoneNumber: String,
    verificationCode: String,
    verificationError: String?,
    verifiedPhones: List<VerifiedPhone>,
    onPhoneNumberChange: (String) -> Unit,
    onCodeChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onVerify: () -> Unit,
    onReset: () -> Unit,
    onDeletePhone: (VerifiedPhone) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(stringResource(R.string.ui_verify_phone_number), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(24.dp))

            when (verificationState) {
                VerificationState.IDLE, VerificationState.SENDING_CODE -> {
                    Text(
                        stringResource(R.string.ui_enter_your_phone_number_we),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = verificationPhoneNumber,
                        onValueChange = onPhoneNumberChange,
                        label = { Text(stringResource(R.string.ui_phone_number)) },
                        placeholder = { Text("+1 (555) 123-4567") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = onSendCode,
                        enabled = verificationPhoneNumber.isNotBlank() && verificationState != VerificationState.SENDING_CODE,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (verificationState == VerificationState.SENDING_CODE) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White)
                        } else {
                            Text(stringResource(R.string.ui_call_me_with_code))
                        }
                    }
                }

                VerificationState.CODE_SENT, VerificationState.VERIFYING -> {
                    Text(
                        stringResource(R.string.ui_answer_your_phone_enter_the),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(verificationPhoneNumber, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = verificationCode,
                        onValueChange = { if (it.length <= 6) onCodeChange(it) },
                        label = { Text(stringResource(R.string.ui_verification_code)) },
                        placeholder = { Text("123456") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        textStyle = LocalTextStyle.current.copy(
                            fontSize = 24.sp,
                            textAlign = TextAlign.Center,
                            letterSpacing = 8.sp
                        )
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = onVerify,
                        enabled = verificationCode.length == 6 && verificationState != VerificationState.VERIFYING,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        if (verificationState == VerificationState.VERIFYING) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.White)
                        } else {
                            Text(stringResource(R.string.ui_verify))
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    TextButton(onClick = onReset) { Text(stringResource(R.string.ui_request_new_code)) }
                }

                VerificationState.VERIFIED -> {
                    Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF4CAF50), modifier = Modifier.size(64.dp))
                    Spacer(Modifier.height(16.dp))
                    Text(stringResource(R.string.ui_phone_verified), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color(0xFF4CAF50))
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.ui_you_can_now_make_calls), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = onDismiss,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) { Text(stringResource(R.string.done)) }
                }

                VerificationState.ERROR -> {
                    Icon(Icons.Default.Error, null, tint = Color.Red, modifier = Modifier.size(64.dp))
                    Spacer(Modifier.height(16.dp))
                    Text(stringResource(R.string.ui_verification_failed), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Color.Red)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        verificationError ?: stringResource(R.string.phone_error_generic),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(24.dp))
                    Button(
                        onClick = onReset,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) { Text(stringResource(R.string.try_again)) }
                }
            }

            if (verifiedPhones.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                Divider()
                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.ui_verified_numbers),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Start
                )
                Spacer(Modifier.height(8.dp))
                verifiedPhones.forEach { phone ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF4CAF50))
                        Spacer(Modifier.width(12.dp))
                        Text(phone.formattedPhoneNumber, modifier = Modifier.weight(1f))
                        IconButton(onClick = { onDeletePhone(phone) }) {
                            Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.delete), tint = Color.Red)
                        }
                    }
                }
            }

            Spacer(Modifier.height(32.dp))
        }
    }
}

private fun formatCallDate(dateString: String): String {
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = parser.parse(dateString) ?: return dateString
        val now = Calendar.getInstance()
        val callDate = Calendar.getInstance().apply { time = date }
        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        val dateFormat = SimpleDateFormat("MMM d", Locale.getDefault())
        when {
            now.get(Calendar.DAY_OF_YEAR) == callDate.get(Calendar.DAY_OF_YEAR) &&
                now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) ->
                AppStrings.get(R.string.phone_date_today, timeFormat.format(date))
            now.get(Calendar.DAY_OF_YEAR) - 1 == callDate.get(Calendar.DAY_OF_YEAR) &&
                now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) ->
                AppStrings.get(R.string.phone_date_yesterday, timeFormat.format(date))
            else -> AppStrings.get(R.string.phone_date_time, dateFormat.format(date), timeFormat.format(date))
        }
    } catch (_: Exception) {
        dateString
    }
}
