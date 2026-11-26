/**
 * Text-to-Speech Service
 * Uses self-hosted Kokoro TTS (readaloud-tts on Cloud Run)
 */

const crypto = require('crypto');
const { spawn } = require('child_process');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { reportFailure } = require('../utils/failureReporter');
const { TtsError } = require('../utils/ttsError');
const { cleanTextForSpeech, splitForSpeech } = require('../utils/speechText');
const { concatWav, wavSeconds } = require('../utils/wav');
const { resolveNoteId, isStockWelcomeNote } = require('./welcomeNote');
const { createPollySpeech } = require('./pollySpeech');

// Kokoro voice IDs mapped from legacy OpenAI-style names
const KOKORO_VOICES = {
  'nova': 'af_nicole',       // Female - warm
  'shimmer': 'af_sarah',     // Female - clear
  'alloy': 'am_adam',        // Male - versatile
  'echo': 'am_michael',      // Male - deep
  'fable': 'am_adam',        // Male - narration
  'onyx': 'am_michael',      // Male - authoritative
};

// Voice pairs for multi-host podcasts by gender
const VOICE_PAIRS = {
  female: ['nova', 'shimmer'],
  male: ['echo', 'onyx'],
  mixed: ['nova', 'echo'],
};

const TTS_BASE_URL = process.env.SELFHOSTED_TTS_URL || 'https://listenai-tts-worker.fly.dev';

// The worker works one request at a time and finishes it even after the caller has gone, so sending a timed-out piece
// again only queues the same work behind the first copy. One long wait, no resend.
const PIECE_TIMEOUT_MS = 180_000;
const PIECE_BUDGET_MS = 20_000;   // job time allowed per piece; a healthy worker takes about 11 s
const SLOW_PIECE_MS = 60_000;     // this slow twice running means the worker has used up its CPU credit
const RETRY_DELAY_MS = 1_000;
const MIN_SPLIT_CHARS = 40;      // a failing piece is halved down to this size before giving up
const PIECE_GAP_MS = 150;        // pause between pieces
const positive = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const jobDeadlineMs = () => positive(process.env.TTS_JOB_DEADLINE_MS, 10 * 60_000);
const maxChars = () => positive(process.env.TTS_MAX_CHARS, 20_000);
const MP3_BITS_PER_SECOND = 64_000; // constant bitrate, so a stored file's length follows from its size

/** WAV -> mono MP3 with the ffmpeg already in the image. Resolves null when that is not possible (the WAV is then used). */
function encodeMp3(wav, { ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-b:a', String(MP3_BITS_PER_SECOND), '-f', 'mp3', 'pipe:1'], { timeout: timeoutMs });
    } catch { return resolve(null); }
    const out = [];
    child.on('error', () => resolve(null));
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    child.stdout.on('data', (d) => out.push(d));
    child.on('close', (code) => resolve(code === 0 && out.length ? Buffer.concat(out) : null));
    child.stdin.end(wav);
  });
}

class TTSService {
  constructor() {
    // Off unless switched on and given its own key (services/pollySpeech.js); then it is tried before the own worker.
    this.paidSpeech = createPollySpeech({ encode: (audio) => encodeMp3(audio) });
  }

  /**
   * Clean text for TTS processing
   */
  cleanTextForTTS(text) {
    return cleanTextForSpeech(text);
  }

  /** One request to the Kokoro worker for one short piece. Resolves a WAV buffer or throws a TtsError. */
  async synthesizePiece(text, voiceId, speed) {
    let response;
    try {
      response = await fetch(`${TTS_BASE_URL}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice_id: voiceId,
          speed: Math.max(0.5, Math.min(2.0, speed)),
          model: 'kokoro',
          language: 'en',
        }),
        signal: AbortSignal.timeout(PIECE_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.text().catch(() => '');
        throw new TtsError('WORKER_ERROR', `worker answered ${response.status}`, { workerStatus: response.status });
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof TtsError) throw error;
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new TtsError('WORKER_TIMEOUT', 'worker did not answer in time');
      throw new TtsError('WORKER_UNREACHABLE', error.cause?.code || error.name);
    }
  }

  /**
   * A piece that fails is retried twice when the failure looks passing (network, 429/502/503/504), never after a timeout.
   * A 500 usually means the piece overflows the model, so it is halved and each half sent again. Nothing is ever skipped.
   */
  async synthesizeResilient(text, voiceId, speed, deadline, attempt = 1) {
    if (Date.now() > deadline) throw new TtsError('DEADLINE', 'job deadline reached');
    try {
      return [await this.synthesizePiece(text, voiceId, speed)];
    } catch (error) {
      const passing = error.code === 'WORKER_UNREACHABLE' || [429, 502, 503, 504].includes(error.workerStatus);
      if (passing && attempt < 3) {
        await new Promise((r) => setTimeout(r, positive(process.env.TTS_RETRY_DELAY_MS, RETRY_DELAY_MS) * attempt));
        return this.synthesizeResilient(text, voiceId, speed, deadline, attempt + 1);
      }
      if (error.workerStatus === 500 && text.length >= MIN_SPLIT_CHARS) {
        const halves = splitForSpeech(text, Math.ceil(text.length / 2));
        if (halves.length > 1) {
          const parts = [];
          for (const half of halves) parts.push(...await this.synthesizeResilient(half, voiceId, speed, deadline));
          return parts;
        }
      }
      throw error;
    }
  }

  /**
   * Synthesize speech using self-hosted Kokoro TTS: piece by piece, joined into one WAV. All of the text or an error.
   */
  async synthesizeWithKokoro(text, voice = 'nova', speed = 1.0, { deadline, stats } = {}) {
    const voiceId = KOKORO_VOICES[voice.toLowerCase()] || KOKORO_VOICES['nova'];
    const pieces = splitForSpeech(text);
    if (pieces.length === 0) throw new TtsError('NOTHING_TO_READ');
    if (stats) stats.pieces = pieces.length;
    // A long note needs more time than a short one: the deadline grows with the number of pieces.
    const until = deadline ?? Date.now() + Math.max(jobDeadlineMs(), pieces.length * PIECE_BUDGET_MS);
    const audio = [];
    let slow = 0;
    for (const [i, piece] of pieces.entries()) {
      const began = Date.now();
      audio.push(...await this.synthesizeResilient(piece, voiceId, speed, until));
      const took = Date.now() - began;
      slow = took > SLOW_PIECE_MS ? slow + 1 : 0;
      // At this pace the rest cannot finish in time, and staying on the shared worker only delays everyone else.
      if (slow >= 2 && Date.now() + (pieces.length - i - 1) * took > until) {
        throw new TtsError('WORKER_SLOW', `${i + 1} of ${pieces.length} pieces done`);
      }
    }
    try {
      return concatWav(audio, PIECE_GAP_MS);
    } catch (error) {
      throw new TtsError('BAD_AUDIO', error.message);
    }
  }

  /**
   * Main synthesis method
   */
  async synthesize(text, options = {}) {
    const { voice = 'nova', speed = 1.0 } = options;

    const cleanText = this.cleanTextForTTS(text);
    if (!cleanText || cleanText.length === 0) {
      throw new TtsError('NOTHING_TO_READ');
    }
    if (cleanText.length > maxChars()) {
      throw new TtsError('TOO_LONG', `${cleanText.length} characters`);
    }

    logger.info('TTS synthesis request', {
      textLen: cleanText.length,
      voice,
      kokoroVoice: KOKORO_VOICES[voice.toLowerCase()] || KOKORO_VOICES['nova'],
    });

    return await this.synthesizeWithKokoro(cleanText, voice, speed);
  }

  /**
   * Generate audio from text (legacy method for compatibility)
   */
  async generateAudio(text, voice = 'alloy') {
    return await this.synthesize(text, { voice });
  }

  /**
   * Parse podcast script into segments by speaker
   */
  parsePodcastScript(script) {
    const segments = [];
    const lines = script.split('\n');
    let currentSpeaker = 'narrator';
    let currentText = '';

    logger.info('Parsing podcast script', {
      scriptPreview: script.substring(0, 800),
      totalLength: script.length,
      lineCount: lines.length
    });

    let host1Count = 0;
    let host2Count = 0;

    for (const line of lines) {
      let trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const cleanLine = trimmedLine.replace(/\*\*/g, '');
      const hostMatch = cleanLine.match(/^(?:\[)?(?:Host|Speaker|Person|Voice)\s*(\d+)(?:\])?[:\-]\s*(.*)/i);

      if (hostMatch) {
        if (currentText.trim()) {
          segments.push({ speaker: currentSpeaker, text: currentText.trim() });
        }

        currentSpeaker = `Host ${hostMatch[1]}`;
        currentText = hostMatch[2] || '';

        if (hostMatch[1] === '1') host1Count++;
        else if (hostMatch[1] === '2') host2Count++;
      } else {
        currentText += ' ' + trimmedLine;
      }
    }

    if (currentText.trim()) {
      segments.push({ speaker: currentSpeaker, text: currentText.trim() });
    }

    const speakerCounts = {};
    segments.forEach(s => {
      speakerCounts[s.speaker] = (speakerCounts[s.speaker] || 0) + 1;
    });

    logger.info('Podcast script parsing results', {
      totalSegments: segments.length,
      speakerCounts,
      host1Lines: host1Count,
      host2Lines: host2Count,
      firstFewSegments: segments.slice(0, 3).map(s => ({
        speaker: s.speaker,
        textPreview: s.text.substring(0, 50)
      }))
    });

    return segments;
  }

  /**
   * Generate multi-voice podcast audio
   */
  async generatePodcastAudio(script, options = {}) {
    const { gender = 'female', speed = 1.0 } = options;

    const voicePair = VOICE_PAIRS[gender] || VOICE_PAIRS.female;
    const [voice1, voice2] = voicePair;

    logger.info('Generating multi-voice podcast', {
      gender,
      voice1,
      voice2,
      scriptLength: script.length
    });

    const segments = this.parsePodcastScript(script);

    if (segments.length === 0) {
      logger.warn('Failed to parse podcast script, using single voice');
      return await this.generateAudio(script, voice1);
    }

    const hasHost1 = segments.some(s => s.speaker === 'Host 1');
    const hasHost2 = segments.some(s => s.speaker === 'Host 2');
    const hasBothHosts = hasHost1 && hasHost2;

    logger.info(`Parsed ${segments.length} podcast segments`, {
      hasHost1,
      hasHost2,
      hasBothHosts,
      willAlternate: !hasBothHosts
    });

    const audioBuffers = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      let voice;
      if (hasBothHosts) {
        voice = segment.speaker === 'Host 2' ? voice2 : voice1;
      } else {
        voice = (i % 2 === 0) ? voice1 : voice2;
      }

      const cleanText = cleanTextForSpeech(segment.text);

      if (!splitForSpeech(cleanText).length) continue;

      logger.info(`Generating segment ${i + 1}/${segments.length}`, {
        speaker: segment.speaker,
        voice,
        textLength: cleanText.length,
        textPreview: cleanText.substring(0, 60)
      });

      try {
        const buffer = await this.synthesizeWithKokoro(cleanText, voice, speed);
        audioBuffers.push(buffer);

        if (i < segments.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        logger.error(`Error generating segment ${i + 1}`, {
          error: error.message,
          speaker: segment.speaker
        });
        throw error;
      }
    }

    logger.info('Concatenating podcast audio buffers', {
      bufferCount: audioBuffers.length
    });

    return concatWav(audioBuffers, PIECE_GAP_MS);
  }

  /**
   * Upload audio to Supabase storage
   */
  async uploadAudio(audioBuffer, userId, noteId) {
    const timestamp = Date.now();
    const storagePath = `podcasts/${userId}/${noteId}_${timestamp}.wav`;

    logger.info('Uploading audio to Supabase', {
      storagePath,
      sizeKB: (audioBuffer.length / 1024).toFixed(2),
    });

    const { error } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/wav',
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      throw error;
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(storagePath);

    logger.info('Audio uploaded successfully', { url: urlData.publicUrl });
    return urlData.publicUrl;
  }

  /**
   * Get available voices
   */
  getVoices() {
    return [
      { id: 'nova', name: 'Nicole', gender: 'Female', description: 'Warm and friendly' },
      { id: 'shimmer', name: 'Sarah', gender: 'Female', description: 'Soft and clear' },
      { id: 'alloy', name: 'Adam', gender: 'Male', description: 'Young and versatile' },
      { id: 'echo', name: 'Michael', gender: 'Male', description: 'Deep and engaging' },
      { id: 'fable', name: 'Adam', gender: 'Male', description: 'Expressive narration' },
      { id: 'onyx', name: 'Michael', gender: 'Male', description: 'Warm and authoritative' },
    ];
  }

  /**
   * Get TTS service status
   */
  async getStatus() {
    try {
      const response = await fetch(`${TTS_BASE_URL}/health`, { method: 'GET' });
      return {
        kokoro: {
          configured: true,
          healthy: response.ok,
          url: TTS_BASE_URL,
        },
        voiceCount: this.getVoices().length,
      };
    } catch {
      return {
        kokoro: { configured: true, healthy: false, url: TTS_BASE_URL },
        voiceCount: this.getVoices().length,
      };
    }
  }

  /** Audio of the app's own welcome text made earlier, or null. A miss or a storage error only means making it again. */
  async getSharedAudio(path) {
    try {
      const { data, error } = await supabaseAdmin.storage.from('audio').download(path);
      if (error || !data) return null;
      const audio = Buffer.from(await data.arrayBuffer());
      return audio.length ? audio : null;
    } catch (error) {
      logger.warn('Shared welcome audio could not be read', { error: error.message });
      return null;
    }
  }

  async storeSharedAudio(path, mp3) {
    try {
      const { error } = await supabaseAdmin.storage.from('audio').upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
      if (error) logger.warn('Shared welcome audio could not be stored', { error: error.message });
    } catch (error) {
      logger.warn('Shared welcome audio could not be stored', { error: error.message });
    }
  }

  /**
   * Generate TTS for a note and save to storage
   */
  async generateForNote(userId, noteId, options = {}) {
    const { voice = 'nova', speed = 1.0, stats = {} } = options;
    const id = await resolveNoteId(userId, noteId);

    const { data: note, error: noteError } = await supabaseAdmin
      .from('notes')
      .select('content, formatted_content, title, source_type')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (noteError && noteError.code !== 'PGRST116') {
      throw new TtsError('INTERNAL', `note lookup failed: ${noteError.code || 'unknown'}`);
    }
    if (!note) {
      throw new TtsError('NOTE_NOT_FOUND');
    }

    // The app's own welcome text is the same for everyone, so its audio can be made once. The formatted version is not
    // used for it: that differs from user to user, and the app shows its own copy anyway.
    const stock = isStockWelcomeNote(note);
    const cleanText = this.cleanTextForTTS(stock ? note.content : note.formatted_content || note.content);
    stats.chars = cleanText.length;
    if (!cleanText) {
      throw new TtsError('NOTHING_TO_READ');
    }
    if (cleanText.length > maxChars()) {
      throw new TtsError('TOO_LONG', `${cleanText.length} characters`);
    }

    // Same text, voice and speed already saved (for example by an earlier request that stopped waiting): reuse it.
    const textSha = crypto.createHash('sha256').update(cleanText).digest('hex');
    const saved = await this.getSavedAudio(id);
    if (saved && saved.text_sha256 === textSha && saved.voice === voice && saved.speed === speed) {
      return { audio_url: saved.audio_url, voice, speed, duration_seconds: saved.duration_seconds };
    }

    // Only the unchanged welcome text at normal speed is shared between users; every user still gets a file of their own.
    const sharedPath = stock && speed === 1
      ? `tts/shared/welcome/${textSha}-${KOKORO_VOICES[voice.toLowerCase()] || KOKORO_VOICES.nova}.mp3`
      : null;
    let wav = null;
    let mp3 = sharedPath ? await this.getSharedAudio(sharedPath) : null;
    let durationSeconds;
    // The welcome text stays on the shared audio made by the own worker: paying per new account would buy nothing.
    const paid = mp3 || stock ? null : await this.paidSpeech.synthesize(cleanText, { voice, speed, userId, noteId: id });
    if (paid) {
      ({ mp3, durationSeconds } = paid);
    } else if (mp3) {
      durationSeconds = Math.ceil((mp3.length * 8) / MP3_BITS_PER_SECOND);
    } else {
      wav = await this.synthesizeWithKokoro(cleanText, voice, speed, { stats });
      durationSeconds = Math.ceil(wavSeconds(wav));
      mp3 = await encodeMp3(wav); // about six times smaller: long notes exceed the storage size limit as WAV
      if (sharedPath && mp3) await this.storeSharedAudio(sharedPath, mp3);
    }

    const fileName = `tts/${userId}/${id}-${Date.now()}.${mp3 ? 'mp3' : 'wav'}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio')
      .upload(fileName, mp3 || wav, {
        contentType: mp3 ? 'audio/mpeg' : 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      throw new TtsError('UPLOAD_FAILED', uploadError.message);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(fileName);

    const audioUrl = urlData.publicUrl;

    const { error: dbError } = await supabaseAdmin
      .from('ai_content')
      .upsert({
        note_id: id,
        content_type: 'tts',
        content: {
          audio_url: audioUrl,
          voice,
          speed,
          duration_seconds: durationSeconds,
          text_length: cleanText.length,
          text_sha256: textSha,
        },
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'note_id,content_type',
      });

    if (dbError) {
      // The audio plays, but it will not be found when the note is reopened: report it.
      logger.error('Failed to save TTS to ai_content', {
        error: dbError.message,
        code: dbError.code,
        details: dbError.details,
        noteId: id,
        userId
      });
      void reportFailure('tts_failed', new Error('Read Aloud failed: SAVE_FAILED'), { code: 'SAVE_FAILED', db_code: String(dbError.code || 'unknown') });
    } else {
      logger.info('TTS saved to ai_content', { noteId: id, audioUrl });
    }

    return {
      audio_url: audioUrl,
      voice,
      speed,
      duration_seconds: durationSeconds,
    };
  }

  async getSavedAudio(noteId) {
    const { data } = await supabaseAdmin
      .from('ai_content')
      .select('content')
      .eq('note_id', noteId)
      .eq('content_type', 'tts')
      .limit(1);
    return data?.[0]?.content || null;
  }

  /**
   * Get saved TTS for a note
   */
  async getTTSForNote(userId, requestedNoteId) {
    const noteId = await resolveNoteId(userId, requestedNoteId);
    logger.info('Fetching saved TTS', { noteId, userId });

    // Only the owner of the note may read its audio.
    const { data: owned } = await supabaseAdmin
      .from('notes')
      .select('id')
      .eq('id', noteId)
      .eq('user_id', userId)
      .limit(1);
    if (!owned?.length) return null;

    const { data, error } = await supabaseAdmin
      .from('ai_content')
      .select('content, created_at')
      .eq('note_id', noteId)
      .eq('content_type', 'tts')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        logger.warn('Error fetching TTS', { error: error.message, code: error.code, noteId });
      } else {
        logger.info('No saved TTS found', { noteId });
      }
      return null;
    }

    if (!data) {
      logger.info('No saved TTS found', { noteId });
      return null;
    }

    logger.info('Found saved TTS', { noteId, audioUrl: data.content.audio_url });

    return {
      audio_url: data.content.audio_url,
      voice: data.content.voice,
      speed: data.content.speed,
      duration_seconds: data.content.duration_seconds,
      created_at: data.created_at,
    };
  }
}

module.exports = new TTSService();
module.exports.encodeMp3 = encodeMp3;
