package com.kreativekoala.scribeai.recording

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One-off messages for the screen (shown once, then cleared). */
enum class Notice { TOO_SHORT, NO_PERMISSION, LOW_STORAGE, NOT_ALLOWED, RECORDER_FAILED }

/** Everything the recording screen shows, computed from the service state, the files on disk and the sending progress. */
data class RecordingUi(
    val session: RecordingSession.Snapshot = RecordingSession.Snapshot(),
    /** The recording being reviewed or sent. */
    val review: PendingRecording? = null,
    val progress: UploadProgress? = null,
    /** Other recordings that were not sent yet (recovered, failed, or waiting). */
    val pending: List<PendingRecording> = emptyList(),
    val notice: Notice? = null
)

/**
 * Holds what must survive rotation: which recording is under review and the title being typed. The recording itself
 * is owned by [RecordingService] and the files on disk, so nothing here is lost if the screen is recreated.
 */
class RecordingViewModel(app: Application) : AndroidViewModel(app) {
    private val store = RecordingEnv.store(app)
    private val telemetry = RecordingEnv.telemetry(app)

    private val reviewId = MutableStateFlow<String?>(null)
    private val refresh = MutableStateFlow(0)
    private val notice = MutableStateFlow<Notice?>(null)
    private var discardNextResult = false
    private val counted = HashSet<String>()

    val title = MutableStateFlow("")

    val ui: StateFlow<RecordingUi> = combine(
        RecordingSession.state, UploadProgressBus.state, reviewId, refresh, notice
    ) { session, progressMap, rid, _, n ->
        val all = store.list().filter { it.phase != RecordingPhase.RECORDING && it.id != session.recordingId }
        val review = rid?.let { id -> all.firstOrNull { it.id == id } }
        RecordingUi(
            session = session,
            review = review,
            progress = rid?.let { progressMap[it] },
            pending = all.filter { it.id != rid },
            notice = n
        )
    }.flowOn(Dispatchers.IO).stateIn(viewModelScope, SharingStarted.Eagerly, RecordingUi())

    init {
        // Take over a recording that ended while the screen was away, and surface why a start failed.
        viewModelScope.launch {
            RecordingSession.state.collect { s ->
                val result = s.result
                if (result != null) {
                    RecordingSession.consumeResult()
                    when {
                        !result.kept -> notice.value = Notice.TOO_SHORT
                        discardNextResult -> { discardNextResult = false; discard(result.recordingId) }
                        else -> reviewId.value = result.recordingId
                    }
                    refresh.value++
                }
                s.startError?.let {
                    RecordingSession.consumeResult()
                    notice.value = when (it) {
                        RecordingSession.StartError.NO_PERMISSION -> Notice.NO_PERMISSION
                        RecordingSession.StartError.LOW_STORAGE -> Notice.LOW_STORAGE
                        RecordingSession.StartError.NOT_ALLOWED -> Notice.NOT_ALLOWED
                        RecordingSession.StartError.RECORDER_FAILED -> Notice.RECORDER_FAILED
                    }
                }
            }
        }
        // Finish what the last run left behind (an unfinished file becomes an unsent recording).
        viewModelScope.launch(Dispatchers.IO) {
            RecordingBootstrap.recover(app)
            refresh.value++
        }
    }

    fun clearNotice() { notice.value = null }

    fun startRecording() {
        notice.value = null
        reviewId.value = null
        title.value = ""
        discardNextResult = false
        RecordingService.start(getApplication())
    }

    fun pause() = RecordingService.command(getApplication(), RecordingService.ACTION_PAUSE)
    fun resume() = RecordingService.command(getApplication(), RecordingService.ACTION_RESUME)
    fun stop() = RecordingService.command(getApplication(), RecordingService.ACTION_STOP_FROM_APP)

    /** Stop the running recording and delete it. */
    fun stopAndDiscard() {
        discardNextResult = true
        stop()
    }

    fun review(id: String) {
        reviewId.value = id
        title.value = store.load(id)?.title ?: ""
    }

    /** Leave the review screen; the recording stays in the unsent list. */
    fun leaveReview() { reviewId.value = null }

    fun send(id: String) {
        val t = title.value.takeIf { reviewId.value == id } ?: ""
        store.update(id) { it.copy(title = if (t.isNotBlank()) t else it.title) }
        reviewId.value = id
        UploadScheduler.enqueue(getApplication(), id, "user")
        refresh.value++
    }

    /** Try again after a failure: resumes from where the recording got to (an uploaded one is not uploaded twice). */
    fun retry(id: String) {
        store.update(id) {
            it.copy(
                phase = if (it.serverRecordingId != null) RecordingPhase.UPLOADED else RecordingPhase.RECORDED,
                failureKind = null, failureMessage = null, uploadAttempts = 0
            )
        }
        UploadProgressBus.clear(id)
        reviewId.value = id
        UploadScheduler.enqueue(getApplication(), id, "retry")
        refresh.value++
    }

    fun discard(id: String) {
        UploadScheduler.cancel(getApplication(), id)
        telemetry.track(RecordingEvents.RECOVERED, mapOf("local_id" to id, "action" to "discarded_by_user"))
        store.delete(id)
        if (reviewId.value == id) reviewId.value = null
        refresh.value++
    }

    /** Called once when the success screen is shown. Returns true the first time for a given recording. */
    fun markSuccessSeen(id: String): Boolean = counted.add(id)

    /** Leaves the success screen: forgets the finished recording (the progress entry is keyed by recording id). */
    fun finishSuccess() {
        reviewId.value?.let { UploadProgressBus.clear(it) }
        reviewId.value = null
    }
}
