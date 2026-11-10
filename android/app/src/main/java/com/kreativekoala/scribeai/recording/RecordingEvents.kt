package com.kreativekoala.scribeai.recording

/**
 * The per-recording analytics events and the rules their properties must follow.
 *
 * Privacy rules (enforced by [RecordingEvents.build] and checked in the unit tests):
 *  - every property key must be on the allow-list for that event;
 *  - string values are short codes (`[a-z0-9_.:-]`, max 40 chars): no free text, so a title, a transcript or an
 *    error message from the server can never be attached by accident;
 *  - numbers and booleans only otherwise. No audio, no transcript, no title, no account data.
 * The ids are random per-recording UUIDs that only join client events to the server's recording row.
 *
 * Events go through the app's existing AnalyticsService (batched POST /api/analytics/batch into analytics_events),
 * so no backend change is needed. The app has no analytics opt-out setting today; if one is added, route it
 * through [RecordingTelemetry.enabled].
 */
object RecordingEvents {
    const val STARTED = "recording_started"
    const val STOPPED = "recording_stopped"
    const val UPLOAD_STARTED = "recording_upload_started"
    const val UPLOAD_COMPLETED = "recording_upload_completed"
    const val UPLOAD_FAILED = "recording_upload_failed"
    const val TRANSCRIPTION_OUTCOME = "recording_transcription_outcome"
    const val RECOVERED = "recording_recovered"
    const val WARNING = "recording_warning"
    const val INTERRUPTION = "recording_interruption"

    /** Properties added to every event. */
    val COMMON_KEYS = setOf("sdk_int", "manufacturer", "version_code")

    val SCHEMA: Map<String, Set<String>> = mapOf(
        STARTED to setOf("local_id", "mic_permission", "notif_permission", "fg_service", "input_route", "free_storage_mb", "battery_pct", "charging", "audio_focus", "start_error"),
        STOPPED to setOf("local_id", "reason", "detail", "duration_ms", "bytes", "peak_amplitude", "silent", "silent_pct", "warned_no_sound", "pauses", "interruptions", "input_route"),
        UPLOAD_STARTED to setOf("local_id", "attempt", "bytes", "trigger"),
        UPLOAD_COMPLETED to setOf("local_id", "server_recording_id", "attempt", "bytes", "elapsed_ms"),
        UPLOAD_FAILED to setOf("local_id", "attempt", "http_code", "kind", "will_retry"),
        TRANSCRIPTION_OUTCOME to setOf("local_id", "server_recording_id", "outcome", "error_code", "failure_kind", "elapsed_ms"),
        RECOVERED to setOf("local_id", "action", "duration_ms", "bytes", "age_hours"),
        WARNING to setOf("local_id", "kind", "elapsed_ms"),
        INTERRUPTION to setOf("local_id", "kind", "phase")
    )

    private val CODE = Regex("^[a-z0-9_.:-]{0,40}$")

    class InvalidEventException(message: String) : IllegalArgumentException(message)

    /**
     * Validates and returns the property map, or throws [InvalidEventException]. Values may be String (a short code),
     * Int, Long, or Boolean.
     */
    fun build(event: String, props: Map<String, Any?>, common: Map<String, Any> = emptyMap()): Map<String, Any> {
        val allowed = SCHEMA[event] ?: throw InvalidEventException("unknown event $event")
        val out = LinkedHashMap<String, Any>()
        for ((k, v) in common) {
            if (k !in COMMON_KEYS) throw InvalidEventException("common key $k not allowed")
            out[k] = checkValue(k, v)
        }
        for ((k, v) in props) {
            if (v == null) continue
            if (k !in allowed) throw InvalidEventException("$event: property $k not in schema")
            out[k] = checkValue(k, v)
        }
        return out
    }

    private fun checkValue(key: String, v: Any): Any = when (v) {
        is Int, is Long, is Boolean -> v
        is String -> if (CODE.matches(v)) v else throw InvalidEventException("$key: not a short code")
        is Enum<*> -> v.name.lowercase()
        else -> throw InvalidEventException("$key: unsupported type ${v::class.simpleName}")
    }
}

/** Where built events go. The default sink is the app's AnalyticsService; tests use a list. */
interface EventSink {
    fun send(name: String, props: Map<String, Any>)
    fun flush() {}
}

/** Builds, validates and sends events. A bad event is dropped and logged, it never crashes a recording. */
class RecordingTelemetry(
    private val sink: EventSink,
    private val common: () -> Map<String, Any>,
    private val log: (String) -> Unit = {}
) {
    @Volatile var enabled: Boolean = true

    fun track(event: String, props: Map<String, Any?>) {
        if (!enabled) return
        try {
            sink.send(event, RecordingEvents.build(event, props, common()))
        } catch (e: RecordingEvents.InvalidEventException) {
            log("dropped event: ${e.message}")
        }
    }

    fun flush() { if (enabled) sink.flush() }
}
