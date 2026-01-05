package com.kreativekoala.scribeai.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.scribeai.data.models.*
import com.kreativekoala.scribeai.data.repository.MeetingRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

/**
 * UI state for meetings list
 */
sealed class MeetingUiState {
    object Loading : MeetingUiState()
    data class Success(val meetings: List<Meeting>) : MeetingUiState()
    data class Error(val message: String) : MeetingUiState()
}

/**
 * UI state for create meeting operation
 */
sealed class CreateMeetingState {
    object Idle : CreateMeetingState()
    object Loading : CreateMeetingState()
    data class Success(val meeting: Meeting) : CreateMeetingState()
    data class Error(val message: String) : CreateMeetingState()
}

/**
 * ViewModel for meeting bot functionality
 */
class MeetingViewModel : ViewModel() {

    private val repository = MeetingRepository()

    private val _uiState = MutableStateFlow<MeetingUiState>(MeetingUiState.Loading)
    val uiState: StateFlow<MeetingUiState> = _uiState.asStateFlow()

    private val _createState = MutableStateFlow<CreateMeetingState>(CreateMeetingState.Idle)
    val createState: StateFlow<CreateMeetingState> = _createState.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private var pollingJob: Job? = null

    companion object {
        private const val TAG = "MeetingViewModel"
        private const val POLLING_INTERVAL_MS = 5000L
    }

    /**
     * Load meetings for the current user
     */
    fun loadMeetings(token: String) {
        viewModelScope.launch {
            _isRefreshing.value = true
            try {
                repository.getMeetings(token).fold(
                    onSuccess = { response ->
                        val meetings = response.data ?: emptyList()
                        _uiState.value = MeetingUiState.Success(meetings)

                        // Start polling if there are active meetings
                        if (meetings.any { it.isActive }) {
                            startPolling(token)
                        } else {
                            stopPolling()
                        }
                    },
                    onFailure = { error ->
                        _uiState.value = MeetingUiState.Error(error.message ?: "Failed to load meetings")
                    }
                )
            } finally {
                _isRefreshing.value = false
            }
        }
    }

    /**
     * Create a new meeting and deploy bot
     */
    fun createMeeting(token: String, meetingUrl: String, title: String?) {
        viewModelScope.launch {
            _createState.value = CreateMeetingState.Loading
            try {
                repository.createMeeting(token, meetingUrl, title).fold(
                    onSuccess = { response ->
                        response.data?.let {
                            _createState.value = CreateMeetingState.Success(it.meeting)
                            loadMeetings(token) // Refresh list
                        } ?: run {
                            _createState.value = CreateMeetingState.Error(response.error ?: "Unknown error")
                        }
                    },
                    onFailure = { error ->
                        _createState.value = CreateMeetingState.Error(error.message ?: "Failed to create meeting")
                    }
                )
            } catch (e: Exception) {
                _createState.value = CreateMeetingState.Error(e.message ?: "Failed to create meeting")
            }
        }
    }

    /**
     * Cancel a meeting and stop the bot
     */
    fun cancelMeeting(token: String, meetingId: String) {
        viewModelScope.launch {
            repository.cancelMeeting(token, meetingId).fold(
                onSuccess = { loadMeetings(token) },
                onFailure = { Log.e(TAG, "Failed to cancel meeting", it) }
            )
        }
    }

    /**
     * Delete a meeting
     */
    fun deleteMeeting(token: String, meetingId: String) {
        viewModelScope.launch {
            repository.deleteMeeting(token, meetingId).fold(
                onSuccess = {
                    // Update local state immediately
                    val currentState = _uiState.value
                    if (currentState is MeetingUiState.Success) {
                        _uiState.value = MeetingUiState.Success(
                            currentState.meetings.filter { it.id != meetingId }
                        )
                    }
                },
                onFailure = { Log.e(TAG, "Failed to delete meeting", it) }
            )
        }
    }

    /**
     * Reset the create meeting state
     */
    fun resetCreateState() {
        _createState.value = CreateMeetingState.Idle
    }

    /**
     * Start polling for meeting updates
     */
    private fun startPolling(token: String) {
        if (pollingJob?.isActive == true) return

        pollingJob = viewModelScope.launch {
            while (true) {
                delay(POLLING_INTERVAL_MS)
                // Silently reload without changing loading state
                repository.getMeetings(token).onSuccess { response ->
                    val meetings = response.data ?: emptyList()
                    _uiState.value = MeetingUiState.Success(meetings)

                    // Stop polling if no more active meetings
                    if (!meetings.any { it.isActive }) {
                        stopPolling()
                    }
                }
            }
        }
    }

    /**
     * Stop polling
     */
    private fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    override fun onCleared() {
        super.onCleared()
        stopPolling()
    }

    /**
     * Validate a meeting URL locally
     */
    fun validateMeetingUrl(url: String): Pair<Boolean, MeetingPlatform?> {
        return MeetingURLValidator.validate(url)
    }
}
