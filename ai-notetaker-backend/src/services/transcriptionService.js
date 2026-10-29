const { supabase, supabaseAdmin } = require('../config/supabase');
const { MODELS } = require('../config/openai');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');
const path = require('path');
const { transcribeAudio, TranscriptionError } = require('./deepgramClient');
const { reportFailure } = require('../utils/failureReporter');

const REPORTABLE_CODES = new Set(['NO_SPEECH', 'PROVIDER_ERROR', 'PROVIDER_TIMEOUT', 'DOWNLOAD_FAILED', 'EMPTY_FILE']);

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
   * Human-readable audio length for error_message ("12s", "0.4s", "3m05s").
   */
  formatDuration(seconds) {
    if (seconds == null) return 'unknown length';
    if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`;
    const whole = Math.round(seconds);
    if (whole < 120) return `${whole}s`;
    return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
  }

  /**
   * Write the failure onto the recording row. A failed row must always end status 'failed' with an
   * error_message, so a rejected update (supabase-js returns { error } rather than throwing) is
   * retried once and then logged loudly.
   */
  async markFailed(recordingId, errorMessage, durationSec) {
    const patch = { status: 'failed', error_message: errorMessage };
    if (durationSec != null) patch.duration = Math.round(durationSec);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { error } = await supabaseAdmin.from('recordings').update(patch).eq('id', recordingId);
        if (!error) return true;
        logger.error('Failed to mark recording failed', { recordingId, attempt, error: error.message });
      } catch (updateErr) {
        logger.error('Failed to mark recording failed', { recordingId, attempt, error: updateErr.message });
      }
    }
    return false;
  }

  /**
   * Tell the owner a recording ended 'failed'. Fire-and-forget (reportFailure never throws or
   * blocks; a sync throw is swallowed anyway). The message is fixed per code so the reporter
   * dedupes by code, and the context carries only non-content facts as strings: no transcript,
   * note text, email or user id.
   */
  reportRecordingFailed(code, outcome) {
    const reported = REPORTABLE_CODES.has(code) ? code : 'UNKNOWN';
    const str = (v) => (v == null ? 'unknown' : String(v));
    try {
      reportFailure('recording_failed', new Error(`Recording ${reported}`), {
        code: reported,
        source: 'upload',
        audio_seconds: str(outcome.durationSec == null ? null : Math.round(outcome.durationSec)),
        file_kb: str(outcome.fileSize == null ? null : Math.round(outcome.fileSize / 1024)),
        detected_language: str(outcome.detectedLanguage),
        provider_status: str(outcome.providerStatus),
      });
    } catch (e) {
      logger.warn('Failure report threw', { error: e.message });
    }
  }

  /**
   * Structured, transcript-free outcome line. One per transcription attempt (success or failure).
   */
  logOutcome(fields) {
    logger.info('transcription_outcome', fields);
  }

  /**
   * Transcribe an audio recording with Deepgram (language auto-detected).
   *
   * Failure contract: every failure after the recording is loaded leaves the row at
   * status 'failed' with error_message "<CODE>: <facts>" (codes: DOWNLOAD_FAILED, EMPTY_FILE,
   * PROVIDER_ERROR, PROVIDER_TIMEOUT, NO_SPEECH, INTERNAL_ERROR). HTTP status and the
   * user-facing messages are unchanged from before (422 'No speech detected in the recording',
   * 500 otherwise).
   */
  async transcribeRecording(userId, recordingId) {
    const outcome = { recordingId, fileSize: null, durationSec: null, detectedLanguage: null, languageConfidence: null, providerStatus: null, attempts: 0 };
    let durationSec = null;
    let loaded = false;

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
      loaded = true;
      outcome.fileSize = recording.file_size ?? null;

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
      let audioBuffer;
      try {
        audioBuffer = await storageService.downloadFile(recording.storage_path);
      } catch (dlErr) {
        throw new TranscriptionError('DOWNLOAD_FAILED', dlErr.message || 'Failed to download file', dlErr.statusCode || 500, {
          dbMessage: `DOWNLOAD_FAILED: ${dlErr.message || 'storage download failed'}, expected file ${this.formatSize(recording.file_size)}`
        });
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        throw new TranscriptionError('EMPTY_FILE', 'Failed to download audio file - empty buffer', 500, {
          dbMessage: `EMPTY_FILE: stored audio is 0 bytes, expected file ${this.formatSize(recording.file_size)}`
        });
      }
      outcome.fileSize = audioBuffer.length;

      // Get the correct file extension and MIME type
      const extension = this.getFileExtension(recording);
      const mimeType = this.getMimeType(extension);

      logger.info('Calling Deepgram API', { recordingId, fileSize: audioBuffer.length, extension, mimeType });

      // The downloaded buffer is sent as is: no temp file and no second read into memory.
      let dg;
      try {
        dg = await transcribeAudio({ body: audioBuffer, mimeType });
      } catch (dgErr) {
        outcome.providerStatus = dgErr.providerStatus ?? null;
        outcome.attempts = dgErr.attempts || 0;
        throw dgErr;
      }
      outcome.providerStatus = dg.providerStatus;
      outcome.attempts = dg.attempts;
      outcome.durationSec = dg.durationSec;
      outcome.detectedLanguage = dg.detectedLanguage;
      outcome.languageConfidence = dg.languageConfidence;
      durationSec = dg.durationSec;

      const transcriptionText = dg.text;
      const duration = Math.round(dg.durationSec || 0);

      if (!transcriptionText || transcriptionText.trim().length === 0) {
        // No recognisable speech: silence/noise, or a language Deepgram could not transcribe. A
        // property of the recording, not a server failure, so it stays a 422 (must not page as
        // 5xx). The stored reason carries the facts that tell those cases apart.
        const lang = dg.detectedLanguage
          ? `${dg.detectedLanguage}${dg.languageConfidence != null ? ` (confidence ${dg.languageConfidence})` : ''}`
          : 'unknown';
        throw new TranscriptionError('NO_SPEECH', 'No speech detected in the recording', 422, {
          dbMessage: `NO_SPEECH: audio ${this.formatDuration(dg.durationSec)}, detected language ${lang}, file ${this.formatSize(audioBuffer.length)}`,
          providerStatus: dg.providerStatus
        });
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
      const completedPatch = {
        transcription: transcriptionText,
        duration: duration,
        status: 'completed',
        note_id: note.id // Link to the created note
      };
      let updateError;
      for (let attempt = 1; attempt <= 2; attempt++) {
        ({ error: updateError } = await supabaseAdmin
          .from('recordings')
          .update(completedPatch)
          .eq('id', recordingId)
          .select()
          .single());
        if (!updateError) break;
        logger.error('Failed to update recording', { error: updateError, recordingId, attempt });
      }
      // Don't throw here - the note exists and transcription succeeded, so the client gets success.

      this.logOutcome({ ...outcome, outcome: 'completed', textLength: transcriptionText.length, recordUpdated: !updateError });

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
      const code = error.code && typeof error.dbMessage === 'string' ? error.code : (error.statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
      logger.error('Transcription error', { 
        error: error.message, 
        stack: error.stack,
        userId, 
        recordingId,
        code
      });
      if (loaded) {
        this.logOutcome({ ...outcome, outcome: 'failed', errorCode: code, httpStatus: error.statusCode || 500 });
        const dbMessage = typeof error.dbMessage === 'string'
          ? error.dbMessage
          : `INTERNAL_ERROR: ${String(error.message || 'unknown error').slice(0, 300)}`;
        await this.markFailed(recordingId, dbMessage, durationSec);
        this.reportRecordingFailed(code, outcome);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(`Failed to transcribe recording: ${error.message}`, 500);
    }
  }

  formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return 'unknown size';
    return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
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