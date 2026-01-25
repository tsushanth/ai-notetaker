/**
 * Text-to-Speech Service
 * Uses ListenAI's self-hosted TTS as primary, OpenAI TTS as fallback
 * Supports voice cloning via Chatterbox model
 */

const fetch = require('node-fetch');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// TTS Service URLs
const LISTENAI_TTS_URL = process.env.LISTENAI_TTS_URL || 'https://readaloud-tts-917362189743.us-central1.run.app';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Built-in voices (Kokoro model)
const VOICE_MAPPING = {
  // Female voices
  'rachel': 'af_nicole',
  'bella': 'af_bella',
  'charlotte': 'bf_emma',
  'sarah': 'af_sarah',
  'sky': 'af_sky',
  // Male voices
  'adam': 'am_adam',
  'josh': 'am_michael',
  'brian': 'bm_george',
  'daniel': 'bm_daniel',
  'liam': 'bm_liam',
  // OpenAI compatible names
  'alloy': 'af_bella',
  'echo': 'am_adam',
  'fable': 'bm_george',
  'onyx': 'am_michael',
  'nova': 'af_nicole',
  'shimmer': 'af_sky',
};

// OpenAI voice fallback mapping
const OPENAI_VOICES = {
  'rachel': 'nova',
  'bella': 'shimmer',
  'charlotte': 'alloy',
  'sarah': 'nova',
  'sky': 'shimmer',
  'adam': 'onyx',
  'josh': 'echo',
  'brian': 'fable',
  'daniel': 'onyx',
  'liam': 'echo',
  'alloy': 'alloy',
  'echo': 'echo',
  'fable': 'fable',
  'onyx': 'onyx',
  'nova': 'nova',
  'shimmer': 'shimmer',
};

class TTSService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.MAX_CHUNK_SIZE = 4000;
    this.listenAIHealthy = true;
    this.lastHealthCheck = 0;
    this.healthCheckInterval = 30000; // 30 seconds
    this.consecutiveFailures = 0;
    this.maxFailures = 3;
  }

  /**
   * Check if ListenAI TTS service is healthy
   */
  async checkListenAIHealth() {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.listenAIHealthy;
    }

    try {
      const response = await fetch(`${LISTENAI_TTS_URL}/health`, {
        timeout: 5000,
      });
      this.listenAIHealthy = response.ok;
      this.consecutiveFailures = 0;
      this.lastHealthCheck = now;
      return this.listenAIHealthy;
    } catch (error) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.maxFailures) {
        this.listenAIHealthy = false;
      }
      this.lastHealthCheck = now;
      logger.warn('ListenAI TTS health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Split text into chunks that fit within TTS limits
   */
  splitTextIntoChunks(text, maxSize = this.MAX_CHUNK_SIZE) {
    const chunks = [];
    let currentChunk = '';

    // Split by sentences to avoid cutting mid-sentence
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
   * Synthesize speech using ListenAI (Kokoro model)
   */
  async synthesizeWithListenAI(text, voice = 'rachel', speed = 1.0) {
    const kokoroVoice = VOICE_MAPPING[voice.toLowerCase()] || VOICE_MAPPING['rachel'];

    const response = await fetch(`${LISTENAI_TTS_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: kokoroVoice,
        model: 'kokoro',
        speed,
        output_format: 'mp3',
      }),
      timeout: 60000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenAI TTS error: ${error}`);
    }

    this.consecutiveFailures = 0;
    return await response.buffer();
  }

  /**
   * Synthesize speech with voice cloning using ListenAI (Chatterbox model)
   */
  async synthesizeClonedWithListenAI(text, voiceUrl, speed = 1.0, exaggeration = 0.5) {
    logger.info('Synthesizing with cloned voice', {
      voiceUrl: voiceUrl.substring(0, 50) + '...',
      textLen: text.length,
      speed,
      exaggeration,
    });

    const response = await fetch(`${LISTENAI_TTS_URL}/synthesize-cloned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice_url: voiceUrl,
        model: 'chatterbox',
        speed,
        exaggeration,
        output_format: 'mp3',
      }),
      timeout: 120000, // 2 minute timeout for cloning
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenAI cloned TTS error: ${error}`);
    }

    this.consecutiveFailures = 0;
    return await response.buffer();
  }

  /**
   * Synthesize speech using OpenAI TTS (fallback)
   */
  async synthesizeWithOpenAI(text, voice = 'nova', speed = 1.0) {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const openaiVoice = OPENAI_VOICES[voice.toLowerCase()] || 'nova';

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: openaiVoice,
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: 'mp3',
      }),
      timeout: 60000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${error}`);
    }

    return await response.buffer();
  }

  /**
   * Main synthesis method - tries ListenAI first, falls back to OpenAI
   */
  async synthesize(text, options = {}) {
    const {
      voice = 'rachel',
      speed = 1.0,
      clonedVoiceUrl = null,
      clonedVoiceId = null,
      exaggeration = 0.5,
      forceProvider = null,
    } = options;

    // Get cloned voice URL if ID provided
    let voiceUrl = clonedVoiceUrl;
    if (clonedVoiceId && !voiceUrl) {
      const { data: voiceData } = await supabaseAdmin
        .from('cloned_voices')
        .select('audio_url')
        .eq('id', clonedVoiceId)
        .single();

      if (voiceData) {
        voiceUrl = voiceData.audio_url;
      }
    }

    // Clean and validate text
    const cleanText = this.cleanTextForTTS(text);
    if (!cleanText || cleanText.length === 0) {
      throw new Error('Text is required');
    }

    logger.info('TTS synthesis request', {
      textLen: cleanText.length,
      voice,
      hasClonedVoice: !!voiceUrl,
      forceProvider,
    });

    // Voice cloning - only available with ListenAI
    if (voiceUrl) {
      if (cleanText.length > 500) {
        // Chunk for cloned voice (Chatterbox has 500 char limit)
        return await this.synthesizeClonedChunked(cleanText, voiceUrl, speed, exaggeration);
      }
      return await this.synthesizeClonedWithListenAI(cleanText, voiceUrl, speed, exaggeration);
    }

    // Force specific provider
    if (forceProvider === 'openai') {
      if (cleanText.length > this.MAX_CHUNK_SIZE) {
        return await this.generateAudioFromChunks(cleanText, voice);
      }
      return await this.synthesizeWithOpenAI(cleanText, voice, speed);
    }

    if (forceProvider === 'listenai') {
      if (cleanText.length > this.MAX_CHUNK_SIZE) {
        return await this.synthesizeWithListenAIChunked(cleanText, voice, speed);
      }
      return await this.synthesizeWithListenAI(cleanText, voice, speed);
    }

    // Auto mode: Try ListenAI first, fallback to OpenAI
    const isListenAIHealthy = await this.checkListenAIHealth();

    if (isListenAIHealthy) {
      try {
        if (cleanText.length > this.MAX_CHUNK_SIZE) {
          return await this.synthesizeWithListenAIChunked(cleanText, voice, speed);
        }
        return await this.synthesizeWithListenAI(cleanText, voice, speed);
      } catch (error) {
        logger.warn('ListenAI failed, falling back to OpenAI', { error: error.message });
        this.consecutiveFailures++;

        if (this.openaiApiKey) {
          if (cleanText.length > this.MAX_CHUNK_SIZE) {
            return await this.generateAudioFromChunks(cleanText, voice);
          }
          return await this.synthesizeWithOpenAI(cleanText, voice, speed);
        }
        throw error;
      }
    } else {
      if (this.openaiApiKey) {
        logger.info('ListenAI unhealthy, using OpenAI directly');
        if (cleanText.length > this.MAX_CHUNK_SIZE) {
          return await this.generateAudioFromChunks(cleanText, voice);
        }
        return await this.synthesizeWithOpenAI(cleanText, voice, speed);
      }
      throw new Error('TTS service unavailable');
    }
  }

  /**
   * Synthesize long text with ListenAI in chunks
   */
  async synthesizeWithListenAIChunked(text, voice, speed) {
    const chunks = this.splitTextIntoChunks(text);
    logger.info(`ListenAI: Processing ${chunks.length} chunks`);

    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await this.synthesizeWithListenAI(chunks[i], voice, speed);
      audioBuffers.push(buffer);
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return Buffer.concat(audioBuffers);
  }

  /**
   * Synthesize long text with cloned voice in chunks
   */
  async synthesizeClonedChunked(text, voiceUrl, speed, exaggeration) {
    const chunks = this.splitTextIntoChunks(text, 500); // Chatterbox 500 char limit
    logger.info(`Cloned voice: Processing ${chunks.length} chunks`);

    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await this.synthesizeClonedWithListenAI(chunks[i], voiceUrl, speed, exaggeration);
      audioBuffers.push(buffer);
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Longer delay for GPU
      }
    }

    return Buffer.concat(audioBuffers);
  }

  /**
   * Generate audio from text using OpenAI TTS (legacy method for compatibility)
   */
  async generateAudio(text, voice = 'alloy') {
    return await this.synthesize(text, { voice, forceProvider: 'openai' });
  }

  /**
   * Generate audio from multiple chunks with OpenAI
   */
  async generateAudioFromChunks(text, voice) {
    const chunks = this.splitTextIntoChunks(text);
    logger.info(`OpenAI: Processing ${chunks.length} chunks`);

    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await this.synthesizeWithOpenAI(chunks[i], voice);
      audioBuffers.push(buffer);
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return Buffer.concat(audioBuffers);
  }

  /**
   * Upload audio to Supabase storage
   */
  async uploadAudio(audioBuffer, userId, noteId) {
    const timestamp = Date.now();
    const storagePath = `podcasts/${userId}/${noteId}_${timestamp}.mp3`;

    logger.info('Uploading audio to Supabase', {
      storagePath,
      sizeKB: (audioBuffer.length / 1024).toFixed(2),
    });

    const { error } = await supabaseAdmin.storage
      .from('audio')
      .upload(storagePath, audioBuffer, {
        contentType: 'audio/mpeg',
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
    const voices = [
      { id: 'rachel', name: 'Rachel', gender: 'female', provider: 'listenai' },
      { id: 'bella', name: 'Bella', gender: 'female', provider: 'listenai' },
      { id: 'charlotte', name: 'Charlotte', gender: 'female', provider: 'listenai' },
      { id: 'sarah', name: 'Sarah', gender: 'female', provider: 'listenai' },
      { id: 'sky', name: 'Sky', gender: 'female', provider: 'listenai' },
      { id: 'adam', name: 'Adam', gender: 'male', provider: 'listenai' },
      { id: 'josh', name: 'Josh', gender: 'male', provider: 'listenai' },
      { id: 'brian', name: 'Brian', gender: 'male', provider: 'listenai' },
      { id: 'daniel', name: 'Daniel', gender: 'male', provider: 'listenai' },
      { id: 'liam', name: 'Liam', gender: 'male', provider: 'listenai' },
    ];
    return voices;
  }

  /**
   * Create a cloned voice from audio sample
   */
  async createClonedVoice(userId, name, audioBuffer, duration) {
    const fileName = `cloned-voices/${userId}/${Date.now()}-${name.toLowerCase().replace(/\s+/g, '-')}.wav`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/wav',
        cacheControl: '31536000',
      });

    if (uploadError) {
      throw new Error(`Failed to upload voice sample: ${uploadError.message}`);
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(fileName);

    const { data: voice, error: dbError } = await supabaseAdmin
      .from('cloned_voices')
      .insert({
        user_id: userId,
        name,
        audio_url: urlData.publicUrl,
        duration_seconds: duration,
        status: 'ready',
      })
      .select()
      .single();

    if (dbError) {
      throw new Error(`Failed to save voice: ${dbError.message}`);
    }

    return voice;
  }

  /**
   * Get user's cloned voices
   */
  async getUserClonedVoices(userId) {
    const { data: voices, error } = await supabaseAdmin
      .from('cloned_voices')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'ready')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch voices: ${error.message}`);
    }

    return voices || [];
  }

  /**
   * Delete a cloned voice
   */
  async deleteClonedVoice(userId, voiceId) {
    const { data: voice, error: fetchError } = await supabaseAdmin
      .from('cloned_voices')
      .select('*')
      .eq('id', voiceId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !voice) {
      throw new Error('Voice not found');
    }

    const fileName = voice.audio_url.split('/audio/')[1];
    if (fileName) {
      await supabaseAdmin.storage.from('audio').remove([fileName]);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('cloned_voices')
      .delete()
      .eq('id', voiceId);

    if (deleteError) {
      throw new Error(`Failed to delete voice: ${deleteError.message}`);
    }

    return true;
  }

  /**
   * Get TTS service status
   */
  async getStatus() {
    const isHealthy = await this.checkListenAIHealth();

    return {
      listenai: {
        healthy: isHealthy,
        url: LISTENAI_TTS_URL,
        consecutiveFailures: this.consecutiveFailures,
      },
      openai: {
        configured: !!this.openaiApiKey,
      },
      voiceCount: this.getVoices().length,
    };
  }
}

module.exports = new TTSService();
