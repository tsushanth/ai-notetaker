/**
 * Text-to-Speech Service
 * Uses self-hosted Kokoro TTS (readaloud-tts on Cloud Run)
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

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

class TTSService {
  constructor() {
    this.MAX_CHUNK_SIZE = 5000;
  }

  /**
   * Split text into chunks that fit within TTS limits
   */
  splitTextIntoChunks(text, maxSize = this.MAX_CHUNK_SIZE) {
    const chunks = [];
    let currentChunk = '';

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    for (const sentence of sentences) {
      if (sentence.length > maxSize) {
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + word).length > maxSize) {
            chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          } else {
            currentChunk += word + ' ';
          }
        }
      } else if ((currentChunk + sentence).length > maxSize) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Clean text for TTS processing
   */
  cleanTextForTTS(text) {
    return text
      .replace(/\*\*.*?\*\*/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/Host \d+:/g, '')
      .replace(/\n\n+/g, ' ')
      .trim();
  }

  /**
   * Synthesize speech using self-hosted Kokoro TTS
   */
  async synthesizeWithKokoro(text, voice = 'nova', speed = 1.0) {
    const voiceId = KOKORO_VOICES[voice.toLowerCase()] || KOKORO_VOICES['nova'];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const endpoint = text.length > this.MAX_CHUNK_SIZE ? '/synthesize-long' : '/synthesize';

      const response = await fetch(`${TTS_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice_id: voiceId,
          speed: Math.max(0.5, Math.min(2.0, speed)),
          model: 'kokoro',
          language: 'en',
          max_chunk_chars: this.MAX_CHUNK_SIZE,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kokoro TTS error (${response.status}): ${error}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Kokoro TTS request timed out after 120 seconds');
      }
      throw error;
    }
  }

  /**
   * Main synthesis method
   */
  async synthesize(text, options = {}) {
    const { voice = 'nova', speed = 1.0 } = options;

    const cleanText = this.cleanTextForTTS(text);
    if (!cleanText || cleanText.length === 0) {
      throw new Error('Text is required');
    }

    logger.info('TTS synthesis request', {
      textLen: cleanText.length,
      voice,
      kokoroVoice: KOKORO_VOICES[voice.toLowerCase()] || KOKORO_VOICES['nova'],
    });

    // Kokoro's /synthesize-long handles chunking server-side
    return await this.synthesizeWithKokoro(cleanText, voice, speed);
  }

  /**
   * Generate audio from text (legacy method for compatibility)
   */
  async generateAudio(text, voice = 'alloy') {
    return await this.synthesize(text, { voice });
  }

  /**
   * Generate audio from multiple chunks (fallback if needed)
   */
  async generateAudioFromChunks(text, voice, speed = 1.0) {
    const chunks = this.splitTextIntoChunks(text);
    logger.info(`Kokoro TTS: Processing ${chunks.length} chunks`);

    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await this.synthesizeWithKokoro(chunks[i], voice, speed);
      audioBuffers.push(buffer);
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return Buffer.concat(audioBuffers);
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

      const cleanText = segment.text
        .replace(/\*\*.*?\*\*/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\n\n+/g, ' ')
        .trim();

      if (!cleanText) continue;

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

    return Buffer.concat(audioBuffers);
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

  /**
   * Generate TTS for a note and save to storage
   */
  async generateForNote(userId, noteId, options = {}) {
    const { voice = 'nova', speed = 1.0 } = options;

    const { data: note, error: noteError } = await supabaseAdmin
      .from('notes')
      .select('content, formatted_content, title')
      .eq('id', noteId)
      .eq('user_id', userId)
      .single();

    if (noteError || !note) {
      throw new Error('Note not found');
    }

    const textToSpeak = note.formatted_content || note.content;
    if (!textToSpeak || textToSpeak.length === 0) {
      throw new Error('Note has no content');
    }

    const audioBuffer = await this.synthesize(textToSpeak, { voice, speed });

    const fileName = `tts/${userId}/${noteId}-${Date.now()}.wav`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/wav',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(fileName);

    const audioUrl = urlData.publicUrl;
    const estimatedDuration = Math.ceil((textToSpeak.length / 5) / 150 * 60);

    const { error: dbError } = await supabaseAdmin
      .from('ai_content')
      .upsert({
        note_id: noteId,
        content_type: 'tts',
        content: {
          audio_url: audioUrl,
          voice,
          speed,
          duration_seconds: estimatedDuration,
          text_length: textToSpeak.length,
        },
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'note_id,content_type',
      });

    if (dbError) {
      logger.error('Failed to save TTS to ai_content', {
        error: dbError.message,
        code: dbError.code,
        details: dbError.details,
        noteId,
        userId
      });
    } else {
      logger.info('TTS saved to ai_content', { noteId, audioUrl });
    }

    return {
      audio_url: audioUrl,
      voice,
      speed,
      duration_seconds: estimatedDuration,
    };
  }

  /**
   * Get saved TTS for a note
   */
  async getTTSForNote(userId, noteId) {
    logger.info('Fetching saved TTS', { noteId, userId });

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
