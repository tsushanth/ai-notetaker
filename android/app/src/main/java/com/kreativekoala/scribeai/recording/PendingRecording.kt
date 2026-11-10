package com.kreativekoala.scribeai.recording

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File

/**
 * Where a recording is in its life. Persisted, so a killed process can resume exactly here.
 *
 * RECORDING -> RECORDED -> UPLOADING -> UPLOADED -> TRANSCRIBING -> DONE (files deleted)
 *                              \-> WAITING (retry later) | FAILED (final, shown to the user)
 */
enum class RecordingPhase { RECORDING, RECORDED, UPLOADING, UPLOADED, TRANSCRIBING, WAITING, FAILED, DONE }

/**
 * The small JSON file next to each recording's audio file. No audio, transcript or personal data: ids, sizes,
 * counters and codes only (the title the user typed is kept here because it is sent with the upload).
 */
data class PendingRecording(
    val id: String,
    val phase: RecordingPhase = RecordingPhase.RECORDING,
    val createdAtMs: Long = 0L,
    val title: String = "",
    val durationMs: Long = 0L,
    val bytes: Long = 0L,
    val peakAmplitude: Int = 0,
    val silentPercent: Int = 0,
    val allSilent: Boolean = false,
    val stopReason: String? = null,
    val stopDetail: String? = null,
    /** Id the server gave the uploaded recording; once set, the audio is on the server. */
    val serverRecordingId: String? = null,
    val noteId: String? = null,
    val uploadAttempts: Int = 0,
    /** Final or last failure, as a [FailureKind] name plus the plain text to show. */
    val failureKind: String? = null,
    val failureMessage: String? = null,
    val appVersionCode: Int = 0
) {
    fun toJson(): String {
        val o = JsonObject()
        o.addProperty("v", 1)
        o.addProperty("id", id)
        o.addProperty("phase", phase.name)
        o.addProperty("createdAtMs", createdAtMs)
        o.addProperty("title", title)
        o.addProperty("durationMs", durationMs)
        o.addProperty("bytes", bytes)
        o.addProperty("peakAmplitude", peakAmplitude)
        o.addProperty("silentPercent", silentPercent)
        o.addProperty("allSilent", allSilent)
        stopReason?.let { o.addProperty("stopReason", it) }
        stopDetail?.let { o.addProperty("stopDetail", it) }
        serverRecordingId?.let { o.addProperty("serverRecordingId", it) }
        noteId?.let { o.addProperty("noteId", it) }
        o.addProperty("uploadAttempts", uploadAttempts)
        failureKind?.let { o.addProperty("failureKind", it) }
        failureMessage?.let { o.addProperty("failureMessage", it) }
        o.addProperty("appVersionCode", appVersionCode)
        return o.toString()
    }

    companion object {
        /** Tolerant parse: unknown or missing fields fall back to defaults, a damaged file gives null. */
        fun fromJson(text: String): PendingRecording? = try {
            val o = JsonParser.parseString(text).asJsonObject
            fun str(k: String): String? = o.get(k)?.takeIf { it.isJsonPrimitive }?.asString
            fun lng(k: String): Long = o.get(k)?.takeIf { it.isJsonPrimitive }?.asLong ?: 0L
            fun int(k: String): Int = o.get(k)?.takeIf { it.isJsonPrimitive }?.asInt ?: 0
            val id = str("id")
            if (id.isNullOrBlank()) null else PendingRecording(
                id = id,
                phase = str("phase")?.let { p -> RecordingPhase.entries.firstOrNull { it.name == p } } ?: RecordingPhase.RECORDED,
                createdAtMs = lng("createdAtMs"),
                title = str("title") ?: "",
                durationMs = lng("durationMs"),
                bytes = lng("bytes"),
                peakAmplitude = int("peakAmplitude"),
                silentPercent = int("silentPercent"),
                allSilent = o.get("allSilent")?.takeIf { it.isJsonPrimitive }?.asBoolean ?: false,
                stopReason = str("stopReason"),
                stopDetail = str("stopDetail"),
                serverRecordingId = str("serverRecordingId"),
                noteId = str("noteId"),
                uploadAttempts = int("uploadAttempts"),
                failureKind = str("failureKind"),
                failureMessage = str("failureMessage"),
                appVersionCode = int("appVersionCode")
            )
        } catch (e: Exception) {
            null
        }
    }
}

/**
 * Recordings on disk: `<dir>/<id>.aac` (audio, written while recording) and `<dir>/<id>.json` (the manifest).
 * [dir] is the app's private files directory, not the cache: the system may clear the cache at any time under low
 * storage, which would lose an unsent recording.
 */
class PendingRecordingStore(private val dir: File) {
    init { dir.mkdirs() }

    fun audioFile(id: String) = File(dir, "$id.${RecordingConfig.FILE_EXTENSION}")
    private fun manifestFile(id: String) = File(dir, "$id.json")

    /** Atomic: write a temp file, then rename over the manifest, so a crash never leaves half a manifest. */
    @Synchronized
    fun save(p: PendingRecording) {
        val tmp = File(dir, "${p.id}.json.tmp")
        tmp.writeText(p.toJson())
        if (!tmp.renameTo(manifestFile(p.id))) {
            manifestFile(p.id).writeText(p.toJson())
            tmp.delete()
        }
    }

    @Synchronized
    fun load(id: String): PendingRecording? {
        val f = manifestFile(id)
        return if (f.exists()) PendingRecording.fromJson(f.readText()) else null
    }

    @Synchronized
    fun update(id: String, change: (PendingRecording) -> PendingRecording): PendingRecording? {
        val current = load(id) ?: return null
        val next = change(current)
        save(next)
        return next
    }

    /** Newest first. Damaged manifests are skipped. */
    @Synchronized
    fun list(): List<PendingRecording> =
        (dir.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray())
            .mapNotNull { f -> runCatching { PendingRecording.fromJson(f.readText()) }.getOrNull() }
            .sortedByDescending { it.createdAtMs }

    @Synchronized
    fun delete(id: String) {
        audioFile(id).delete()
        manifestFile(id).delete()
        File(dir, "$id.json.tmp").delete()
    }

    /** Deletes the audio only (the manifest stays so the failure can still be shown). */
    @Synchronized
    fun deleteAudio(id: String) { audioFile(id).delete() }

    /** Audio files with no manifest (a crash between creating the file and saving the manifest). */
    @Synchronized
    fun orphanAudioIds(): List<String> =
        (dir.listFiles { f -> f.name.endsWith(".${RecordingConfig.FILE_EXTENSION}") } ?: emptyArray())
            .map { it.name.removeSuffix(".${RecordingConfig.FILE_EXTENSION}") }
            .filter { !manifestFile(it).exists() }
}

/** What launch-time recovery does with one stored recording. */
sealed interface RecoveryAction {
    val id: String

    data class Discard(override val id: String, val why: String) : RecoveryAction
    /** Cut a half-written tail, work out the duration, and mark it RECORDED so the user can send it. */
    data class Finalize(override val id: String) : RecoveryAction
    /**
     * Sending was under way (or waiting to retry) when the process ended: queue the upload/transcription work again.
     * It picks up from the stored phase, so nothing already uploaded is uploaded twice.
     */
    data class Resume(override val id: String) : RecoveryAction
    data class Keep(override val id: String) : RecoveryAction
}

/**
 * Decides what to do with each stored recording at launch. Pure: the caller passes facts about the files in
 * ([audioBytes] for each id) and the id of a recording the running service still owns, if any.
 */
object RecoveryPlanner {
    private val IN_FLIGHT = setOf(RecordingPhase.UPLOADING, RecordingPhase.UPLOADED, RecordingPhase.TRANSCRIBING, RecordingPhase.WAITING)

    fun plan(
        recordings: List<PendingRecording>,
        audioBytes: (String) -> Long,
        activeRecordingId: String?,
        nowMs: Long
    ): List<RecoveryAction> = recordings.map { p ->
        val bytes = audioBytes(p.id)
        when {
            p.id == activeRecordingId -> RecoveryAction.Keep(p.id)
            p.phase == RecordingPhase.RECORDING ->
                if (bytes <= 0L) RecoveryAction.Discard(p.id, "no_audio") else RecoveryAction.Finalize(p.id)
            p.phase == RecordingPhase.DONE -> RecoveryAction.Discard(p.id, "already_done")
            p.phase == RecordingPhase.FAILED ->
                if (nowMs - p.createdAtMs > RecordingConfig.STALE_FAILED_MS) RecoveryAction.Discard(p.id, "stale_failed") else RecoveryAction.Keep(p.id)
            // On the server already: only the transcription is missing, the local audio is not needed.
            p.phase in IN_FLIGHT && p.serverRecordingId != null -> RecoveryAction.Resume(p.id)
            p.serverRecordingId == null && bytes <= 0L -> RecoveryAction.Discard(p.id, "audio_missing")
            p.phase in IN_FLIGHT -> RecoveryAction.Resume(p.id)
            else -> RecoveryAction.Keep(p.id) // RECORDED: waiting for the user to send or discard it
        }
    }
}
