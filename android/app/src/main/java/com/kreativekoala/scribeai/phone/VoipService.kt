package com.kreativekoala.scribeai.phone

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.twilio.voice.Call
import com.twilio.voice.CallException
import com.twilio.voice.ConnectOptions
import com.twilio.voice.Voice
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Reason a call ended.
 */
enum class CallEndReason(val displayMessage: String) {
    COMPLETED("Call ended"),
    DECLINED("Call was declined"),
    BUSY("Line is busy"),
    NO_ANSWER("No answer"),
    CANCELLED("Call cancelled"),
    FAILED("Call failed"),
    UNKNOWN("Call ended")
}

/**
 * VoIP call state surfaced to the UI.
 */
sealed class VoipCallState {
    object Idle : VoipCallState()
    object Connecting : VoipCallState()
    object Ringing : VoipCallState()
    object Connected : VoipCallState()
    data class Disconnected(val reason: CallEndReason, val message: String? = null) : VoipCallState()
    data class Failed(val error: String) : VoipCallState()
}

/**
 * Process-lifetime singleton wrapping Twilio's Voice SDK. Ported from
 * Meeting Mind. Hilt stripped — ScribeAI Android doesn't use Hilt, so the
 * UI initialises this via `VoipService.init(context.applicationContext)`
 * once at app start and reads `VoipService.shared` thereafter.
 */
class VoipService private constructor(private val appContext: Context) {

    companion object {
        private const val TAG = "VoipService"

        @Volatile private var instance: VoipService? = null

        fun init(appContext: Context) {
            if (instance == null) {
                synchronized(this) {
                    if (instance == null) instance = VoipService(appContext)
                }
            }
        }

        val shared: VoipService
            get() = instance ?: error("VoipService.init(context) must be called first")
    }

    private var activeCall: Call? = null
    private var accessToken: String? = null

    private val _callState = MutableStateFlow<VoipCallState>(VoipCallState.Idle)
    val callState: StateFlow<VoipCallState> = _callState.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isSpeakerOn = MutableStateFlow(false)
    val isSpeakerOn: StateFlow<Boolean> = _isSpeakerOn.asStateFlow()

    private val audioManager: AudioManager by lazy {
        appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    // Snapshot of pre-call audio state so we can restore it on disconnect
    // instead of forcing MODE_NORMAL / speakerphone=false unconditionally.
    private var savedAudioMode: Int = AudioManager.MODE_NORMAL
    private var savedSpeakerphoneOn: Boolean = false

    fun setAccessToken(token: String) {
        accessToken = token
        Log.d(TAG, "Access token set")
    }

    fun makeCall(callId: String, toNumber: String): Boolean {
        val token = accessToken
        if (token == null) {
            Log.e(TAG, "No access token set")
            _callState.value = VoipCallState.Failed("No access token")
            return false
        }
        if (activeCall != null) {
            Log.w(TAG, "Call already in progress")
            return false
        }

        try {
            _callState.value = VoipCallState.Connecting

            // Audio routing must be configured BEFORE Voice.connect — Twilio's
            // audio stack snapshots AudioManager state on connect. Setting
            // these inside onConnected leaves the device routing to the
            // earpiece, which sounds like "I can't hear the other end" if the
            // phone isn't pressed to the ear. Default to speakerphone to match
            // iOS behavior.
            savedAudioMode = audioManager.mode
            savedSpeakerphoneOn = audioManager.isSpeakerphoneOn
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
            _isSpeakerOn.value = true
            Log.d(TAG, "Audio prepared: mode=IN_COMMUNICATION, speaker=true (was mode=$savedAudioMode, speaker=$savedSpeakerphoneOn)")

            val params = HashMap<String, String>().apply {
                put("call_id", callId)
                put("to", toNumber)
            }
            val connectOptions = ConnectOptions.Builder(token).params(params).build()
            Log.d(TAG, "Making VoIP call to $toNumber with call_id=$callId")
            activeCall = Voice.connect(appContext, connectOptions, callListener)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to make call", e)
            _callState.value = VoipCallState.Failed(e.message ?: "Unknown error")
            return false
        }
    }

    fun disconnect() {
        activeCall?.disconnect()
        activeCall = null
        _callState.value = VoipCallState.Disconnected(CallEndReason.CANCELLED)
        resetAudio()
    }

    fun toggleMute() {
        activeCall?.let { call ->
            val newMuteState = !_isMuted.value
            call.mute(newMuteState)
            _isMuted.value = newMuteState
        }
    }

    fun toggleSpeaker() {
        val newState = !_isSpeakerOn.value
        audioManager.isSpeakerphoneOn = newState
        _isSpeakerOn.value = newState
    }

    fun hasActiveCall(): Boolean = activeCall != null

    private fun resetAudio() {
        _isMuted.value = false
        _isSpeakerOn.value = false
        // Restore the audio state we snapshotted in makeCall(). Don't force
        // MODE_NORMAL / speakerphone=false — that overwrites whatever was
        // running before the call and can mute MEDIA stream playback.
        audioManager.isSpeakerphoneOn = savedSpeakerphoneOn
        audioManager.mode = savedAudioMode
    }

    private val callListener = object : Call.Listener {
        override fun onConnectFailure(call: Call, callException: CallException) {
            Log.e(TAG, "Connect failure: ${callException.message}", callException)
            activeCall = null
            _callState.value = VoipCallState.Failed(callException.message ?: "Connection failed")
            resetAudio()
        }
        override fun onRinging(call: Call) {
            _callState.value = VoipCallState.Ringing
        }
        override fun onConnected(call: Call) {
            _callState.value = VoipCallState.Connected
            // Audio mode + speaker were set BEFORE Voice.connect in makeCall().
            // Touching them here fights Twilio's audio stack and causes the
            // "I can't hear the other end" routing bug.
        }
        override fun onReconnecting(call: Call, callException: CallException) { /* no-op */ }
        override fun onReconnected(call: Call) {
            _callState.value = VoipCallState.Connected
        }
        override fun onDisconnected(call: Call, callException: CallException?) {
            activeCall = null
            val reason = parseDisconnectReason(callException)
            _callState.value = VoipCallState.Disconnected(reason, callException?.message)
            // resetAudio() restores mode + speakerphone via the saved snapshot.
            resetAudio()
        }
    }

    private fun parseDisconnectReason(exception: CallException?): CallEndReason {
        if (exception == null) return CallEndReason.COMPLETED
        val message = exception.message?.lowercase() ?: ""
        val errorCode = exception.errorCode
        return when {
            errorCode == 31005 -> CallEndReason.DECLINED
            errorCode == 31486 -> CallEndReason.BUSY
            errorCode == 31480 -> CallEndReason.NO_ANSWER
            errorCode == 31487 -> CallEndReason.CANCELLED
            message.contains("rejected") || message.contains("declined") -> CallEndReason.DECLINED
            message.contains("busy") -> CallEndReason.BUSY
            message.contains("no answer") || message.contains("timeout") -> CallEndReason.NO_ANSWER
            message.contains("cancel") -> CallEndReason.CANCELLED
            message.contains("failed") || message.contains("error") -> CallEndReason.FAILED
            else -> CallEndReason.UNKNOWN
        }
    }
}
