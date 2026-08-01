package com.kreativekoala.scribeai.phone

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.utils.AuthManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class PhoneTab { CALLS, DIALER }

enum class VerificationState { IDLE, SENDING_CODE, CODE_SENT, VERIFYING, VERIFIED, ERROR }

enum class ActiveCallState {
    NONE, INITIATING, RINGING, CONNECTED, RECORDING,
    ENDED, DECLINED, BUSY, NO_ANSWER, ERROR
}

data class PhoneUiState(
    val verifiedPhones: List<VerifiedPhone> = emptyList(),
    val phoneCalls: List<PhoneCall> = emptyList(),
    val selectedPhone: VerifiedPhone? = null,
    val selectedTab: PhoneTab = PhoneTab.CALLS,
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val hasMoreCalls: Boolean = true,
    val verificationState: VerificationState = VerificationState.IDLE,
    val verificationPhoneNumber: String = "",
    val verificationCode: String = "",
    val verificationError: String? = null,
    val dialerNumber: String = "",
    val dialerContactName: String = "",
    val showRecordingConsentDialog: Boolean = false,
    val activeCallState: ActiveCallState = ActiveCallState.NONE,
    val activeCall: PhoneCall? = null,
    val error: String? = null
) {
    val hasVerifiedPhones: Boolean get() = verifiedPhones.isNotEmpty()
    val hasActiveCall: Boolean
        get() = activeCall != null &&
            activeCallState != ActiveCallState.NONE &&
            activeCallState != ActiveCallState.ENDED
}

/**
 * Plain ViewModel (no Hilt). Caller passes the AuthManager via factory, and the
 * VM observes `VoipService.shared` directly. Mirrors `PhoneViewModel.swift` on
 * iOS (which also reads `VoipService.shared`).
 */
class PhoneViewModel(
    private val authManager: AuthManager
) : ViewModel() {

    private val repo = PhoneRepository()
    private val voip: VoipService get() = VoipService.shared

    private val _uiState = MutableStateFlow(PhoneUiState())
    val uiState: StateFlow<PhoneUiState> = _uiState.asStateFlow()

    val voipCallState: StateFlow<VoipCallState> get() = voip.callState
    val isMuted: StateFlow<Boolean> get() = voip.isMuted
    val isSpeakerOn: StateFlow<Boolean> get() = voip.isSpeakerOn

    private var pollingJob: Job? = null
    private var voipStateJob: Job? = null
    private var currentOffset = 0
    private val limit = 50
    private var currentCallId: String? = null

    init {
        loadData()
        observeVoipState()
    }

    private fun observeVoipState() {
        voipStateJob = viewModelScope.launch {
            voip.callState.collect { state ->
                val newActive = when (state) {
                    is VoipCallState.Idle -> ActiveCallState.NONE
                    is VoipCallState.Connecting -> ActiveCallState.INITIATING
                    is VoipCallState.Ringing -> ActiveCallState.RINGING
                    is VoipCallState.Connected -> ActiveCallState.RECORDING
                    is VoipCallState.Disconnected -> when (state.reason) {
                        CallEndReason.DECLINED -> ActiveCallState.DECLINED
                        CallEndReason.BUSY -> ActiveCallState.BUSY
                        CallEndReason.NO_ANSWER -> ActiveCallState.NO_ANSWER
                        CallEndReason.FAILED -> ActiveCallState.ERROR
                        else -> ActiveCallState.ENDED
                    }
                    is VoipCallState.Failed -> ActiveCallState.ERROR
                }
                _uiState.value = _uiState.value.copy(activeCallState = newActive)

                if (state is VoipCallState.Disconnected) {
                    if (state.reason != CallEndReason.COMPLETED &&
                        state.reason != CallEndReason.CANCELLED
                    ) {
                        _uiState.value = _uiState.value.copy(error = state.reason.displayMessage)
                    }
                    delay(3000)
                    clearActiveCall()
                    refresh()
                }

                if (state is VoipCallState.Failed) {
                    _uiState.value = _uiState.value.copy(error = state.error)
                    delay(2000)
                    clearActiveCall()
                }
            }
        }
    }

    // MARK: - Tabs

    fun selectTab(tab: PhoneTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    // MARK: - Loading

    fun loadData() {
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: run {
                _uiState.value = _uiState.value.copy(error = "Sign in required")
                return@launch
            }
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            repo.getVerifiedPhones(token).fold(
                onSuccess = { phones ->
                    val selected = _uiState.value.selectedPhone ?: phones.firstOrNull()
                    _uiState.value = _uiState.value.copy(
                        verifiedPhones = phones,
                        selectedPhone = selected
                    )
                },
                onFailure = {
                    _uiState.value = _uiState.value.copy(error = "Couldn't load phones")
                }
            )

            currentOffset = 0
            repo.getPhoneCalls(token, limit, 0).fold(
                onSuccess = { result ->
                    _uiState.value = _uiState.value.copy(
                        phoneCalls = result.calls,
                        hasMoreCalls = result.hasMore,
                        isLoading = false
                    )
                },
                onFailure = {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "Couldn't load calls"
                    )
                }
            )
        }
    }

    fun refresh() {
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            _uiState.value = _uiState.value.copy(isRefreshing = true)

            repo.getVerifiedPhones(token).onSuccess { phones ->
                _uiState.value = _uiState.value.copy(verifiedPhones = phones)
            }

            currentOffset = 0
            repo.getPhoneCalls(token, limit, 0).fold(
                onSuccess = { result ->
                    _uiState.value = _uiState.value.copy(
                        phoneCalls = result.calls,
                        hasMoreCalls = result.hasMore,
                        isRefreshing = false
                    )
                },
                onFailure = {
                    _uiState.value = _uiState.value.copy(isRefreshing = false)
                }
            )
        }
    }

    fun loadMoreCalls() {
        if (_uiState.value.isLoading || !_uiState.value.hasMoreCalls) return
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            val nextOffset = currentOffset + limit
            repo.getPhoneCalls(token, limit, nextOffset).onSuccess { result ->
                currentOffset = nextOffset
                _uiState.value = _uiState.value.copy(
                    phoneCalls = _uiState.value.phoneCalls + result.calls,
                    hasMoreCalls = result.hasMore
                )
            }
        }
    }

    fun selectPhone(phone: VerifiedPhone) {
        _uiState.value = _uiState.value.copy(selectedPhone = phone)
    }

    // MARK: - Verification

    fun updateVerificationPhoneNumber(s: String) {
        _uiState.value = _uiState.value.copy(verificationPhoneNumber = s)
    }

    fun updateVerificationCode(s: String) {
        _uiState.value = _uiState.value.copy(verificationCode = s)
    }

    fun sendVerificationCode() {
        val phoneNumber = _uiState.value.verificationPhoneNumber
        if (phoneNumber.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Enter a phone number")
            return
        }
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            _uiState.value = _uiState.value.copy(verificationState = VerificationState.SENDING_CODE)

            repo.sendVerificationCode(token, phoneNumber).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(verificationState = VerificationState.CODE_SENT)
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        verificationState = VerificationState.ERROR,
                        verificationError = error.message
                    )
                }
            )
        }
    }

    fun checkVerificationCode() {
        val code = _uiState.value.verificationCode
        if (code.length != 6) {
            _uiState.value = _uiState.value.copy(error = "Enter the 6-digit code")
            return
        }
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            _uiState.value = _uiState.value.copy(verificationState = VerificationState.VERIFYING)

            repo.checkVerificationCode(token, _uiState.value.verificationPhoneNumber, code).fold(
                onSuccess = { phone ->
                    if (phone != null) {
                        val phones = _uiState.value.verifiedPhones + phone
                        _uiState.value = _uiState.value.copy(
                            verifiedPhones = phones,
                            selectedPhone = _uiState.value.selectedPhone ?: phone,
                            verificationState = VerificationState.VERIFIED,
                            verificationPhoneNumber = "",
                            verificationCode = ""
                        )
                    } else {
                        _uiState.value = _uiState.value.copy(
                            verificationState = VerificationState.ERROR,
                            verificationError = "Invalid verification code"
                        )
                    }
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        verificationState = VerificationState.ERROR,
                        verificationError = error.message
                    )
                }
            )
        }
    }

    fun resetVerification() {
        _uiState.value = _uiState.value.copy(
            verificationState = VerificationState.IDLE,
            verificationPhoneNumber = "",
            verificationCode = "",
            verificationError = null
        )
    }

    fun deleteVerifiedPhone(phone: VerifiedPhone) {
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            repo.deleteVerifiedPhone(token, phone.id).onSuccess {
                val phones = _uiState.value.verifiedPhones.filter { it.id != phone.id }
                val selected = if (_uiState.value.selectedPhone?.id == phone.id) {
                    phones.firstOrNull()
                } else _uiState.value.selectedPhone
                _uiState.value = _uiState.value.copy(
                    verifiedPhones = phones,
                    selectedPhone = selected
                )
            }
        }
    }

    // MARK: - Dialer

    fun updateDialerNumber(s: String) {
        _uiState.value = _uiState.value.copy(dialerNumber = s)
    }

    fun updateDialerContactName(s: String) {
        _uiState.value = _uiState.value.copy(dialerContactName = s)
    }

    fun appendDialerDigit(d: String) {
        _uiState.value = _uiState.value.copy(dialerNumber = _uiState.value.dialerNumber + d)
    }

    fun deleteDialerDigit() {
        val cur = _uiState.value.dialerNumber
        if (cur.isNotEmpty()) {
            _uiState.value = _uiState.value.copy(dialerNumber = cur.dropLast(1))
        }
    }

    fun showConsentDialog() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = true)
    }

    fun dismissConsentDialog() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = false)
    }

    fun acceptConsentAndCall() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = false)
        initiateCall()
    }

    fun callFromHistory(call: PhoneCall) {
        _uiState.value = _uiState.value.copy(
            selectedTab = PhoneTab.DIALER,
            dialerNumber = call.toNumber,
            dialerContactName = call.toName ?: "",
            showRecordingConsentDialog = false
        )
        initiateCall()
    }

    // MARK: - Call

    fun initiateCall() {
        val selectedPhone = _uiState.value.selectedPhone
        if (selectedPhone == null) {
            _uiState.value = _uiState.value.copy(error = "Verify a phone number first")
            return
        }
        val number = _uiState.value.dialerNumber
        if (number.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Enter a number to call")
            return
        }
        val digitCount = number.count { it.isDigit() }
        if (digitCount < 10) {
            _uiState.value = _uiState.value.copy(error = "Enter a complete 10-digit number")
            return
        }

        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: run {
                _uiState.value = _uiState.value.copy(error = "Sign in required")
                return@launch
            }
            _uiState.value = _uiState.value.copy(
                activeCallState = ActiveCallState.INITIATING,
                showRecordingConsentDialog = false
            )

            val voipToken = repo.getVoipToken(token).getOrElse {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = "Couldn't get VoIP token"
                )
                return@launch
            }
            voip.setAccessToken(voipToken)

            val callDetails = repo.createCall(
                token,
                fromNumber = selectedPhone.phoneNumber,
                toNumber = number,
                toName = _uiState.value.dialerContactName.ifBlank { null }
            ).getOrElse {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = "Couldn't create call"
                )
                return@launch
            }
            currentCallId = callDetails.callId

            repo.getPhoneCall(token, callDetails.callId).onSuccess { call ->
                _uiState.value = _uiState.value.copy(
                    activeCall = call,
                    phoneCalls = listOf(call) + _uiState.value.phoneCalls,
                    dialerNumber = "",
                    dialerContactName = ""
                )
            }

            val ok = voip.makeCall(callDetails.callId, callDetails.toNumber)
            if (!ok) {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = "Couldn't start VoIP call"
                )
                return@launch
            }
            startCallPolling(token, callDetails.callId)
        }
    }

    fun toggleMute() = voip.toggleMute()
    fun toggleSpeaker() = voip.toggleSpeaker()

    fun hangupCall() {
        voip.disconnect()
        val call = _uiState.value.activeCall ?: return
        viewModelScope.launch {
            val token = authManager.getFreshToken() ?: return@launch
            repo.hangupCall(token, call.id).onSuccess {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ENDED,
                    activeCall = call.copy(status = PhoneCallStatus.COMPLETED)
                )
                stopCallPolling()
                viewModelScope.launch {
                    delay(2000)
                    _uiState.value = _uiState.value.copy(
                        activeCall = null,
                        activeCallState = ActiveCallState.NONE
                    )
                    refresh()
                }
            }
        }
    }

    fun clearActiveCall() {
        voip.disconnect()
        stopCallPolling()
        currentCallId = null
        _uiState.value = _uiState.value.copy(
            activeCall = null,
            activeCallState = ActiveCallState.NONE
        )
    }

    private fun startCallPolling(token: String, callId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            repo.pollCallStatus(token, callId).collect { call ->
                _uiState.value = _uiState.value.copy(activeCall = call)
                updateCallInList(call)

                val newState = when (call.status) {
                    PhoneCallStatus.RINGING -> ActiveCallState.RINGING
                    PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> ActiveCallState.RECORDING
                    PhoneCallStatus.COMPLETED, PhoneCallStatus.FAILED,
                    PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER,
                    PhoneCallStatus.CANCELLED -> ActiveCallState.ENDED
                    else -> _uiState.value.activeCallState
                }
                _uiState.value = _uiState.value.copy(activeCallState = newState)

                if (newState == ActiveCallState.ENDED) {
                    delay(2000)
                    _uiState.value = _uiState.value.copy(
                        activeCall = null,
                        activeCallState = ActiveCallState.NONE
                    )
                }
            }
        }
    }

    private fun stopCallPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    private fun updateCallInList(call: PhoneCall) {
        val calls = _uiState.value.phoneCalls.map { if (it.id == call.id) call else it }
        _uiState.value = _uiState.value.copy(phoneCalls = calls)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        voip.disconnect()
        stopCallPolling()
        voipStateJob?.cancel()
    }
}
