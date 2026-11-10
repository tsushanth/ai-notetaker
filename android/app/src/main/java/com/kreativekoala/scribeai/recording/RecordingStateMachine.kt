package com.kreativekoala.scribeai.recording

/**
 * Why a recording ended. These five values are what the analytics event carries; [StopCause] holds the finer reason
 * (it goes in the event's `detail` field).
 */
enum class StopReason(val wire: String) {
    USER("user"),
    LOCK("lock"),
    BACKGROUND("background"),
    PROCESS_DEATH("process_death"),
    ERROR("error")
}

/** What actually triggered the stop. */
enum class StopCause(val wire: String, val userInitiated: Boolean) {
    USER_BUTTON("stop_button", true),
    NOTIFICATION_STOP("notification_stop", true),
    TASK_REMOVED("task_removed", false),
    LOW_STORAGE("low_storage", false),
    LOW_BATTERY("low_battery", false),
    MAX_SIZE("max_size", false),
    RECORDER_ERROR("recorder_error", false),
    FOCUS_LOST("audio_focus_lost", false),
    SERVICE_DESTROYED("service_destroyed", false),
    START_FAILED("start_failed", false),
    /** Found unfinished at the next launch: the process (and its service) was killed. */
    PROCESS_DIED("process_death", false);

    companion object {
        /**
         * Maps a cause plus what the device was doing to the reason that goes in the event:
         * user actions are USER; everything else is LOCK if the screen was off, BACKGROUND if the app was not on
         * screen, otherwise ERROR. A process found dead at the next launch is always PROCESS_DEATH.
         */
        fun classify(cause: StopCause, screenInteractive: Boolean, appInForeground: Boolean): StopReason = when {
            cause == PROCESS_DIED -> StopReason.PROCESS_DEATH
            cause.userInitiated -> StopReason.USER
            !screenInteractive -> StopReason.LOCK
            !appInForeground -> StopReason.BACKGROUND
            else -> StopReason.ERROR
        }
    }
}

enum class Interruption(val wire: String) {
    /** Phone call, alarm or another app took audio focus for a short time; recording resumes by itself. */
    FOCUS_TRANSIENT("focus_transient"),
    /** Another app took audio focus for good; the user resumes by hand. */
    FOCUS_LOST("focus_lost")
}

enum class RecPhase { IDLE, STARTING, RECORDING, PAUSED_BY_USER, PAUSED_BY_INTERRUPTION, STOPPED }

data class RecState(
    val phase: RecPhase = RecPhase.IDLE,
    val interruption: Interruption? = null,
    val stopReason: StopReason? = null,
    val stopCause: StopCause? = null
) {
    val isActive: Boolean get() = phase == RecPhase.STARTING || phase == RecPhase.RECORDING ||
        phase == RecPhase.PAUSED_BY_USER || phase == RecPhase.PAUSED_BY_INTERRUPTION
    val isPaused: Boolean get() = phase == RecPhase.PAUSED_BY_USER || phase == RecPhase.PAUSED_BY_INTERRUPTION
}

sealed interface RecEvent {
    data object StartRequested : RecEvent
    data object RecorderStarted : RecEvent
    data object UserPause : RecEvent
    data object UserResume : RecEvent
    data class InterruptionBegan(val kind: Interruption) : RecEvent
    /** Audio focus came back after a transient loss. */
    data object InterruptionEnded : RecEvent
    data class StopRequested(val cause: StopCause, val screenInteractive: Boolean = true, val appInForeground: Boolean = true) : RecEvent
    /** The device was found with an unfinished recording and no running service. */
    data object ProcessDied : RecEvent
    /** Back to idle after the result has been handed over. */
    data object Reset : RecEvent
}

/** What the service must do as a result of a transition (the machine itself touches nothing). */
enum class RecEffect { START_RECORDER, PAUSE_RECORDER, RESUME_RECORDER, STOP_RECORDER }

data class Transition(val state: RecState, val effects: List<RecEffect> = emptyList())

/**
 * Pure reducer for one recording session. Invalid events (a pause while idle, a second start, ...) leave the state
 * unchanged and produce no effects, so a double tap or a late callback cannot corrupt a recording.
 */
object RecordingStateMachine {
    fun reduce(state: RecState, event: RecEvent): Transition = when (event) {
        RecEvent.StartRequested ->
            if (state.phase == RecPhase.IDLE) Transition(RecState(RecPhase.STARTING), listOf(RecEffect.START_RECORDER))
            else Transition(state)

        RecEvent.RecorderStarted ->
            if (state.phase == RecPhase.STARTING) Transition(RecState(RecPhase.RECORDING)) else Transition(state)

        RecEvent.UserPause -> when (state.phase) {
            RecPhase.RECORDING -> Transition(RecState(RecPhase.PAUSED_BY_USER), listOf(RecEffect.PAUSE_RECORDER))
            // Already paused by an interruption: the recorder is paused; the user's pause just takes ownership.
            RecPhase.PAUSED_BY_INTERRUPTION -> Transition(RecState(RecPhase.PAUSED_BY_USER))
            else -> Transition(state)
        }

        RecEvent.UserResume -> when (state.phase) {
            RecPhase.PAUSED_BY_USER, RecPhase.PAUSED_BY_INTERRUPTION ->
                Transition(RecState(RecPhase.RECORDING), listOf(RecEffect.RESUME_RECORDER))
            else -> Transition(state)
        }

        is RecEvent.InterruptionBegan -> when (state.phase) {
            RecPhase.RECORDING ->
                Transition(RecState(RecPhase.PAUSED_BY_INTERRUPTION, interruption = event.kind), listOf(RecEffect.PAUSE_RECORDER))
            // A user pause stays a user pause; a transient loss while paused by an interruption may become permanent.
            RecPhase.PAUSED_BY_INTERRUPTION ->
                Transition(state.copy(interruption = event.kind))
            else -> Transition(state)
        }

        RecEvent.InterruptionEnded ->
            if (state.phase == RecPhase.PAUSED_BY_INTERRUPTION && state.interruption == Interruption.FOCUS_TRANSIENT)
                Transition(RecState(RecPhase.RECORDING), listOf(RecEffect.RESUME_RECORDER))
            else Transition(state)

        is RecEvent.StopRequested ->
            if (state.isActive) {
                val reason = StopCause.classify(event.cause, event.screenInteractive, event.appInForeground)
                Transition(RecState(RecPhase.STOPPED, stopReason = reason, stopCause = event.cause), listOf(RecEffect.STOP_RECORDER))
            } else Transition(state)

        RecEvent.ProcessDied ->
            if (state.phase == RecPhase.IDLE)
                Transition(RecState(RecPhase.STOPPED, stopReason = StopReason.PROCESS_DEATH, stopCause = StopCause.PROCESS_DIED))
            else Transition(state)

        RecEvent.Reset ->
            if (state.phase == RecPhase.STOPPED) Transition(RecState()) else Transition(state)
    }
}

/** Active recording time, excluding pauses. Pure so it can be tested with a fake clock. */
class ElapsedTracker {
    private var accumulated = 0L
    private var runningSince: Long? = null

    fun start(now: Long) { accumulated = 0L; runningSince = now }
    fun pause(now: Long) { runningSince?.let { accumulated += now - it }; runningSince = null }
    fun resume(now: Long) { if (runningSince == null) runningSince = now }
    fun elapsed(now: Long): Long = accumulated + (runningSince?.let { now - it } ?: 0L)
    fun stop(now: Long): Long { pause(now); return accumulated }
}
