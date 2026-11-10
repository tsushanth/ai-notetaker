package com.kreativekoala.scribeai.recording

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.kreativekoala.scribeai.BuildConfig
import com.kreativekoala.scribeai.R
import java.util.UUID

/**
 * Records a voice note in a foreground service of type `microphone`, so the recording continues when the screen
 * locks, the user switches apps, or the activity is destroyed (Android stops delivering microphone audio to an app
 * that is in the background without a foreground service).
 *
 * The service is started from the recording screen (a visible activity), which is what Android 12+/14+ require for a
 * microphone foreground service: it cannot be created from the background. The recorder is created once per
 * recording and only paused/resumed afterwards, so notification actions never need to start a new microphone
 * session from the background.
 *
 * All logic runs on the main thread. The recording state is a [RecordingStateMachine]; this class carries out its
 * effects and talks to Android (audio focus, battery, storage, routing). The audio goes to a file as it is recorded
 * (ADTS AAC, see [RecordingConfig]) and a manifest next to it tracks the phase, so a killed process loses nothing.
 */
class RecordingService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: PendingRecordingStore
    private lateinit var telemetry: RecordingTelemetry
    private lateinit var notifications: RecordingNotifications
    private lateinit var audioManager: AudioManager

    private var state = RecState()
    private var recorder: MediaRecorder? = null
    private var recordingId: String? = null
    private val elapsed = ElapsedTracker()
    private val guard = SilenceGuard()
    private val warnings = linkedSetOf<RecordingSession.Warning>()
    private var pauses = 0
    private var interruptions = 0
    private var inputRoute = InputRoute.UNKNOWN
    private var focusRequest: AudioFocusRequest? = null
    private var lastHealthCheck = 0L
    private var lastAmplitude = 0
    private var foregroundStarted = false
    private var recordingConfigCallback: AudioManager.AudioRecordingCallback? = null
    private var deviceCallback: AudioDeviceCallback? = null
    private var pendingStartError: RecordingSession.StartError? = null

    private val tick = object : Runnable {
        override fun run() {
            onTick()
            if (state.isActive) handler.postDelayed(this, RecordingConfig.METER_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = RecordingEnv.store(this)
        telemetry = RecordingEnv.telemetry(this)
        notifications = RecordingNotifications(this).also { it.ensureChannels() }
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart()
            ACTION_PAUSE -> if (state.isActive) dispatch(RecEvent.UserPause) else stopSelf()
            ACTION_RESUME -> if (state.isActive) dispatch(RecEvent.UserResume) else stopSelf()
            ACTION_STOP -> if (state.isActive) dispatch(stopEvent(StopCause.NOTIFICATION_STOP)) else stopSelf()
            ACTION_STOP_FROM_APP -> if (state.isActive) dispatch(stopEvent(StopCause.USER_BUTTON)) else stopSelf()
            else -> if (!state.isActive) stopSelf()
        }
        // Never restarted by the system: a restart would have to open the microphone from the background.
        return START_NOT_STICKY
    }

    /** Swiping the app away from recents: finish the file cleanly and keep it (it shows up as an unsent recording). */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (state.isActive) dispatch(stopEvent(StopCause.TASK_REMOVED))
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (state.isActive) dispatch(stopEvent(StopCause.SERVICE_DESTROYED))
        handler.removeCallbacksAndMessages(null)
        releaseRecorder()
        super.onDestroy()
    }

    // ---------------------------------------------------------------------------------------------------------

    private fun handleStart() {
        if (state.isActive) return
        val micGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

        // Android gives a few seconds after startForegroundService() to call startForeground(); do it first.
        // On Android 14+ this throws SecurityException without RECORD_AUDIO and
        // ForegroundServiceStartNotAllowedException if the app is not visible: both end in failStart().
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            ServiceCompat.startForeground(this, RecordingNotifications.ID_ONGOING, notifications.ongoing(false, 0L, null), type)
            foregroundStarted = true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground refused", e)
            failStart(if (!micGranted) RecordingSession.StartError.NO_PERMISSION else RecordingSession.StartError.NOT_ALLOWED, "failed")
            return
        }
        if (!micGranted) { failStart(RecordingSession.StartError.NO_PERMISSION, "started"); return }

        val free = freeBytes()
        if (!StoragePolicy.canStart(free)) { failStart(RecordingSession.StartError.LOW_STORAGE, "started"); return }

        val id = UUID.randomUUID().toString()
        recordingId = id
        store.save(PendingRecording(id = id, phase = RecordingPhase.RECORDING, createdAtMs = System.currentTimeMillis(), appVersionCode = BuildConfig.VERSION_CODE))
        warnings.clear(); guard.reset(); pauses = 0; interruptions = 0; lastAmplitude = 0
        publish()
        dispatch(RecEvent.StartRequested)
    }

    private fun failStart(error: RecordingSession.StartError, fgService: String) {
        telemetry.track(RecordingEvents.STARTED, mapOf(
            "start_error" to error.name.lowercase(),
            "mic_permission" to if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) "granted" else "denied",
            "notif_permission" to notifPermission(), "fg_service" to fgService, "free_storage_mb" to (freeBytes() / (1024 * 1024)).toInt()
        ))
        telemetry.flush()
        RecordingSession.update { it.copy(phase = RecPhase.IDLE, startError = error, recordingId = null) }
        if (foregroundStarted) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun stopEvent(cause: StopCause) = RecEvent.StopRequested(
        cause = cause,
        screenInteractive = getSystemService(PowerManager::class.java).isInteractive,
        appInForeground = AppVisibility.isForeground
    )

    /** Runs an event through the state machine and carries out what it asks for. */
    private fun dispatch(event: RecEvent) {
        val before = state
        val t = RecordingStateMachine.reduce(state, event)
        state = t.state
        for (effect in t.effects) apply(effect)
        if (before.phase != state.phase || before.interruption != state.interruption) {
            if (event is RecEvent.InterruptionBegan || event == RecEvent.InterruptionEnded) {
                telemetry.track(RecordingEvents.INTERRUPTION, mapOf(
                    "local_id" to recordingId, "kind" to (if (event is RecEvent.InterruptionBegan) event.kind.wire else "focus_regained"), "phase" to before.phase.name.lowercase()
                ))
            }
            publish()
            refreshNotification()
        }
        if (state.phase == RecPhase.STOPPED) finish()
    }

    private fun apply(effect: RecEffect) {
        when (effect) {
            RecEffect.START_RECORDER -> {
                if (startRecorder()) dispatch(RecEvent.RecorderStarted)
                else dispatch(stopEvent(StopCause.START_FAILED))
            }
            RecEffect.PAUSE_RECORDER -> {
                runCatching { recorder?.pause() }.onFailure { Log.w(TAG, "pause failed", it) }
                elapsed.pause(SystemClock.elapsedRealtime())
                pauses++
            }
            RecEffect.RESUME_RECORDER -> {
                runCatching { recorder?.resume() }.onFailure { Log.w(TAG, "resume failed", it) }
                elapsed.resume(SystemClock.elapsedRealtime())
                primeAmplitude()
            }
            RecEffect.STOP_RECORDER -> stopRecorder()
        }
    }

    private fun startRecorder(): Boolean {
        val id = recordingId ?: return false
        var created: MediaRecorder? = null
        return try {
            val file = store.audioFile(id)
            val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
            created = r
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(RecordingConfig.CHANNELS)
            r.setAudioSamplingRate(RecordingConfig.SAMPLE_RATE_HZ)
            r.setAudioEncodingBitRate(RecordingConfig.BIT_RATE)
            r.setMaxFileSize(RecordingConfig.MAX_FILE_BYTES)
            r.setOutputFile(file)
            r.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                    dispatch(stopEvent(StopCause.MAX_SIZE))
                }
            }
            r.setOnErrorListener { _, _, _ -> dispatch(stopEvent(StopCause.RECORDER_ERROR)) }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) registerRecordingCallback(r)
            r.prepare()
            r.start()
            recorder = r
            elapsed.start(SystemClock.elapsedRealtime())
            primeAmplitude()
            requestAudioFocus()
            registerDeviceCallback()
            inputRoute = currentRoute()
            lastHealthCheck = SystemClock.elapsedRealtime()
            handler.postDelayed(tick, RecordingConfig.METER_INTERVAL_MS)
            telemetry.track(RecordingEvents.STARTED, mapOf(
                "local_id" to id, "mic_permission" to "granted", "notif_permission" to notifPermission(), "fg_service" to "started",
                "input_route" to inputRoute.wire, "free_storage_mb" to (freeBytes() / (1024 * 1024)).toInt(),
                "battery_pct" to batteryPercent(), "charging" to isCharging(),
                "audio_focus" to if (focusRequest != null) "granted" else "denied"
            ))
            true
        } catch (e: Exception) {
            Log.e(TAG, "could not start recorder", e)
            runCatching { created?.release() }
            releaseRecorder()
            pendingStartError = RecordingSession.StartError.RECORDER_FAILED
            telemetry.track(RecordingEvents.STARTED, mapOf(
                "local_id" to id, "start_error" to "recorder_failed", "mic_permission" to "granted",
                "notif_permission" to notifPermission(), "fg_service" to "started"
            ))
            false
        }
    }

    private fun stopRecorder() {
        val r = recorder ?: return
        elapsed.stop(SystemClock.elapsedRealtime())
        // One last reading before stop(): the loudest sample of the final interval.
        runCatching { guard.onSample(elapsed.elapsed(SystemClock.elapsedRealtime()), r.maxAmplitude) }
        runCatching { r.stop() }.onFailure { Log.w(TAG, "stop() failed (usually: nothing was recorded)", it) }
        releaseRecorder()
    }

    private fun releaseRecorder() {
        handler.removeCallbacks(tick)
        recorder?.let { r ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) recordingConfigCallback?.let { runCatching { r.unregisterAudioRecordingCallback(it) } }
            runCatching { r.release() }
        }
        recorder = null
        recordingConfigCallback = null
        deviceCallback?.let { runCatching { audioManager.unregisterAudioDeviceCallback(it) } }
        deviceCallback = null
        abandonAudioFocus()
    }

    /** Called once the state machine reached STOPPED: write the result to disk, tell the screen, clean up. */
    private fun finish() {
        val id = recordingId
        val cause = state.stopCause ?: StopCause.RECORDER_ERROR
        val reason = state.stopReason ?: StopReason.ERROR
        var result: RecordingSession.StopResult? = null
        if (id != null) {
            val info = AdtsInspector.repair(store.audioFile(id))
            val summary = guard.summary()
            val duration = if (info.durationMs > 0) info.durationMs else elapsed.elapsed(SystemClock.elapsedRealtime())
            val keep = !info.isEmpty && info.durationMs >= RecordingConfig.MIN_USEFUL_MS
            if (cause != StopCause.START_FAILED) telemetry.track(RecordingEvents.STOPPED, mapOf(
                "local_id" to id, "reason" to reason.wire, "detail" to cause.wire, "duration_ms" to duration, "bytes" to info.validBytes,
                "peak_amplitude" to summary.peakAmplitude, "silent" to summary.allSilent, "silent_pct" to summary.silentPercent,
                "warned_no_sound" to summary.warnedNoSound, "pauses" to pauses, "interruptions" to interruptions, "input_route" to inputRoute.wire
            ))
            telemetry.flush()
            if (cause == StopCause.START_FAILED) {
                store.delete(id)
            } else if (keep) {
                store.update(id) {
                    it.copy(
                        phase = RecordingPhase.RECORDED, durationMs = duration, bytes = info.validBytes,
                        peakAmplitude = summary.peakAmplitude, silentPercent = summary.silentPercent, allSilent = summary.allSilent,
                        stopReason = reason.wire, stopDetail = cause.wire
                    )
                }
            } else {
                store.delete(id)
            }
            result = RecordingSession.StopResult(id, reason, cause, duration, keep && cause != StopCause.START_FAILED, summary.allSilent)
        }
        val startError = if (cause == StopCause.START_FAILED) (pendingStartError ?: RecordingSession.StartError.RECORDER_FAILED) else null
        RecordingSession.update {
            it.copy(
                phase = RecPhase.IDLE, interruption = null, recordingId = null, elapsedMs = 0L, amplitude = 0,
                warnings = emptySet(), result = if (startError == null) result else null, startError = startError
            )
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        if (result?.kept == true && !cause.userInitiated) postSavedNotification(cause)
        state = RecState()
        recordingId = null
        stopSelf()
    }

    private fun postSavedNotification(cause: StopCause) {
        val text = getString(when (cause) {
            StopCause.LOW_STORAGE -> R.string.rec_saved_low_storage
            StopCause.LOW_BATTERY -> R.string.rec_saved_low_battery
            StopCause.MAX_SIZE -> R.string.rec_saved_max_length
            StopCause.FOCUS_LOST -> R.string.rec_saved_audio_taken
            else -> R.string.rec_saved_generic
        })
        runCatching { getSystemService(NotificationManager::class.java).notify(RecordingNotifications.ID_SAVED, notifications.saved(text)) }
    }

    // ---------------------------------------------------------------------------------------------------------
    // Periodic work: level meter, silence guard, storage and battery.

    private fun onTick() {
        val r = recorder ?: return
        val nowRt = SystemClock.elapsedRealtime()
        val activeMs = elapsed.elapsed(nowRt)
        if (state.phase == RecPhase.RECORDING) {
            val amp = runCatching { r.maxAmplitude }.getOrDefault(0)
            lastAmplitude = amp
            val level = guard.onSample(activeMs, amp)
            setWarning(RecordingSession.Warning.NO_SOUND, level == SilenceGuard.Level.NO_SOUND)
            setWarning(RecordingSession.Warning.LOW_SOUND, level == SilenceGuard.Level.LOW_SOUND)
        }
        if (nowRt - lastHealthCheck >= RecordingConfig.HEALTH_CHECK_INTERVAL_MS) {
            lastHealthCheck = nowRt
            when (StoragePolicy.decide(freeBytes())) {
                StoragePolicy.Decision.STOP -> { dispatch(stopEvent(StopCause.LOW_STORAGE)); return }
                StoragePolicy.Decision.WARN -> setWarning(RecordingSession.Warning.LOW_STORAGE, true)
                StoragePolicy.Decision.OK -> setWarning(RecordingSession.Warning.LOW_STORAGE, false)
            }
            when (BatteryPolicy.decide(batteryPercent(), isCharging())) {
                BatteryPolicy.Decision.STOP -> { dispatch(stopEvent(StopCause.LOW_BATTERY)); return }
                BatteryPolicy.Decision.WARN -> setWarning(RecordingSession.Warning.LOW_BATTERY, true)
                BatteryPolicy.Decision.OK -> setWarning(RecordingSession.Warning.LOW_BATTERY, false)
            }
        }
        publish()
    }

    private fun setWarning(w: RecordingSession.Warning, on: Boolean) {
        val changed = if (on) warnings.add(w) else warnings.remove(w)
        if (!changed) return
        if (on) {
            telemetry.track(RecordingEvents.WARNING, mapOf("local_id" to recordingId, "kind" to w.name.lowercase(), "elapsed_ms" to elapsed.elapsed(SystemClock.elapsedRealtime())))
        }
        refreshNotification()
    }

    private fun publish() {
        RecordingSession.update {
            it.copy(
                phase = state.phase, interruption = state.interruption, recordingId = recordingId,
                elapsedMs = elapsed.elapsed(SystemClock.elapsedRealtime()), amplitude = lastAmplitude, warnings = warnings.toSet(),
                // A new recording starts clean: the previous result and error were for the screen to read.
                result = if (state.phase == RecPhase.STARTING) null else it.result,
                startError = if (state.phase == RecPhase.STARTING) null else it.startError
            )
        }
    }

    private fun refreshNotification() {
        if (!foregroundStarted || !state.isActive) return
        val warning = when {
            RecordingSession.Warning.MIC_SILENCED in warnings -> getString(R.string.rec_warn_mic_silenced)
            RecordingSession.Warning.NO_SOUND in warnings -> getString(R.string.rec_warn_no_sound_short)
            RecordingSession.Warning.LOW_STORAGE in warnings -> getString(R.string.rec_warn_low_storage)
            RecordingSession.Warning.LOW_BATTERY in warnings -> getString(R.string.rec_warn_low_battery)
            state.interruption == Interruption.FOCUS_LOST -> getString(R.string.rec_warn_audio_taken)
            else -> null
        }
        val n: Notification = notifications.ongoing(state.isPaused, elapsed.elapsed(SystemClock.elapsedRealtime()), warning)
        runCatching { getSystemService(NotificationManager::class.java).notify(RecordingNotifications.ID_ONGOING, n) }
    }

    // ---------------------------------------------------------------------------------------------------------
    // Android audio plumbing.

    /** The first maxAmplitude call after start/resume always returns 0: read it once so it does not count. */
    private fun primeAmplitude() { runCatching { recorder?.maxAmplitude } }

    private fun requestAudioFocus() {
        // Android 15 requires the app to be the top app or run a foreground service to ask for focus: we already do.
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener({ change -> onFocusChange(change) }, handler)
            .build()
        val granted = audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        // Denied (for example during a phone call): keep recording, the silence guard and the system-silenced
        // callback report it if the microphone is not delivering sound.
        focusRequest = if (granted) request else null
    }

    private fun abandonAudioFocus() {
        focusRequest?.let { runCatching { audioManager.abandonAudioFocusRequest(it) } }
        focusRequest = null
    }

    private fun onFocusChange(change: Int) {
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { interruptions++; dispatch(RecEvent.InterruptionBegan(Interruption.FOCUS_TRANSIENT)) }
            AudioManager.AUDIOFOCUS_LOSS -> { interruptions++; dispatch(RecEvent.InterruptionBegan(Interruption.FOCUS_LOST)) }
            AudioManager.AUDIOFOCUS_GAIN -> dispatch(RecEvent.InterruptionEnded)
            // Ducking does not matter to a recorder.
        }
    }

    private fun registerRecordingCallback(r: MediaRecorder) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val cb = object : AudioManager.AudioRecordingCallback() {
            override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
                val mine = runCatching { recorder?.activeRecordingConfiguration }.getOrNull()
                val silenced = mine?.isClientSilenced == true
                setWarning(RecordingSession.Warning.MIC_SILENCED, silenced)
                if (silenced) publish()
            }
        }
        r.registerAudioRecordingCallback(ContextCompat.getMainExecutor(this), cb)
        recordingConfigCallback = cb
    }

    private fun registerDeviceCallback() {
        val cb = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = onRouteMaybeChanged()
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = onRouteMaybeChanged()
        }
        audioManager.registerAudioDeviceCallback(cb, handler)
        deviceCallback = cb
    }

    private fun onRouteMaybeChanged() {
        val now = currentRoute()
        if (now != inputRoute) {
            inputRoute = now
            telemetry.track(RecordingEvents.INTERRUPTION, mapOf("local_id" to recordingId, "kind" to "route_${now.wire}", "phase" to state.phase.name.lowercase()))
        }
    }

    private fun currentRoute(): InputRoute =
        InputRoute.fromDeviceType(runCatching { recorder?.routedDevice?.type }.getOrNull())

    private fun freeBytes(): Long = runCatching { StatFs(filesDir.absolutePath).availableBytes }.getOrDefault(Long.MAX_VALUE)

    private fun batteryPercent(): Int {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return -1
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (level < 0 || scale <= 0) -1 else (level * 100) / scale
    }

    private fun isCharging(): Boolean {
        val i = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    }

    private fun notifPermission(): String =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) "na"
        else if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) "granted" else "denied"

    companion object {
        private const val TAG = "RecordingService"
        const val ACTION_START = "com.kreativekoala.scribeai.recording.START"
        const val ACTION_PAUSE = "com.kreativekoala.scribeai.recording.PAUSE"
        const val ACTION_RESUME = "com.kreativekoala.scribeai.recording.RESUME"
        const val ACTION_STOP = "com.kreativekoala.scribeai.recording.STOP"
        const val ACTION_STOP_FROM_APP = "com.kreativekoala.scribeai.recording.STOP_FROM_APP"

        /**
         * Starts a recording. Must be called while the app is visible (from the recording screen). Returns false if
         * Android refused to start the foreground service; [RecordingSession.Snapshot.startError] is then set.
         */
        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, RecordingService::class.java).setAction(ACTION_START))
            true
        } catch (e: Exception) {
            Log.e(TAG, "startForegroundService refused", e)
            RecordingSession.update { it.copy(startError = RecordingSession.StartError.NOT_ALLOWED) }
            false
        }

        fun command(context: Context, action: String) {
            // Commands go to a service that is already running; if it is not, the screen state is already idle.
            if (!RecordingSession.state.value.isActive) return
            runCatching { context.startService(Intent(context, RecordingService::class.java).setAction(action)) }
                .onFailure { Log.w(TAG, "command $action failed", it) }
        }
    }
}
