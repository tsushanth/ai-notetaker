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

// Voice pairs for multi-host podcasts by gender
const VOICE_PAIRS = {
  female: ['nova', 'shimmer'],      // Sarah, Emily
  male: ['echo', 'onyx'],           // James, Marcus
  mixed: ['nova', 'echo'],          // Sarah, James (default)
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
   * Parse podcast script into segments by speaker
   * Returns array of { speaker: 'Host 1' | 'Host 2' | 'narrator', text: string }
   */
  parsePodcastScript(script) {
    const segments = [];
    const lines = script.split('\n');
    let currentSpeaker = 'narrator';
    let currentText = '';

    // Log first 800 chars of script for debugging
    logger.info('Parsing podcast script', {
      scriptPreview: script.substring(0, 800),
      totalLength: script.length,
      lineCount: lines.length
    });

    let host1Count = 0;
    let host2Count = 0;

    for (const line of lines) {
      // Strip markdown bold markers before parsing
      let trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Remove all markdown bold markers (**) for cleaner parsing
      const cleanLine = trimmedLine.replace(/\*\*/g, '');

      // Match patterns like "Host 1:", "Host 2:", "[Host 1]:", etc.
      // Also handle Speaker 1, Speaker 2, Person 1, Person 2, etc.
      // More flexible regex that handles various formats
      const hostMatch = cleanLine.match(/^(?:\[)?(?:Host|Speaker|Person|Voice)\s*(\d+)(?:\])?[:\-]\s*(.*)/i);

      if (hostMatch) {
        // Save previous segment if any
        if (currentText.trim()) {
          segments.push({ speaker: currentSpeaker, text: currentText.trim() });
        }

        currentSpeaker = `Host ${hostMatch[1]}`;
        currentText = hostMatch[2] || '';

        // Track host counts for debugging
        if (hostMatch[1] === '1') host1Count++;
        else if (hostMatch[1] === '2') host2Count++;
      } else {
        // Continue current speaker's text
        currentText += ' ' + trimmedLine;
      }
    }

    // Add final segment
    if (currentText.trim()) {
      segments.push({ speaker: currentSpeaker, text: currentText.trim() });
    }

    // Log parsing results for debugging
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
   * Assigns different voices to Host 1 and Host 2 based on gender preference
   */
  async generatePodcastAudio(script, options = {}) {
    const { gender = 'female', speed = 1.0 } = options;

    // Get voice pair for the selected gender
    const voicePair = VOICE_PAIRS[gender] || VOICE_PAIRS.female;
    const [voice1, voice2] = voicePair;

    logger.info('Generating multi-voice podcast', {
      gender,
      voice1,
      voice2,
      scriptLength: script.length
    });

    // Parse script into segments
    const segments = this.parsePodcastScript(script);

    if (segments.length === 0) {
      // Fallback: generate with single voice if parsing fails
      logger.warn('Failed to parse podcast script, using single voice');
      return await this.generateAudio(script, voice1);
    }

    // Check if we detected BOTH hosts - if not, we'll alternate voices
    const hasHost1 = segments.some(s => s.speaker === 'Host 1');
    const hasHost2 = segments.some(s => s.speaker === 'Host 2');
    const hasBothHosts = hasHost1 && hasHost2;

    logger.info(`Parsed ${segments.length} podcast segments`, {
      hasHost1,
      hasHost2,
      hasBothHosts,
      willAlternate: !hasBothHosts
    });

    // Generate audio for each segment with appropriate voice
    const audioBuffers = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Determine voice based on speaker
      let voice;
      if (hasBothHosts) {
        // We have proper Host 1/Host 2 tags - use them
        voice = segment.speaker === 'Host 2' ? voice2 : voice1;
      } else {
        // Fallback: alternate voices for each segment
        voice = (i % 2 === 0) ? voice1 : voice2;
        logger.info(`Alternating voice for segment ${i}`, { voice, originalSpeaker: segment.speaker });
      }

      // Clean the text for TTS (but don't remove host labels since they're already stripped)
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
        // Handle long segments by chunking
        let buffer;
        if (cleanText.length > this.MAX_CHUNK_SIZE) {
          buffer = await this.generateAudioFromChunks(cleanText, voice, speed);
        } else {
          buffer = await this.synthesizeWithOpenAI(cleanText, voice, speed);
        }

        audioBuffers.push(buffer);

        // Small delay between API calls to avoid rate limiting
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
   * Get available voices (human-friendly names, OpenAI voice IDs)
   */
  getVoices() {
    return [
      { id: 'nova', name: 'Sarah', gender: 'Female', description: 'Friendly and upbeat' },
      { id: 'shimmer', name: 'Emily', gender: 'Female', description: 'Clear and professional' },
      { id: 'alloy', name: 'Alex', gender: 'Neutral', description: 'Balanced and versatile' },
      { id: 'echo', name: 'James', gender: 'Male', description: 'Warm and engaging' },
      { id: 'fable', name: 'Daniel', gender: 'Male', description: 'Expressive storyteller' },
      { id: 'onyx', name: 'Marcus', gender: 'Male', description: 'Deep and authoritative' },
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

    // Save to ai_content table (like podcasts - no user_id, ownership verified via note)
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
      // Don't throw - audio was generated, just save failed
      // The user can still use the audio, they just won't have it saved
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

    // Query by note_id and content_type only (like podcasts)
    // User ownership is verified at the route level
    const { data, error } = await supabaseAdmin
      .from('ai_content')
      .select('content, created_at')
      .eq('note_id', noteId)
      .eq('content_type', 'tts')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // PGRST116 = no rows returned, which is expected when no TTS exists
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
