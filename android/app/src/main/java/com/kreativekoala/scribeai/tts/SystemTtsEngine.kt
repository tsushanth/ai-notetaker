package com.kreativekoala.scribeai.tts

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Phase A engine — wraps Android's built-in [TextToSpeech] service.
 *
 * Always on-device when the system has at least one network-independent voice
 * installed (default on most Pixel/Samsung devices). Voices marked
 * [Voice.isNetworkConnectionRequired] are filtered out so we don't accidentally
 * use a cloud voice and break the offline guarantee.
 */
class SystemTtsEngine(private val context: Context) : TtsEngine {

    companion object {
        private const val TAG = "SystemTtsEngine"
        private const val UTTERANCE_PREFIX = "scribeai_"
        // Android's TextToSpeech.speak() truncates above 4000 chars. Stay
        // comfortably below so multi-byte/emoji content doesn't tip us over.
        private const val CHUNK_SIZE = 3500
    }

    private val _state = MutableStateFlow<TtsState>(TtsState.Idle)
    override val state: StateFlow<TtsState> = _state.asStateFlow()

    private val _voices = MutableStateFlow<List<TtsVoice>>(emptyList())
    override val voices: StateFlow<List<TtsVoice>> = _voices.asStateFlow()

    private var tts: TextToSpeech? = null
    private var prepared = false

    // Multi-utterance progress state: speak() may queue N chunks; we surface
    // a single 0..1 progress fraction across all of them.
    private var totalCharacters: Int = 0
    private var chunkOffsets: IntArray = IntArray(0)   // start char of each utterance
    private var charactersDoneBeforeCurrent: Int = 0
    private val finalUtteranceIds = mutableSetOf<String>()

    // Per-segment voice queue (only used by speakSegments). Drained one chunk
    // at a time so we can [setVoice] per chunk reliably — Android only honors
    // the voice that was current at speak() time.
    private data class TaggedChunk(val text: String, val voiceId: String?)
    private var voiceQueue: ArrayDeque<TaggedChunk> = ArrayDeque()
    private var voiceQueueDefaultSpeed: Float = 1.0f
    private var voiceMap: Map<String, Voice> = emptyMap()

    override suspend fun prepare() {
        if (prepared) return
        _state.value = TtsState.Preparing

        val initSucceeded = suspendCoroutine<Boolean> { cont ->
            tts = TextToSpeech(context.applicationContext) { status ->
                cont.resume(status == TextToSpeech.SUCCESS)
            }
        }

        if (!initSucceeded || tts == null) {
            _state.value = TtsState.Failed("System TextToSpeech failed to initialize")
            return
        }

        // Restrict to on-device voices to keep the offline guarantee.
        val onDeviceVoices: List<Voice> = tts?.voices
            ?.filter { !it.isNetworkConnectionRequired }
            ?.toList()
            ?: emptyList()

        _voices.value = onDeviceVoices.map { voice ->
            TtsVoice(
                id = voice.name,
                displayName = humanizeVoiceName(voice),
                locale = voice.locale.toLanguageTag(),
                isFemale = inferFemale(voice),
                isOnDevice = true,
            )
        }

        // Default to system Locale; user's voice picker overrides per-call.
        tts?.language = Locale.getDefault()

        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                charactersDoneBeforeCurrent = chunkStartFor(utteranceId)
                emitSpeakingProgress(rangeEnd = 0)
            }

            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                emitSpeakingProgress(rangeEnd = end)
            }

            override fun onDone(utteranceId: String?) {
                if (utteranceId != null && finalUtteranceIds.contains(utteranceId)) {
                    _state.value = TtsState.Idle
                    finalUtteranceIds.clear()
                    voiceQueue.clear()
                } else if (voiceQueue.isNotEmpty()) {
                    // Multi-voice mode: drain the next tagged chunk.
                    val nextOffset = chunkStartFor(utteranceId, fallbackToEnd = true)
                    charactersDoneBeforeCurrent = nextOffset
                    emitSpeakingProgress(rangeEnd = 0)
                    speakNextQueuedChunk()
                } else {
                    // Single-voice queue path (chunks queued via QUEUE_ADD inside speak()).
                    val nextOffset = chunkStartFor(utteranceId, fallbackToEnd = true)
                    charactersDoneBeforeCurrent = nextOffset
                    emitSpeakingProgress(rangeEnd = 0)
                }
            }

            @Deprecated("API < 21")
            override fun onError(utteranceId: String?) {
                _state.value = TtsState.Failed("System TTS playback failed")
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                _state.value = TtsState.Failed("System TTS error $errorCode")
            }
        })

        prepared = true
        _state.value = TtsState.Ready
    }

    override suspend fun speakSegments(segments: List<TtsSegment>, speed: Float) {
        prepare()
        val engine = tts ?: run {
            _state.value = TtsState.Failed("System TTS not initialized")
            return
        }
        val cleanSegments = segments.filter { it.text.isNotBlank() }
        if (cleanSegments.isEmpty()) return
        engine.setSpeechRate(speed.coerceIn(0.5f, 2.0f))
        voiceQueueDefaultSpeed = speed

        // Flatten into ≤CHUNK_SIZE chunks, each tagged with its segment's voice.
        val tagged = mutableListOf<TaggedChunk>()
        for (seg in cleanSegments) {
            for (piece in splitIntoChunks(seg.text, CHUNK_SIZE)) {
                tagged.add(TaggedChunk(piece, seg.voiceId))
            }
        }
        if (tagged.isEmpty()) return

        totalCharacters = tagged.sumOf { it.text.length }
        chunkOffsets = IntArray(tagged.size).also {
            var running = 0
            tagged.forEachIndexed { i, c -> it[i] = running; running += c.text.length }
        }
        charactersDoneBeforeCurrent = 0
        finalUtteranceIds.clear()

        voiceMap = engine.voices?.associateBy { it.name } ?: emptyMap()
        voiceQueue = ArrayDeque(tagged)

        // Stop any in-flight playback, then kick off the first chunk. Subsequent
        // chunks fire from onDone in the progress listener.
        engine.stop()
        speakNextQueuedChunk()
    }

    /** Pull the next [TaggedChunk] off the voice queue, set its voice, and speak. */
    private fun speakNextQueuedChunk() {
        val engine = tts ?: return
        val chunk = voiceQueue.removeFirstOrNull() ?: return
        chunk.voiceId?.let { vid -> voiceMap[vid]?.let { engine.voice = it } }
        val isFinal = voiceQueue.isEmpty()
        val utteranceId = UTTERANCE_PREFIX + UUID.randomUUID() + if (isFinal) "_final" else ""
        if (isFinal) finalUtteranceIds.add(utteranceId)
        val params = Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
        }
        val result = engine.speak(chunk.text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
        if (result != TextToSpeech.SUCCESS) {
            _state.value = TtsState.Failed("System TTS rejected chunk (code $result)")
        }
    }

    override suspend fun speak(text: String, voiceId: String?, speed: Float) {
        prepare()
        val engine = tts ?: run {
            _state.value = TtsState.Failed("System TTS not initialized")
            return
        }

        val trimmed = text.trim()
        if (trimmed.isEmpty()) return

        if (voiceId != null) {
            val match = engine.voices?.firstOrNull { it.name == voiceId }
            if (match != null) engine.voice = match
        }
        engine.setSpeechRate(speed.coerceIn(0.5f, 2.0f))

        // Sentence-aware chunking — Android caps each speak() call near 4 KB.
        val chunks = splitIntoChunks(trimmed, CHUNK_SIZE)
        totalCharacters = trimmed.length
        chunkOffsets = IntArray(chunks.size)
        var running = 0
        chunks.forEachIndexed { i, c ->
            chunkOffsets[i] = running
            running += c.length
        }
        charactersDoneBeforeCurrent = 0
        finalUtteranceIds.clear()

        val baseId = UTTERANCE_PREFIX + UUID.randomUUID()
        val ids = chunks.indices.map { "${baseId}_$it" }
        // Mark only the LAST utterance as terminal so we don't flip Idle mid-queue.
        finalUtteranceIds.add(ids.last())

        chunks.forEachIndexed { i, chunk ->
            val params = Bundle().apply {
                putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, ids[i])
            }
            val mode = if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            val result = engine.speak(chunk, mode, params, ids[i])
            if (result != TextToSpeech.SUCCESS) {
                _state.value = TtsState.Failed("System TTS rejected chunk $i (code $result)")
                return
            }
        }
    }

    override fun pause() {
        // System TextToSpeech has no native pause — closest behavior is stop.
        // We surface as Paused so the UI state machine is coherent.
        tts?.stop()
        _state.value = TtsState.Paused
    }

    override fun resume() {
        // No-op for system TTS — caller must trigger speak() again.
        if (_state.value == TtsState.Paused) {
            _state.value = TtsState.Ready
        }
    }

    override fun stop() {
        voiceQueue.clear()
        finalUtteranceIds.clear()
        tts?.stop()
        _state.value = TtsState.Idle
    }

    override fun release() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (t: Throwable) {
            Log.w(TAG, "shutdown threw", t)
        }
        tts = null
        prepared = false
        _state.value = TtsState.Idle
    }

    // MARK: - Helpers

    /** Cumulative character offset where the given utterance starts. */
    private fun chunkStartFor(utteranceId: String?, fallbackToEnd: Boolean = false): Int {
        if (utteranceId == null || chunkOffsets.isEmpty()) return charactersDoneBeforeCurrent
        // Utterance ids look like "{baseId}_{index}".
        val idx = utteranceId.substringAfterLast('_').toIntOrNull() ?: return charactersDoneBeforeCurrent
        return when {
            idx in chunkOffsets.indices -> if (fallbackToEnd && idx + 1 < chunkOffsets.size) {
                chunkOffsets[idx + 1]
            } else if (fallbackToEnd) {
                totalCharacters
            } else {
                chunkOffsets[idx]
            }
            else -> charactersDoneBeforeCurrent
        }
    }

    private fun emitSpeakingProgress(rangeEnd: Int) {
        if (totalCharacters <= 0) {
            _state.value = TtsState.Speaking(progressFraction = 0f)
            return
        }
        val absolute = (charactersDoneBeforeCurrent + rangeEnd).coerceAtMost(totalCharacters)
        val frac = (absolute.toFloat() / totalCharacters).coerceIn(0f, 1f)
        _state.value = TtsState.Speaking(progressFraction = frac)
    }

    /**
     * Sentence-aware chunker matching the iOS Kokoro pattern.
     * Greedily glues sentences together up to [maxChars]; hard-splits anything
     * that doesn't fit on word boundaries (then character boundaries).
     */
    private fun splitIntoChunks(text: String, maxChars: Int): List<String> {
        if (text.length <= maxChars) return listOf(text)

        val sentences = mutableListOf<String>()
        var current = StringBuilder()
        for (ch in text) {
            current.append(ch)
            if (ch == '.' || ch == '!' || ch == '?' || ch == '\n') {
                val s = current.toString().trim()
                if (s.isNotEmpty()) sentences.add(s)
                current = StringBuilder()
            }
        }
        val tail = current.toString().trim()
        if (tail.isNotEmpty()) sentences.add(tail)

        val chunks = mutableListOf<String>()
        var buf = StringBuilder()
        for (s in sentences) {
            if (s.length > maxChars) {
                if (buf.isNotEmpty()) { chunks.add(buf.toString()); buf = StringBuilder() }
                chunks.addAll(hardSplit(s, maxChars))
                continue
            }
            if (buf.isEmpty()) {
                buf.append(s)
            } else if (buf.length + 1 + s.length <= maxChars) {
                buf.append(' ').append(s)
            } else {
                chunks.add(buf.toString())
                buf = StringBuilder(s)
            }
        }
        if (buf.isNotEmpty()) chunks.add(buf.toString())
        return chunks
    }

    private fun hardSplit(s: String, maxChars: Int): List<String> {
        val out = mutableListOf<String>()
        var buf = StringBuilder()
        for (word in s.split(' ')) {
            if (word.length > maxChars) {
                if (buf.isNotEmpty()) { out.add(buf.toString()); buf = StringBuilder() }
                var i = 0
                while (i < word.length) {
                    val end = (i + maxChars).coerceAtMost(word.length)
                    out.add(word.substring(i, end))
                    i = end
                }
                continue
            }
            if (buf.isEmpty()) {
                buf.append(word)
            } else if (buf.length + 1 + word.length <= maxChars) {
                buf.append(' ').append(word)
            } else {
                out.add(buf.toString())
                buf = StringBuilder(word)
            }
        }
        if (buf.isNotEmpty()) out.add(buf.toString())
        return out
    }

    private fun humanizeVoiceName(voice: Voice): String {
        // Android voice names look like "en-us-x-tpf-network" — strip the
        // 'network' suffix (we filter those out anyway) and prettify.
        val locale = voice.locale.displayName
        val gender = inferFemale(voice)?.let { if (it) "F" else "M" } ?: ""
        val suffix = if (gender.isNotEmpty()) " ($gender)" else ""
        return "$locale$suffix"
    }

    private fun inferFemale(voice: Voice): Boolean? {
        val name = voice.name.lowercase()
        return when {
            name.contains("-tpf-") || name.contains("female") -> true
            name.contains("-tpm-") || name.contains("male") -> false
            else -> null
        }
    }
}
