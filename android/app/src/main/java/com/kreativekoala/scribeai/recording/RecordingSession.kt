package com.kreativekoala.scribeai.recording

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * What the recording service tells the screen. The service and the app share one process, so this is a plain
 * StateFlow rather than an IPC channel. The service owns the recording; the screen only watches and sends commands.
 * If the process dies, this resets to idle and launch-time recovery finds the unfinished file on disk.
 */
object RecordingSession {
    enum class Warning { NO_SOUND, LOW_SOUND, MIC_SILENCED, LOW_STORAGE, LOW_BATTERY }

    enum class StartError { NO_PERMISSION, LOW_STORAGE, NOT_ALLOWED, RECORDER_FAILED }

    /** Outcome of the last recording that ended while nobody had consumed it. */
    data class StopResult(
        val recordingId: String,
        val reason: StopReason,
        val cause: StopCause,
        val durationMs: Long,
        /** False when the recording was too short to keep and was deleted. */
        val kept: Boolean,
        val allSilent: Boolean
    )

    data class Snapshot(
        val phase: RecPhase = RecPhase.IDLE,
        val interruption: Interruption? = null,
        val recordingId: String? = null,
        val elapsedMs: Long = 0L,
        /** Loudest-sample reading of the last interval, 0..32767, for the level display. */
        val amplitude: Int = 0,
        val warnings: Set<Warning> = emptySet(),
        val result: StopResult? = null,
        val startError: StartError? = null
    ) {
        val isActive: Boolean get() = phase == RecPhase.STARTING || phase == RecPhase.RECORDING ||
            phase == RecPhase.PAUSED_BY_USER || phase == RecPhase.PAUSED_BY_INTERRUPTION
        val isPaused: Boolean get() = phase == RecPhase.PAUSED_BY_USER || phase == RecPhase.PAUSED_BY_INTERRUPTION
    }

    private val _state = MutableStateFlow(Snapshot())
    val state: StateFlow<Snapshot> = _state

    fun update(change: (Snapshot) -> Snapshot) { _state.value = change(_state.value) }

    /** The screen calls this after it has taken over a finished recording (or shown why there is none). */
    fun consumeResult() { update { it.copy(result = null, startError = null) } }
}
