package com.kreativekoala.scribeai.recording

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.delay

/**
 * Sends one recording in the background: survives leaving the screen and a killed process (WorkManager persists the
 * request), waits for a network connection, and retries with backoff. The real work is [UploadFlow].
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.failure()
        val trigger = inputData.getString(KEY_TRIGGER) ?: "worker"
        val store = RecordingEnv.store(applicationContext)

        // Stop retrying for good after a long time so a recording does not loop forever in the scheduler.
        if (runAttemptCount >= MAX_RUN_ATTEMPTS) {
            store.update(id) {
                if (it.phase == RecordingPhase.DONE) it
                else it.copy(phase = RecordingPhase.FAILED, failureKind = FailureKind.NETWORK.name)
            }
            UploadProgressBus.publish(UploadProgress(id, SendPhase.FAILED, failure = Failure(FailureKind.NETWORK)))
            return Result.success()
        }

        val flow = UploadFlow(
            store = store,
            api = RecordingEnv.api(applicationContext),
            telemetry = RecordingEnv.telemetry(applicationContext),
            progress = UploadProgressBus,
            sleep = { delay(it) },
            now = { System.currentTimeMillis() }
        )
        return when (flow.run(id, trigger)) {
            is UploadFlow.Outcome.Done, is UploadFlow.Outcome.Final -> Result.success()
            UploadFlow.Outcome.RetryLater -> Result.retry()
        }
    }

    companion object {
        const val KEY_ID = "id"
        const val KEY_TRIGGER = "trigger"
        private const val MAX_RUN_ATTEMPTS = 10

        fun workName(id: String) = "recording-upload-$id"
    }
}

object UploadScheduler {
    /**
     * Queues (or re-queues) sending of recording [id]. Does nothing if it is already uploading or transcribing in
     * this process, so a second tap or a launch-time recovery cannot restart a transfer that is in progress.
     */
    fun enqueue(context: Context, id: String, trigger: String) {
        val active = UploadProgressBus.state.value[id]?.phase
        if (active == SendPhase.UPLOADING || active == SendPhase.TRANSCRIBING) return
        val request = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(workDataOf(UploadWorker.KEY_ID to id, UploadWorker.KEY_TRIGGER to trigger))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        UploadProgressBus.publish(UploadProgress(id, SendPhase.QUEUED))
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UploadWorker.workName(id), ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context, id: String) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UploadWorker.workName(id))
        UploadProgressBus.clear(id)
    }
}
