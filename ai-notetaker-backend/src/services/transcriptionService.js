const { supabase, supabaseAdmin } = require('../config/supabase');
const { openai, MODELS } = require('../config/openai');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class TranscriptionService {
  /**
   * Transcribe an audio recording using OpenAI Whisper
   */
  async transcribeRecording(userId, recordingId) {
    try {
      // Get recording details - USE supabaseAdmin
      const { data: recording, error: fetchError } = await supabaseAdmin
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !recording) {
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

      logger.info('Starting transcription', { userId, recordingId });

      // Update status to processing - USE supabaseAdmin
      await supabaseAdmin
        .from('recordings')
        .update({ status: 'processing' })
        .eq('id', recordingId);

      // Download audio file from Supabase Storage
      const audioBuffer = await storageService.downloadFile(recording.storage_path);

      // Save to temporary file (Whisper API requires file)
      const tempFilePath = path.join(os.tmpdir(), `audio_${recordingId}.webm`);
      await fs.writeFile(tempFilePath, audioBuffer);

      try {
        logger.info('Calling Whisper API', { recordingId, fileSize: audioBuffer.length });

        // Transcribe with OpenAI Whisper
        const transcription = await openai.audio.transcriptions.create({
          file: await fs.readFile(tempFilePath).then(buffer => 
            new File([buffer], path.basename(tempFilePath), { 
              type: 'audio/webm' 
            })
          ),
          model: MODELS.WHISPER,
          language: 'en', // Can be made dynamic based on user preference
          response_format: 'verbose_json'
        });

        // Clean up temp file
        await fs.unlink(tempFilePath).catch(() => {});

        const transcriptionText = transcription.text;
        const duration = Math.round(transcription.duration || 0);

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
          throw updateError;
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

      } catch (transcribeError) {
        // Clean up temp file on error
        await fs.unlink(tempFilePath).catch(() => {});
        
        logger.error('Whisper API error', { 
          error: transcribeError.message,
          recordingId 
        });
        
        throw transcribeError;
      }

    } catch (error) {
      logger.error('Transcription error', { 
        error: error.message, 
        stack: error.stack,
        userId, 
        recordingId 
      });

      // Update recording status to failed - USE supabaseAdmin
      await supabaseAdmin
        .from('recordings')
        .update({
          status: 'failed',
          error_message: error.message
        })
        .eq('id', recordingId)
        .catch(updateErr => {
          logger.error('Failed to update error status', { 
            error: updateErr.message, 
            recordingId 
          });
        });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('Failed to transcribe recording', 500);
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
