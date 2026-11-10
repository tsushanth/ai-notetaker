package com.kreativekoala.scribeai.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RecordingEventsTest {

    private val common = mapOf<String, Any>("sdk_int" to 34, "manufacturer" to "google", "version_code" to 87)

    @Test
    fun everyRequestedPieceOfDataHasAHome() {
        val all = RecordingEvents.SCHEMA.values.flatten().toSet()
        // recording_started / stopped(reason) / duration / bytes / peak / silent / permission state
        listOf("reason", "duration_ms", "bytes", "peak_amplitude", "silent", "mic_permission", "notif_permission").forEach { assertTrue(it, it in all) }
        // upload started / completed / failed(code) and the transcription outcome
        assertTrue("http_code" in RecordingEvents.SCHEMA.getValue(RecordingEvents.UPLOAD_FAILED))
        assertTrue("outcome" in RecordingEvents.SCHEMA.getValue(RecordingEvents.TRANSCRIPTION_OUTCOME))
        // app version and Android SDK are added to every event
        assertEquals(setOf("sdk_int", "manufacturer", "version_code"), RecordingEvents.COMMON_KEYS)
    }

    @Test
    fun stopReasonsAreTheFiveRequestedValues() {
        assertEquals(setOf("user", "lock", "background", "process_death", "error"), StopReason.entries.map { it.wire }.toSet())
    }

    @Test
    fun validEventIsBuiltWithCommonProperties() {
        val built = RecordingEvents.build(
            RecordingEvents.STOPPED,
            mapOf("local_id" to "8f14e45f-ceea-4672-9a4e-0c2b1c3d4e5f", "reason" to "user", "detail" to "stop_button", "duration_ms" to 61_000L, "bytes" to 480_000L, "silent" to false),
            common
        )
        assertEquals(34, built["sdk_int"])
        assertEquals("user", built["reason"])
        assertEquals(false, built["silent"])
    }

    @Test
    fun nullPropertiesAreDropped() {
        val built = RecordingEvents.build(RecordingEvents.WARNING, mapOf("local_id" to null, "kind" to "no_sound"), common)
        assertFalse("local_id" in built)
    }

    @Test
    fun enumValuesAreSentAsLowercaseNames() {
        val built = RecordingEvents.build(RecordingEvents.TRANSCRIPTION_OUTCOME, mapOf("failure_kind" to FailureKind.NO_SPEECH), common)
        assertEquals("no_speech", built["failure_kind"])
    }

    private fun assertRejected(event: String, props: Map<String, Any?>) {
        try {
            RecordingEvents.build(event, props, common)
            fail("should have been rejected: $props")
        } catch (e: RecordingEvents.InvalidEventException) {
            // expected
        }
    }

    @Test
    fun keysOutsideTheSchemaAreRejected() {
        assertRejected(RecordingEvents.STOPPED, mapOf("title" to "my private lecture"))
        assertRejected(RecordingEvents.STARTED, mapOf("transcript" to "abc"))
        assertRejected(RecordingEvents.UPLOAD_STARTED, mapOf("email" to "a@b.c"))
        assertRejected("recording_something_else", mapOf("x" to 1))
    }

    @Test
    fun freeTextValuesAreRejected() {
        assertRejected(RecordingEvents.UPLOAD_FAILED, mapOf("kind" to "The server said: Daily limit reached"))
        assertRejected(RecordingEvents.STOPPED, mapOf("detail" to "John's meeting notes"))
        assertRejected(RecordingEvents.STOPPED, mapOf("detail" to "x".repeat(41)))
        assertRejected(RecordingEvents.STOPPED, mapOf("detail" to "UPPER"))
    }

    @Test
    fun unsupportedTypesAreRejected() {
        assertRejected(RecordingEvents.STOPPED, mapOf("bytes" to 1.5))
        assertRejected(RecordingEvents.STOPPED, mapOf("detail" to listOf("a")))
        try {
            RecordingEvents.build(RecordingEvents.STOPPED, emptyMap(), mapOf("email" to "a@b.c"))
            fail("common keys are restricted too")
        } catch (e: RecordingEvents.InvalidEventException) {
        }
    }

    @Test
    fun noPropertyNameCouldCarryPersonalContent() {
        val forbidden = listOf("title", "text", "transcript", "content", "email", "name", "token", "password", "phone", "address", "message", "audio", "note", "user_id", "ip", "error_message")
        for ((event, keys) in RecordingEvents.SCHEMA) {
            for (k in keys + RecordingEvents.COMMON_KEYS) {
                assertFalse("$event.$k looks like personal content", k in forbidden)
                assertFalse("$event.$k contains transcript/title/email", listOf("transcript", "title", "email").any { k.contains(it) })
            }
        }
    }

    @Test
    fun telemetryDropsABadEventInsteadOfCrashingTheRecording() {
        val sent = mutableListOf<String>()
        val logs = mutableListOf<String>()
        val t = RecordingTelemetry(object : EventSink {
            override fun send(name: String, props: Map<String, Any>) { sent += name }
        }, { common }, { logs += it })
        t.track(RecordingEvents.STOPPED, mapOf("title" to "x"))
        t.track(RecordingEvents.STOPPED, mapOf("reason" to "user"))
        assertEquals(listOf(RecordingEvents.STOPPED), sent)
        assertEquals(1, logs.size)
    }

    @Test
    fun disabledTelemetrySendsNothing() {
        val sent = mutableListOf<String>()
        val t = RecordingTelemetry(object : EventSink {
            override fun send(name: String, props: Map<String, Any>) { sent += name }
        }, { common })
        t.enabled = false
        t.track(RecordingEvents.STOPPED, mapOf("reason" to "user"))
        assertTrue(sent.isEmpty())
    }
}
