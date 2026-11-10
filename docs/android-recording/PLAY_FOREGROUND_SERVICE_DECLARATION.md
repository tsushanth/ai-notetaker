# Play Console: foreground service permissions declaration (microphone)

For the person filing it in Play Console: **Policy and programs > App content > Foreground service permissions**.
The form asks, per foreground service type, for (1) what feature uses it, (2) the user impact if the system delays or
interrupts it, (3) a video link, and (4) a use case. Source of the form's fields:
https://support.google.com/googleplay/android-developer/answer/13392821 (fetched 2026-11-09; the page shows no
"last updated" date).

The app declares one foreground service: `com.kreativekoala.scribeai.recording.RecordingService`,
`android:foregroundServiceType="microphone"`, with the permissions `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MICROPHONE`, `RECORD_AUDIO` and `POST_NOTIFICATIONS`. No other foreground service type is used.

## Type: Microphone

### 1. Description of the functionality that uses this type

> ScribeAI lets a user record a voice note (a lecture, a meeting, a spoken memo) and turns it into a written note.
> When the user taps the Record button, the app starts a foreground service of type microphone so the recording keeps
> running when the user locks the screen or switches to another app, which is the normal way a lecture or meeting is
> recorded. While it runs, the service shows a persistent notification with an elapsed-time counter and Pause and
> Stop buttons. The service starts only after the user taps Record in the foreground app, uses the microphone only
> while a recording is running, and stops as soon as the user taps Stop (in the app or in the notification), swipes
> the app away, or the device is nearly out of battery or storage. The recorded audio is saved on the device and sent
> for transcription only when the user chooses to send it.

### 2. User impact if the system defers or interrupts the task

> If the system delayed the start, the first seconds of speech would be missing. If it interrupted the service while
> the screen is locked or another app is open, the recording would stop or contain silence for the rest of the
> session, and a lecture or meeting that cannot be repeated would be lost. Without the foreground service Android
> delivers silence to a microphone app that is in the background, so a recording started and then left running
> comes out empty.

### 3. Video

Link to an unlisted video made with the script below. Play requires, for the microphone type, that the video shows
"the user actively recording audio" (same support page).

### 4. Use case

Pick the closest entry in the preset list (a voice or audio recorder). If the list has none, choose "Other" and paste
the description in section 1. Re-check the list in Play Console: it is not reproduced here because it could not be
read without access to the console.

## Demo video script (about 90 seconds, one continuous screen recording with the screen-recording indicator visible)

Use a debug or release build with the foreground service in it, a test account, and a phone on Android 14 or newer.

1. Start on the app home screen. Say or caption: "ScribeAI, record a voice note."
2. Tap the **Record** option. The recording screen opens.
3. If the microphone permission dialog shows, tap **While using the app**. If the notification permission dialog
   shows (Android 13+), tap **Allow**. Show both dialogs on screen.
4. Tap the big **Record** button. Show the timer counting and the waveform moving.
5. Press **Home**. Pull down the notification shade. Point at the persistent notification: title "Recording voice
   note", the running timer, and the **Pause** and **Stop** buttons. Caption: "The foreground service
   notification is visible the whole time."
6. Press the power button to **lock the screen**. Wait 20 seconds. Wake and unlock the phone. Pull down the shade:
   the timer has kept counting (about 20 seconds more).
7. Open another app (for example Settings) for 10 seconds. Return to ScribeAI by tapping the notification.
8. In the notification tap **Pause** (timer stops, title changes to "Recording paused"), then **Resume**.
9. Speak a short sentence, then tap **Stop** in the app. Show the "Recording Complete" screen with the duration.
10. Tap **Process Recording**. Show the upload progress (percent) and then the transcription step, then the finished
    note. Caption: "Audio is sent only after the user taps this button."
11. Pull down the shade once more to show that the notification is gone: the service stopped with the recording.

Do not show real personal conversations; read a neutral text aloud.

## Platform behaviour this relies on

Pages below were read on 2026-11-09. The extracts of these pages show no "last updated" date, so the date is when
they were read. Please re-check the Android 16 items against the full pages before filing.

| Behaviour | Source |
|---|---|
| Android 14 (API 34): apps targeting 14 must declare a foreground service type in the manifest and the matching permission (`FOREGROUND_SERVICE_MICROPHONE`); a missing type throws `MissingForegroundServiceTypeException`, a missing permission or runtime prerequisite throws `SecurityException` on `startForeground()`. The type permissions are normal permissions, granted at install. | https://developer.android.com/about/versions/14/changes/fgs-types-required |
| Microphone type: needs the `RECORD_AUDIO` runtime permission granted **before** `startForeground()`. `RECORD_AUDIO` is a "while-in-use" permission, so a microphone foreground service cannot be created while the app is in the background and cannot be started from a `BOOT_COMPLETED` receiver (exemptions exist, for example a user tap on the app's own notification). | https://developer.android.com/develop/background-work/services/fgs/service-types and https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start |
| Android 12+ (API 31): apps cannot start a foreground service from the background (`ForegroundServiceStartNotAllowedException`) except in listed cases. Starting from a visible activity, or from a user action on the app's own UI (activity, notification, widget), is allowed. The app starts the service only from the recording screen, and the notification buttons only act on the already-running service. | https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start |
| Android 15 (API 35): `BOOT_COMPLETED` receivers may not start `microphone` foreground services (already true since 14); apps targeting 15 must be the top app or run a foreground service to request audio focus (the app requests focus after `startForeground()`). | https://developer.android.com/about/versions/15/behavior-changes-15 |
| Android 16 (API 36): the "behavior changes: apps targeting Android 16" page lists no change to microphone foreground services. Two changes affect the screen, not the service: orientation and resizability restrictions are ignored on large screens (more activity re-creation, so recording state lives in the service and a ViewModel), and predictive back is on by default (the screen uses `BackHandler`). | https://developer.android.com/about/versions/16/behavior-changes-16 |
| Audio input sharing: since Android 9 a background app without a foreground service receives silence; since Android 10 the system can silence an app when a higher-priority app captures (`AudioRecordingConfiguration.isClientSilenced()` / `AudioRecordingCallback` report it). The app uses that callback to warn the user. | https://developer.android.com/media/platform/sharing-audio-input |
| Play: targeting Android 14+ requires the per-type declaration in Play Console, with a video of the user starting the feature. | https://support.google.com/googleplay/android-developer/answer/13392821 |

## Notes for the declaration review

- The service is not used for uploads. Sending a recording is done with WorkManager, which is not a foreground service.
- No `dataSync`, `mediaPlayback`, `location` or `specialUse` type is declared.
- `WAKE_LOCK` is deliberately not requested. If device testing shows the recorder stalls with the screen off, add a
  time-limited partial wake lock and re-check the Android vitals "excessive partial wake locks" threshold first.
