const { supabase } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

class StorageService {
  constructor() {
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'notetaker-files';
  }

  /**
   * Upload a recording to Supabase Storage
   */
  async uploadRecording(userId, file, metadata = {}) {
    try {
      const fileExtension = this.getFileExtension(file.originalname || file.mimetype);
      const fileName = `${userId}/${uuidv4()}.${fileExtension}`;

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase
        .storage
        .from(this.bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Create recording record in database
      const { data: recording, error: dbError } = await supabase
        .from('recordings')
        .insert({
          user_id: userId,
          note_id: metadata.note_id || null,
          storage_path: fileName,
          status: 'processing'
        })
        .select()
        .single();

      if (dbError) {
        // Cleanup uploaded file if database insert fails
        await this.deleteFile(fileName);
        throw dbError;
      }

      logger.info('Recording uploaded', { userId, recordingId: recording.id, fileName });

      return recording;
    } catch (error) {
      logger.error('Error uploading recording', { error: error.message, userId });
      throw new AppError('Failed to upload recording', 500);
    }
  }

  /**
   * Upload a file (PDF, slideshow, etc.)
   */
  async uploadFile(userId, file, folder = 'documents') {
    try {
      const fileExtension = this.getFileExtension(file.originalname || file.mimetype);
      const fileName = `${userId}/${folder}/${uuidv4()}.${fileExtension}`;

      const { data, error } = await supabase
        .storage
        .from(this.bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (error) throw error;

      logger.info('File uploaded', { userId, fileName });

      return {
        path: fileName,
        url: this.getPublicUrl(fileName)
      };
    } catch (error) {
      logger.error('Error uploading file', { error: error.message, userId });
      throw new AppError('Failed to upload file', 500);
    }
  }

  /**
   * Download a file from Supabase Storage
   */
  async downloadFile(filePath) {
    try {
      const { data, error } = await supabase
        .storage
        .from(this.bucket)
        .download(filePath);

      if (error) throw error;

      // Convert Blob to Buffer
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error('Error downloading file', { error: error.message, filePath });
      throw new AppError('Failed to download file', 500);
    }
  }

  /**
   * Delete a file from Supabase Storage
   */
  async deleteFile(filePath) {
    try {
      const { error } = await supabase
        .storage
        .from(this.bucket)
        .remove([filePath]);

      if (error) throw error;

      logger.info('File deleted', { filePath });
      return true;
    } catch (error) {
      logger.error('Error deleting file', { error: error.message, filePath });
      // Don't throw error for deletion failures
      return false;
    }
  }

  /**
   * Get public URL for a file (if bucket is public)
   */
  getPublicUrl(filePath) {
    const { data } = supabase
      .storage
      .from(this.bucket)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }

  /**
   * Get signed URL for private file access
   */
  async getSignedUrl(filePath, expiresIn = 3600) {
    try {
      const { data, error } = await supabase
        .storage
        .from(this.bucket)
        .createSignedUrl(filePath, expiresIn);

      if (error) throw error;

      return data.signedUrl;
    } catch (error) {
      logger.error('Error creating signed URL', { error: error.message, filePath });
      throw new AppError('Failed to create signed URL', 500);
    }
  }

  /**
   * Get file extension from filename or mimetype
   */
  getFileExtension(filenameOrMime) {
    const mimeToExt = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/m4a': 'm4a',
      'audio/mp4': 'm4a',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'application/pdf': 'pdf',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
    };

    // If it's a mimetype
    if (mimeToExt[filenameOrMime]) {
      return mimeToExt[filenameOrMime];
    }

    // If it's a filename, extract extension
    const parts = filenameOrMime.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'bin';
  }
}

module.exports = new StorageService();
