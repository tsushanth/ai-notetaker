package com.kreativekoala.scribeai.recording

import android.content.Context
import android.util.Log
import com.kreativekoala.scribeai.utils.AuthManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Runs once per app start (from MainActivity, after analytics is set up): hands the app's AuthManager to the
 * background sender, replays queued events, and recovers recordings the last run left behind.
 */
object RecordingBootstrap {
    private const val TAG = "RecordingBootstrap"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun onAppStart(context: Context, authManager: AuthManager) {
        val app = context.applicationContext
        RecordingAuth.register(authManager)
        scope.launch {
            try {
                EventQueue.drain(app)
                recover(app)
            } catch (e: Exception) {
                Log.w(TAG, "recovery failed", e)
            }
        }
    }

    /** Applies [RecoveryPlanner] to what is on disk. Public so the screen can call it too. */
    @Synchronized
    fun recover(app: Context) {
        val store = RecordingEnv.store(app)
        val telemetry = RecordingEnv.telemetry(app)
        val now = System.currentTimeMillis()
        val activeId = RecordingSession.state.value.takeIf { it.isActive }?.recordingId

        // Audio with no manifest (crash between creating the file and writing the manifest): adopt it.
        for (orphan in store.orphanAudioIds()) {
            if (orphan == activeId) continue
            store.save(PendingRecording(id = orphan, phase = RecordingPhase.RECORDING, createdAtMs = store.audioFile(orphan).lastModified()))
        }

        val actions = RecoveryPlanner.plan(store.list(), { store.audioFile(it).length() }, activeId, now)
        for (a in actions) {
            when (a) {
                is RecoveryAction.Discard -> {
                    val p = store.load(a.id)
                    store.delete(a.id)
                    telemetry.track(RecordingEvents.RECOVERED, mapOf("local_id" to a.id, "action" to "discarded_${a.why}".take(40), "age_hours" to ageHours(p, now)))
                }
                is RecoveryAction.Finalize -> finalize(store, telemetry, a.id, now)
                is RecoveryAction.Resume -> UploadScheduler.enqueue(app, a.id, "recovery")
                is RecoveryAction.Keep -> Unit
            }
        }
    }

    private fun finalize(store: PendingRecordingStore, telemetry: RecordingTelemetry, id: String, now: Long) {
        val info = AdtsInspector.repair(store.audioFile(id))
        val p = store.load(id)
        if (info.isEmpty || info.durationMs < RecordingConfig.MIN_USEFUL_MS) {
            store.delete(id)
            telemetry.track(RecordingEvents.RECOVERED, mapOf("local_id" to id, "action" to "discarded_too_short", "age_hours" to ageHours(p, now)))
            return
        }
        store.update(id) {
            it.copy(
                phase = RecordingPhase.RECORDED, durationMs = info.durationMs, bytes = info.validBytes,
                stopReason = StopReason.PROCESS_DEATH.wire, stopDetail = StopCause.PROCESS_DIED.wire
            )
        }
        telemetry.track(RecordingEvents.STOPPED, mapOf(
            "local_id" to id, "reason" to StopReason.PROCESS_DEATH.wire, "detail" to StopCause.PROCESS_DIED.wire,
            "duration_ms" to info.durationMs, "bytes" to info.validBytes
        ))
        telemetry.track(RecordingEvents.RECOVERED, mapOf(
            "local_id" to id, "action" to "offered", "duration_ms" to info.durationMs, "bytes" to info.validBytes, "age_hours" to ageHours(p, now)
        ))
        telemetry.flush()
    }

    private fun ageHours(p: PendingRecording?, now: Long): Int =
        if (p == null || p.createdAtMs <= 0) 0 else ((now - p.createdAtMs) / 3_600_000L).toInt().coerceAtLeast(0)
}
