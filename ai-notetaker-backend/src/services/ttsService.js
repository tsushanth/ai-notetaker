const fetch = require('node-fetch');
const { logger } = require('../utils/logger');

class TTSService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.MAX_CHUNK_SIZE = 4000; // Leave buffer under 4096 limit
  }

  /**
   * Split text into chunks that fit within TTS limits
   */
  splitTextIntoChunks(text) {
    const chunks = [];
    let currentChunk = '';
    
    // Split by sentences to avoid cutting mid-sentence
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    for (const sentence of sentences) {
      // If single sentence is too long, split by words
      if (sentence.length > this.MAX_CHUNK_SIZE) {
        const words = sentence.split(' ');
        for (const word of words) {
          if ((currentChunk + word).length > this.MAX_CHUNK_SIZE) {
            chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          } else {
            currentChunk += word + ' ';
          }
        }
      } else if ((currentChunk + sentence).length > this.MAX_CHUNK_SIZE) {
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
   * Generate audio from text using OpenAI TTS
   */
  async generateAudio(text, voice = 'alloy') {
    try {
      if (!this.openaiApiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }

      // Remove markdown formatting and speaker labels for better TTS
      const cleanText = text
        .replace(/\*\*.*?\*\*/g, '') // Remove **bold**
        .replace(/\[.*?\]/g, '') // Remove [stage directions]
        .replace(/Host \d+:/g, '') // Remove "Host 1:", "Host 2:"
        .replace(/\n\n+/g, ' ') // Replace multiple newlines with space
        .trim();

      logger.info('Generating TTS audio', { 
        originalLength: text.length,
        cleanedLength: cleanText.length,
        voice 
      });

      // Check if we need to split
      if (cleanText.length > this.MAX_CHUNK_SIZE) {
        logger.info('Text exceeds limit, splitting into chunks');
        return await this.generateAudioFromChunks(cleanText, voice);
      }

      // Single chunk processing
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: cleanText,
          voice: voice,
          response_format: 'mp3'
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`TTS API error: ${error}`);
      }

      const audioBuffer = await response.buffer();
      
      logger.info('TTS audio generated successfully', {
        sizeKB: (audioBuffer.length / 1024).toFixed(2)
      });

      return audioBuffer;
    } catch (error) {
      logger.error('Error generating TTS audio', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate audio from multiple chunks and merge them
   */
  async generateAudioFromChunks(text, voice) {
    const chunks = this.splitTextIntoChunks(text);
    logger.info(`Generating audio for ${chunks.length} chunks`);

    const audioBuffers = [];

    for (let i = 0; i < chunks.length; i++) {
      logger.info(`Processing chunk ${i + 1}/${chunks.length}`);
      
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: chunks[i],
          voice: voice,
          response_format: 'mp3'
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`TTS API error on chunk ${i + 1}: ${error}`);
      }

      const buffer = await response.buffer();
      audioBuffers.push(buffer);
      
      // Small delay to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Concatenate all audio buffers
    const mergedBuffer = Buffer.concat(audioBuffers);
    
    logger.info('All chunks processed and merged', {
      totalChunks: chunks.length,
      totalSizeKB: (mergedBuffer.length / 1024).toFixed(2)
    });

    return mergedBuffer;
  }

  /**
   * Upload audio to Supabase storage
   */
  async uploadAudio(audioBuffer, userId, noteId) {
    const { supabaseAdmin } = require('../config/supabase');
    
    try {
      const timestamp = Date.now();
      const storagePath = `podcasts/${userId}/${noteId}_${timestamp}.mp3`;

      logger.info('Uploading audio to Supabase', { 
        storagePath,
        sizeKB: (audioBuffer.length / 1024).toFixed(2)
      });

      const { data, error } = await supabaseAdmin.storage
        .from('audio')
        .upload(storagePath, audioBuffer, {
          contentType: 'audio/mpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw error;
      }

      const { data: urlData } = supabaseAdmin.storage
        .from('audio')
        .getPublicUrl(storagePath);

      logger.info('Audio uploaded successfully', { url: urlData.publicUrl });

      return urlData.publicUrl;
    } catch (error) {
      logger.error('Error uploading audio', { error: error.message });
      throw error;
    }
  }
}

module.exports = new TTSService();