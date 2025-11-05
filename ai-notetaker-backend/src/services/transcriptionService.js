const { supabase } = require('../config/supabase');
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
      // Get recording details
      const { data: recording, error: fetchError } = await supabase
        .from('recordings')
        .select('*')
        .eq('id', recordingId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !recording) {
        throw new AppError('Recording not found', 404);
      }

      if (recording.status === 'completed') {
        return {
          recording_id: recordingId,
          transcription: recording.transcription,
          status: 'completed'
        };
      }

      // Update status to processing
      await supabase
        .from('recordings')
        .update({ status: 'processing' })
        .eq('id', recordingId);

      // Download audio file from Supabase Storage
      const audioBuffer = await storageService.downloadFile(recording.storage_path);

      // Save to temporary file (Whisper API requires file)
      const tempFilePath = path.join(os.tmpdir(), `audio_${recordingId}.webm`);
      await fs.writeFile(tempFilePath, audioBuffer);

      try {
        // Transcribe with OpenAI Whisper
        const transcription = await openai.audio.transcriptions.create({
          file: await fs.readFile(tempFilePath).then(buffer => 
            new File([buffer], path.basename(tempFilePath), { 
              type: 'audio/webm' 
            })
          ),
          model: MODELS.WHISPER,
          language: 'en', // Can be made dynamic
          response_format: 'verbose_json'
        });

        // Clean up temp file
        await fs.unlink(tempFilePath).catch(() => {});

        const transcriptionText = transcription.text;
        const duration = Math.round(transcription.duration || 0);

        // Update recording with transcription
        const { data: updatedRecording, error: updateError } = await supabase
          .from('recordings')
          .update({
            transcription: transcriptionText,
            duration: duration,
            status: 'completed'
          })
          .eq('id', recordingId)
          .select()
          .single();

        if (updateError) throw updateError;

        // Create or update associated note if note_id exists
        if (recording.note_id) {
          await noteService.updateNote(userId, recording.note_id, {
            content: transcriptionText
          });
        } else {
          // Create a new note from transcription
          const note = await noteService.createNote(userId, {
            title: `Recording from ${new Date().toLocaleDateString()}`,
            content: transcriptionText,
            source_type: 'recording',
            metadata: { recording_id: recordingId }
          });

          // Link recording to note
          await supabase
            .from('recordings')
            .update({ note_id: note.id })
            .eq('id', recordingId);
        }

        logger.info('Transcription completed', { userId, recordingId });

        return {
          recording_id: recordingId,
          transcription: transcriptionText,
          duration: duration,
          status: 'completed'
        };

      } catch (transcribeError) {
        // Clean up temp file on error
        await fs.unlink(tempFilePath).catch(() => {});
        throw transcribeError;
      }

    } catch (error) {
      logger.error('Transcription error', { error: error.message, userId, recordingId });

      // Update recording status to failed
      await supabase
        .from('recordings')
        .update({
          status: 'failed',
          error_message: error.message
        })
        .eq('id', recordingId);

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
