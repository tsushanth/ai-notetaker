package com.kreativekoala.scribeai.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingStateMachineTest {

    private fun run(vararg events: RecEvent): Pair<RecState, List<RecEffect>> {
        var state = RecState()
        val effects = mutableListOf<RecEffect>()
        for (e in events) {
            val t = RecordingStateMachine.reduce(state, e)
            state = t.state
            effects += t.effects
        }
        return state to effects
    }

    @Test
    fun startThenRecorderStartedMovesToRecording() {
        val (s, fx) = run(RecEvent.StartRequested, RecEvent.RecorderStarted)
        assertEquals(RecPhase.RECORDING, s.phase)
        assertEquals(listOf(RecEffect.START_RECORDER), fx)
    }

    @Test
    fun secondStartWhileActiveIsIgnored() {
        val (s, fx) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.StartRequested)
        assertEquals(RecPhase.RECORDING, s.phase)
        assertEquals(listOf(RecEffect.START_RECORDER), fx) // no second recorder
    }

    @Test
    fun userPauseAndResume() {
        val (s, fx) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.UserPause, RecEvent.UserResume)
        assertEquals(RecPhase.RECORDING, s.phase)
        assertEquals(listOf(RecEffect.START_RECORDER, RecEffect.PAUSE_RECORDER, RecEffect.RESUME_RECORDER), fx)
    }

    @Test
    fun pauseWhileIdleDoesNothing() {
        val (s, fx) = run(RecEvent.UserPause, RecEvent.UserResume)
        assertEquals(RecPhase.IDLE, s.phase)
        assertTrue(fx.isEmpty())
    }

    @Test
    fun transientInterruptionPausesAndResumesByItself() {
        val (s, fx) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.InterruptionBegan(Interruption.FOCUS_TRANSIENT), RecEvent.InterruptionEnded
        )
        assertEquals(RecPhase.RECORDING, s.phase)
        assertEquals(listOf(RecEffect.START_RECORDER, RecEffect.PAUSE_RECORDER, RecEffect.RESUME_RECORDER), fx)
    }

    @Test
    fun permanentFocusLossNeedsTheUserToResume() {
        val (paused, _) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.InterruptionBegan(Interruption.FOCUS_LOST), RecEvent.InterruptionEnded
        )
        assertEquals(RecPhase.PAUSED_BY_INTERRUPTION, paused.phase)
        val t = RecordingStateMachine.reduce(paused, RecEvent.UserResume)
        assertEquals(RecPhase.RECORDING, t.state.phase)
        assertEquals(listOf(RecEffect.RESUME_RECORDER), t.effects)
    }

    @Test
    fun transientLossThenPermanentLossStaysPaused() {
        val (s, _) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.InterruptionBegan(Interruption.FOCUS_TRANSIENT),
            RecEvent.InterruptionBegan(Interruption.FOCUS_LOST),
            RecEvent.InterruptionEnded
        )
        assertEquals(RecPhase.PAUSED_BY_INTERRUPTION, s.phase)
        assertEquals(Interruption.FOCUS_LOST, s.interruption)
    }

    @Test
    fun userPauseIsNotUndoneByAudioFocusReturning() {
        val (s, fx) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.UserPause,
            RecEvent.InterruptionBegan(Interruption.FOCUS_TRANSIENT), RecEvent.InterruptionEnded
        )
        assertEquals(RecPhase.PAUSED_BY_USER, s.phase)
        assertEquals(listOf(RecEffect.START_RECORDER, RecEffect.PAUSE_RECORDER), fx)
    }

    @Test
    fun userButtonStopIsReasonUser() {
        val (s, fx) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.StopRequested(StopCause.USER_BUTTON))
        assertEquals(RecPhase.STOPPED, s.phase)
        assertEquals(StopReason.USER, s.stopReason)
        assertEquals(RecEffect.STOP_RECORDER, fx.last())
    }

    @Test
    fun stopWhileScreenOffIsLock() {
        val (s, _) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.StopRequested(StopCause.RECORDER_ERROR, screenInteractive = false, appInForeground = false)
        )
        assertEquals(StopReason.LOCK, s.stopReason)
    }

    @Test
    fun stopWithScreenOnButAppAwayIsBackground() {
        val (s, _) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.StopRequested(StopCause.LOW_STORAGE, screenInteractive = true, appInForeground = false)
        )
        assertEquals(StopReason.BACKGROUND, s.stopReason)
    }

    @Test
    fun stopWhileVisibleForARecorderFaultIsError() {
        val (s, _) = run(
            RecEvent.StartRequested, RecEvent.RecorderStarted,
            RecEvent.StopRequested(StopCause.RECORDER_ERROR, screenInteractive = true, appInForeground = true)
        )
        assertEquals(StopReason.ERROR, s.stopReason)
        assertEquals(StopCause.RECORDER_ERROR, s.stopCause)
    }

    @Test
    fun userStopStaysUserEvenWithScreenOff() {
        // The notification Stop button is pressed with the screen on, but the classification must not depend on it.
        assertEquals(StopReason.USER, StopCause.classify(StopCause.NOTIFICATION_STOP, screenInteractive = false, appInForeground = false))
    }

    @Test
    fun startFailureWhileStartingEndsStopped() {
        val (s, _) = run(RecEvent.StartRequested, RecEvent.StopRequested(StopCause.START_FAILED))
        assertEquals(RecPhase.STOPPED, s.phase)
        assertEquals(StopCause.START_FAILED, s.stopCause)
    }

    @Test
    fun stopWhileIdleOrStoppedIsIgnored() {
        val idle = RecordingStateMachine.reduce(RecState(), RecEvent.StopRequested(StopCause.USER_BUTTON))
        assertEquals(RecPhase.IDLE, idle.state.phase)
        assertTrue(idle.effects.isEmpty())
        val (stopped, fx) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.StopRequested(StopCause.USER_BUTTON), RecEvent.StopRequested(StopCause.TASK_REMOVED))
        assertEquals(StopCause.USER_BUTTON, stopped.stopCause)
        assertEquals(1, fx.count { it == RecEffect.STOP_RECORDER })
    }

    @Test
    fun processDeathFoundAtLaunchIsReportedAsProcessDeath() {
        val (s, fx) = run(RecEvent.ProcessDied)
        assertEquals(RecPhase.STOPPED, s.phase)
        assertEquals(StopReason.PROCESS_DEATH, s.stopReason)
        assertTrue(fx.isEmpty()) // there is no recorder to stop
    }

    @Test
    fun processDiedWhileRecordingIsIgnored() {
        val (s, _) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.ProcessDied)
        assertEquals(RecPhase.RECORDING, s.phase)
    }

    @Test
    fun resetOnlyFromStopped() {
        val (recording, _) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.Reset)
        assertEquals(RecPhase.RECORDING, recording.phase)
        val (idle, _) = run(RecEvent.StartRequested, RecEvent.RecorderStarted, RecEvent.StopRequested(StopCause.USER_BUTTON), RecEvent.Reset)
        assertEquals(RecPhase.IDLE, idle.phase)
        assertFalse(idle.isActive)
    }

    @Test
    fun elapsedTrackerExcludesPauses() {
        val t = ElapsedTracker()
        t.start(1_000)
        assertEquals(500, t.elapsed(1_500))
        t.pause(2_000)
        assertEquals(1_000, t.elapsed(9_999)) // paused: frozen
        t.resume(10_000)
        assertEquals(1_500, t.elapsed(10_500))
        assertEquals(2_000, t.stop(11_000))
    }
}
