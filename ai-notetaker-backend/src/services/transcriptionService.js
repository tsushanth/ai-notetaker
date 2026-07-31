const { supabase, supabaseAdmin } = require('../config/supabase');
const { MODELS } = require('../config/openai');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// MIME type mapping for different audio formats
const MIME_TYPES = {
  'm4a': 'audio/mp4',
  'mp4': 'audio/mp4',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'wave': 'audio/wav',
  'webm': 'audio/webm',
  'ogg': 'audio/ogg',
  'aac': 'audio/aac',
  'flac': 'audio/flac'
};

class TranscriptionService {
  /**
   * Get the file extension from format or storage path
   */
  getFileExtension(recording) {
    // Try to get from format field
    if (recording.format) {
      return recording.format.toLowerCase().replace('.', '');
    }
    
    // Try to extract from storage path
    if (recording.storage_path) {
      const ext = path.extname(recording.storage_path).toLowerCase().replace('.', '');
      if (ext) return ext;
    }
    
    // Default to m4a (common mobile format)
    return 'm4a';
  }

  /**
   * Get MIME type for audio format
   */
  getMimeType(extension) {
    return MIME_TYPES[extension] || 'audio/mp4';
  }

  /**
   * Transcribe an audio recording using OpenAI Whisper
   */
  async transcribeRecording(userId, recordingId) {
    let tempFilePath = null;
    
    try {
      // Get recording details - USE supabaseAdmin
      const { data: recording, error: fetchError } = await supabaseAdmin
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !recording) {
        logger.error('Recording not found', { recordingId, userId, error: fetchError?.message });
        throw new AppError('Recording not found', 404);
      }

      if (recording.status === 'completed') {
        // Already transcribed, return existing data
        logger.info('Recording already transcribed', { recordingId });
        return {
          recording_id: recordingId,
          transcription: recording.transcription,
          duration: recording.duration,
          status: 'completed',
          note_id: recording.note_id
        };
      }

      logger.info('Starting transcription', { 
        userId, 
        recordingId,
        format: recording.format,
        storagePath: recording.storage_path,
        fileSize: recording.file_size
      });

      // Update status to processing - USE supabaseAdmin
      const { error: updateProcessingError } = await supabaseAdmin
        .from('recordings')
        .update({ status: 'processing' })
        .eq('id', recordingId);

      if (updateProcessingError) {
        logger.warn('Failed to update status to processing', { error: updateProcessingError.message });
      }

      // Download audio file from Supabase Storage
      const audioBuffer = await storageService.downloadFile(recording.storage_path);

      if (!audioBuffer || audioBuffer.length === 0) {
        throw new AppError('Failed to download audio file - empty buffer', 500);
      }

      // Get the correct file extension and MIME type
      const extension = this.getFileExtension(recording);
      const mimeType = this.getMimeType(extension);

      // Save to temporary file (Whisper API requires file)
      tempFilePath = path.join(os.tmpdir(), `audio_${recordingId}.${extension}`);
      await fs.writeFile(tempFilePath, audioBuffer);

      logger.info('Calling Whisper API', { 
        recordingId, 
        fileSize: audioBuffer.length,
        extension,
        mimeType,
        tempFilePath
      });

      // Transcribe with Deepgram
      const fileBuffer = await fs.readFile(tempFilePath);

      const dgResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': mimeType,
        },
        body: fileBuffer,
      });

      if (!dgResponse.ok) {
        const errText = await dgResponse.text();
        throw new Error(`Deepgram API error (${dgResponse.status}): ${errText}`);
      }

      const dgResult = await dgResponse.json();
      const transcription = {
        text: dgResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
        duration: dgResult.metadata?.duration || 0,
      };

      // Clean up temp file
      await this.cleanupTempFile(tempFilePath);
      tempFilePath = null;

      const transcriptionText = transcription.text;
      const duration = Math.round(transcription.duration || 0);

      if (!transcriptionText || transcriptionText.trim().length === 0) {
        throw new AppError('Transcription returned empty text', 500);
      }

      logger.info('Transcription successful', { 
        recordingId, 
        textLength: transcriptionText.length,
        duration 
      });

      // Create a new note from transcription
      const note = await noteService.createNote(userId, {
        title: recording.title || `Recording from ${new Date().toLocaleDateString()}`,
        content: transcriptionText,
        source_type: 'recording',
        source_url: recording.file_url,
        metadata: { 
          recording_id: recordingId,
          duration: duration,
          format: recording.format
        }
      });

      logger.info('Note created from transcription', { noteId: note.id, recordingId });

      // Update recording with transcription and link to note - USE supabaseAdmin
      const { data: updatedRecording, error: updateError } = await supabaseAdmin
        .from('recordings')
        .update({
          transcription: transcriptionText,
          duration: duration,
          status: 'completed',
          note_id: note.id // Link to the created note
        })
        .eq('id', recordingId)
        .select()
        .single();

      if (updateError) {
        logger.error('Failed to update recording', { error: updateError, recordingId });
        // Don't throw here - transcription succeeded, just log the error
      }

      logger.info('Transcription completed successfully', { 
        userId, 
        recordingId, 
        noteId: note.id 
      });

      return {
        recording_id: recordingId,
        transcription: transcriptionText,
        duration: duration,
        status: 'completed',
        note_id: note.id // Return note ID so app can fetch it
      };

    } catch (error) {
      // Clean up temp file on error
      if (tempFilePath) {
        await this.cleanupTempFile(tempFilePath);
      }

      logger.error('Transcription error', { 
        error: error.message, 
        stack: error.stack,
        userId, 
        recordingId 
      });

      // Update recording status to failed - FIXED: Use try-catch instead of .catch()
      try {
        await supabaseAdmin
          .from('recordings')
          .update({
            status: 'failed',
            error_message: error.message
          })
          .eq('id', recordingId);
      } catch (updateErr) {
        logger.error('Failed to update error status', { 
          error: updateErr.message, 
          recordingId 
        });
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(`Failed to transcribe recording: ${error.message}`, 500);
    }
  }

  /**
   * Helper to clean up temporary files
   */
  async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      logger.warn('Failed to clean up temp file', { filePath, error: err.message });
    }
  }

  /**
   * Get recording by ID
   */
  async getRecording(userId, recordingId) {
    try {
      const { data, error } = await supabase
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching recording', { error: error.message, userId, recordingId });
      throw new AppError('Failed to fetch recording', 500);
    }
  }

  /**
   * Get all recordings for a user
   */
  async getRecordings(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    try {
      const { data, error, count } = await supabase
        .from('recordings')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        recordings: data,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching recordings', { error: error.message, userId });
      throw new AppError('Failed to fetch recordings', 500);
    }
  }

  /**
   * Delete a recording
   */
  async deleteRecording(userId, recordingId) {
    try {
      // Get recording to delete file
      const recording = await this.getRecording(userId, recordingId);
      if (!recording) return false;

      // Delete file from storage
      await storageService.deleteFile(recording.storage_path);

      // Delete database record
      const { error } = await supabase
        .from('recordings')
        .delete()
        .eq('id', recordingId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info('Recording deleted', { userId, recordingId });
      return true;
    } catch (error) {
      logger.error('Error deleting recording', { error: error.message, userId, recordingId });
      throw new AppError('Failed to delete recording', 500);
    }
  }
}

module.exports = new TranscriptionService();