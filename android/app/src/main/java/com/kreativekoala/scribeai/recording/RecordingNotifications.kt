package com.kreativekoala.scribeai.recording

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.kreativekoala.scribeai.R

/** The ongoing "Recording" notification (required for a foreground service) and the "Recording saved" one. */
class RecordingNotifications(private val context: Context) {

    fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_RECORDING, context.getString(R.string.rec_channel_recording), NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
                setSound(null, null)
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SAVED, context.getString(R.string.rec_channel_saved), NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    /**
     * @param elapsedMs active recording time so far; the chronometer counts up from it while recording.
     * @param warning a short line to show instead of the status ("No sound detected"), or null.
     */
    fun ongoing(paused: Boolean, elapsedMs: Long, warning: String?): Notification {
        val builder = NotificationCompat.Builder(context, CHANNEL_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_recording)
            .setContentTitle(context.getString(if (paused) R.string.rec_notification_paused else R.string.rec_notification_recording))
            .setContentText(warning ?: context.getString(R.string.rec_notification_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(openAppIntent())
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (!paused) {
            builder.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsedMs).setShowWhen(true)
        } else {
            builder.setUsesChronometer(false).setShowWhen(false)
        }
        builder.addAction(0, context.getString(if (paused) R.string.rec_action_resume else R.string.rec_action_pause), servicePendingIntent(if (paused) RecordingService.ACTION_RESUME else RecordingService.ACTION_PAUSE, 1))
        builder.addAction(0, context.getString(R.string.rec_action_stop), servicePendingIntent(RecordingService.ACTION_STOP, 2))
        return builder.build()
    }

    /** Shown when a recording ended without the user pressing stop, so they know it was kept. */
    fun saved(text: String): Notification =
        NotificationCompat.Builder(context, CHANNEL_SAVED)
            .setSmallIcon(R.drawable.ic_stat_recording)
            .setContentTitle(context.getString(R.string.rec_notification_saved_title))
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .build()

    private fun openAppIntent(): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent().setPackage(context.packageName)
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, RecordingService::class.java).setAction(action)
        return PendingIntent.getService(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    companion object {
        const val CHANNEL_RECORDING = "recording"
        const val CHANNEL_SAVED = "recording_saved"
        const val ID_ONGOING = 4101
        const val ID_SAVED = 4102
    }
}
