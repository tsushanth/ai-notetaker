# Device test plan: Android recording reliability

Nothing in this change has been run on a phone. This plan is what has to pass on a real device before the change is
merged or released. Run it on a Pixel with Android 15 or 16 (the newest available), and repeat tests 3, 4, 6 and 9 on
one older phone (Android 13 or 14) because the foreground-service rules differ by version.

## Setup

- Build: `cd android && ./gradlew :app:assembleDebug`, install `app/build/outputs/apk/debug/app-debug.apk`.
- Use a test account. Keep the phone plugged in unless a test says otherwise. Read this passage aloud for every
  speech test so the transcript can be checked: "The quick brown fox jumps over the lazy dog. Today is a good day to
  test the recorder. One, two, three, four, five."
- Open a log window before each test:
  `adb logcat -c; adb logcat -v time RecordingService:* RecordingEnv:* RecordingBootstrap:* WM-WorkerWrapper:* AnalyticsService:* *:S`
  Debug builds also print every analytics event as `📊 recording_...` under the `AnalyticsService` tag.
- Useful system views while a test runs:
  - `adb shell dumpsys activity services com.kreativekoala.scribeai | grep -i -A6 RecordingService` (is it a foreground service of type microphone)
  - `adb shell dumpsys audio | grep -i -B2 -A8 "recording"` (the active capture, and whether it is `silenced`)
  - `adb shell dumpsys notification --noredact | grep -A12 com.kreativekoala.scribeai` (the ongoing notification)
- Pull the stored audio from a debug build for inspection:
  `adb shell run-as com.kreativekoala.scribeai ls -l files/recordings` and
  `adb exec-out run-as com.kreativekoala.scribeai cat files/recordings/<id>.aac > rec.aac`, then
  `ffprobe rec.aac` (should show aac, 16000 Hz, mono, about 64 kb/s) and play it.

## Test 0 (gate): does the transcription pipeline accept the new audio format?

The recording format changed from MP4/M4A to raw ADTS AAC (`.aac`, 16 kHz mono, 64 kbps) so that a killed process
still leaves a playable file. The backend was not changed and already lists `audio/aac` and `aac` as accepted, but
that path had not been used by this app before.

1. Record 20 seconds of the passage, send it.
2. Pass: a note appears whose text matches the passage. In the database the new row in `recordings` has
   `format = 'aac'` and `status = 'completed'`.
3. Fail: `PROVIDER_ERROR`, `NO_SPEECH` with `level audible`, or an empty note. Then the format must be changed
   before anything else is tested (fall back to M4A with segments).

## Tests

For every test capture: a screen recording, the logcat, and the event rows (see "Reading the events").

| # | Test | Steps | Pass criteria |
|---|---|---|---|
| 1 | 30 s recording | Record the passage for 30 s, stop, send. | Note created. `recording_stopped`: `reason=user`, `duration_ms` 30000 +/- 1500, `silent=false`, `peak_amplitude` > 1000. Transcript matches the passage. |
| 2 | 5 min | Record 5 min while reading or playing speech, screen on. | Same as 1, duration 300 s +/- 2 s, upload percent advances smoothly, note created. |
| 3 | Lock the screen 2 min | Record. After 20 s press power (screen off) for 120 s. Unlock. Keep recording 20 s. Stop, send. | Timer in the notification kept counting while locked. Audio file duration equals wall clock +/- 2 s. **No** silent stretch in the middle (play it back; `recording_stopped.silent_pct` below 15). Transcript contains words from before, during (play speech from a second device near the phone) and after the lock. |
| 4 | Switch apps | Record. Open Maps, then the camera, then Chrome for about 30 s each. Return via the notification. Stop. | Same as 3. Logcat has **no** line "Foreground service started from background can not have location/camera/microphone access". |
| 5 | Incoming phone call | Record. From another phone call this one, let it ring 10 s, answer, talk 10 s, hang up. | Recording pauses when the call takes audio focus (`recording_interruption` kind `focus_transient`), the notification shows "Recording paused" or the paused hint is shown in the app, and it resumes by itself after the call (state back to recording). The saved file has no recorded call audio and no crash. If the call took the focus **permanently** the screen shows "Paused because another app took the audio" and the Resume button works. |
| 6 | Kill the process | (a) Record 60 s, then swipe the app away from recents. (b) Record 60 s, then `adb shell am force-stop com.kreativekoala.scribeai`. (c) Record 60 s, `adb shell run-as com.kreativekoala.scribeai kill -9 $(adb shell pidof com.kreativekoala.scribeai)` if available. | (a) Clean stop: a "Recording saved" notification appears; opening the app shows the recording under "Unsent recordings" with about 60 s. (b)/(c) The service dies with no cleanup: on the next launch the recording appears under "Unsent recordings", marked "Recovered after the app was closed", duration within 1 s of what was recorded, and it plays back. A `recording_stopped` event with `reason=process_death` and a `recording_recovered` event with `action=offered` are present. Sending it creates a note. |
| 7 | Airplane mode during upload | Record 5 min, tap Process. At about 30% turn airplane mode on for 90 s, then off. | Screen moves to "Waiting for a connection / Trying again in N s" (not an error). After connectivity returns the upload finishes by itself and a note is created. Events: `recording_upload_failed` with `kind=network`, `will_retry=true`, then `recording_upload_completed` with a higher `attempt`. Known limit: the upload restarts from zero (single multipart request), so check the server did not create two notes; one extra `recordings` row for the same audio is possible (documented risk). |
| 8 | Kill the app while uploading | Tap Process on a 5 min recording, force-stop at about 50%. Relaunch. | The upload resumes by itself within about a minute of launch (WorkManager plus launch recovery), no duplicate note, the unsent card disappears after success. |
| 9 | Bluetooth headset | Pair earbuds with a microphone. Record the passage with them connected, 60 s. Then record again and disconnect them after 20 s. | Recording keeps running in both cases. `recording_started.input_route` shows the route the system chose. The file contains the spoken passage (from the phone microphone or the headset microphone; note which). On disconnect a `recording_interruption` route event is logged and the audio does not go silent for more than 2 s. **Record what route was used**: with a plain `MediaRecorder` and `AudioSource.MIC`, Android may keep using the phone microphone even with a Bluetooth headset connected, which is acceptable; if the user expects the headset microphone, that is a product follow-up. |
| 10 | Wired or USB headset (if available) | Plug in, record 60 s, unplug at 30 s. | Same as 9. |
| 11 | Low storage | Fill storage so about 150 MB is free (`adb shell` with `fallocate -l <size> /sdcard/Download/fill.bin`). Start recording. Add more fill to leave 80 MB, then 15 MB. | Start works at 150 MB. At about 80 MB the screen shows the low-storage warning. At about 15 MB the recording stops by itself, is kept (`detail=low_storage`), a "Recording saved" notification appears. With under 50 MB free at the start, recording refuses with "Not enough free storage". Delete the fill file afterwards. |
| 12 | Low battery | `adb shell dumpsys battery unplug; adb shell dumpsys battery set level 14`, start recording, then `set level 3`. Finish with `dumpsys battery reset`. | At 14% the low-battery warning appears. At 3% (not charging) the recording stops by itself and is kept (`detail=low_battery`). While charging it never stops. |
| 13 | Silent microphone guard | Android 12+: turn the microphone privacy toggle off in quick settings, then record 15 s. | Within about 6 s the screen shows "No sound detected..." (and the notification line says "No sound detected"). After stop the review screen says no sound was recorded and the button reads "Send anyway". `recording_warning` kind `no_sound` is logged, `recording_stopped.silent=true`. Turn the toggle back on afterwards. |
| 14 | Another app holds the microphone | Start a voice recorder app first, then start recording in ScribeAI (or the reverse), speak 15 s. | If Android silences one of them, ScribeAI shows "Another app is using the microphone" (`recording_warning` kind `mic_silenced`) rather than failing silently. Note which app won. |
| 15 | Rotation | Rotate during recording, during the review screen and during upload. | Timer, state and progress stay correct; nothing is restarted or lost. |
| 16 | Permissions | (a) Deny the notification permission, then record. (b) Deny the microphone permission twice, tap the button again. (c) Revoke the microphone permission in Settings while recording. | (a) Recording works, no notification in the shade (the service is still listed in the Task Manager). (b) The button opens the app settings page. (c) The system stops the process; on relaunch the recording is offered as recovered. |
| 17 | 30 min recording, screen off, unplugged | Record 30 min with the screen off and the phone unplugged (read or play speech occasionally). | Duration 30 min +/- 5 s. File about 14 MB (`ls -l`). No silent stretch in the middle. Note battery use over the 30 min (Settings > Battery) and whether the notification timer ever froze (that would indicate CPU sleep, the trigger to add a time-limited wake lock). |
| 18 | Doze | Record 10 min, screen off, then `adb shell dumpsys deviceidle force-idle` at minute 3, `unforce` at minute 8. | The recording continues through forced idle with no silent stretch. |

## Reading the events

Debug builds print them in logcat. Server side they are in `analytics_events` (event name starts with `recording_`),
properties in `event_data->'properties'`:

```sql
select created_at, event_name, event_data->'properties' as p
from analytics_events
where user_id = '<test user id>' and event_name like 'recording_%'
order by created_at;
```

The `local_id` property joins all events of one recording, and `server_recording_id` joins them to the `recordings`
table (`status`, `error_message`).

Success rate over a period (completed recordings of at least 60 s, per started recording):

```sql
with started as (
  select event_data->'properties'->>'local_id' as id, created_at
  from analytics_events where event_name = 'recording_started'
    and event_data->'properties'->>'local_id' is not null and created_at > now() - interval '7 days'
), stopped as (
  select event_data->'properties'->>'local_id' as id,
         event_data->'properties'->>'reason' as reason,
         (event_data->'properties'->>'duration_ms')::bigint as duration_ms,
         (event_data->'properties'->>'silent')::boolean as silent
  from analytics_events where event_name = 'recording_stopped'
), outcome as (
  select event_data->'properties'->>'local_id' as id, event_data->'properties'->>'outcome' as outcome
  from analytics_events where event_name = 'recording_transcription_outcome'
)
select count(*) as started,
       count(*) filter (where s.id is not null) as stopped_cleanly,
       count(*) filter (where s.silent) as silent_recordings,
       count(*) filter (where o.outcome = 'completed') as completed,
       count(*) filter (where o.outcome = 'completed' and s.duration_ms >= 60000) as completed_over_60s
from started st
left join stopped s on s.id = st.id
left join outcome o on o.id = st.id;
```

Stop reasons: `select event_data->'properties'->>'reason', event_data->'properties'->>'detail', count(*) ... where event_name = 'recording_stopped' group by 1, 2`.

Events do not contain audio, transcript text, titles or account data (checked by `RecordingEventsTest`). Events from a
background-only process are queued in a file and arrive when the app is next opened, so their timestamps are the
time of delivery; use `elapsed_ms` and `duration_ms` for timing.

## What to hand back

For each test: pass/fail, the Android version and device, the `local_id` of the recording, the screen recording, and the
logcat segment. For failures also the `dumpsys audio` output taken while the failure was happening.

## What this plan cannot cover

- Samsung, Xiaomi, Oppo and other vendor battery managers that kill foreground services; test at least one if available.
- Android 16 on a tablet or foldable (orientation restrictions are ignored on large screens).
- Whether Play accepts the declaration; that is decided in review.
