/**
 * Text-to-Speech Service
 * Uses OpenAI TTS for all speech synthesis
 */

const fetch = require('node-fetch');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// OpenAI voices available
const OPENAI_VOICES = {
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
   * Synthesize speech using OpenAI TTS
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
   * Main synthesis method
   */
  async synthesize(text, options = {}) {
    const { voice = 'nova', speed = 1.0 } = options;

    // Clean and validate text
    const cleanText = this.cleanTextForTTS(text);
    if (!cleanText || cleanText.length === 0) {
      throw new Error('Text is required');
    }

    logger.info('TTS synthesis request', {
      textLen: cleanText.length,
      voice,
    });

    if (cleanText.length > this.MAX_CHUNK_SIZE) {
      return await this.generateAudioFromChunks(cleanText, voice, speed);
    }
    return await this.synthesizeWithOpenAI(cleanText, voice, speed);
  }

  /**
   * Generate audio from text (legacy method for compatibility)
   */
  async generateAudio(text, voice = 'alloy') {
    return await this.synthesize(text, { voice });
  }

  /**
   * Generate audio from multiple chunks
   */
  async generateAudioFromChunks(text, voice, speed = 1.0) {
    const chunks = this.splitTextIntoChunks(text);
    logger.info(`OpenAI TTS: Processing ${chunks.length} chunks`);

    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      const buffer = await this.synthesizeWithOpenAI(chunks[i], voice, speed);
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
    return [
      { id: 'alloy', name: 'Alloy', gender: 'neutral', description: 'Balanced and versatile' },
      { id: 'echo', name: 'Echo', gender: 'male', description: 'Warm and engaging' },
      { id: 'fable', name: 'Fable', gender: 'male', description: 'Expressive storyteller' },
      { id: 'onyx', name: 'Onyx', gender: 'male', description: 'Deep and authoritative' },
      { id: 'nova', name: 'Nova', gender: 'female', description: 'Friendly and upbeat' },
      { id: 'shimmer', name: 'Shimmer', gender: 'female', description: 'Clear and professional' },
    ];
  }

  /**
   * Get TTS service status
   */
  async getStatus() {
    return {
      openai: {
        configured: !!this.openaiApiKey,
      },
      voiceCount: this.getVoices().length,
    };
  }

  /**
   * Generate TTS for a note and save to storage
   */
  async generateForNote(userId, noteId, options = {}) {
    const { voice = 'nova', speed = 1.0 } = options;

    // Fetch the note content
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

    // Generate the audio
    const audioBuffer = await this.synthesize(textToSpeak, { voice, speed });

    // Upload to Supabase storage
    const fileName = `tts/${userId}/${noteId}-${Date.now()}.mp3`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('audio')
      .getPublicUrl(fileName);

    const audioUrl = urlData.publicUrl;

    // Estimate duration (rough: ~150 words per minute, ~5 chars per word)
    const estimatedDuration = Math.ceil((textToSpeak.length / 5) / 150 * 60);

    // Save to ai_content table
    const { error: dbError } = await supabaseAdmin
      .from('ai_content')
      .upsert({
        note_id: noteId,
        user_id: userId,
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
      logger.warn('Failed to save TTS to ai_content', { error: dbError.message });
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
    const { data, error } = await supabaseAdmin
      .from('ai_content')
      .select('content, created_at')
      .eq('note_id', noteId)
      .eq('user_id', userId)
      .eq('content_type', 'tts')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

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
