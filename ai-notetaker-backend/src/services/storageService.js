const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

class StorageService {
  constructor() {
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'notetaker-files';
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  }

  /**
   * Get Supabase client with user's JWT token for RLS
   * This is CRITICAL - without user token, RLS blocks operations
   */
  getUserClient(userToken) {
    if (!userToken) {
      throw new AppError('User authentication token required', 401);
    }

    // Remove "Bearer " prefix if present
    const token = userToken.replace('Bearer ', '').trim();

    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
  }

  /**
   * Upload a file (PDF, slideshow, etc.)
   * @param {string} userId - User ID
   * @param {Object} file - File object with buffer and metadata
   * @param {string} folder - Subfolder within user directory
   * @param {string} userToken - User's JWT token (REQUIRED)
   */
  async uploadFile(userId, file, folder = 'documents', userToken) {
    try {
      if (!userToken) {
        throw new AppError('User token required for upload', 401);
      }

      const supabase = this.getUserClient(userToken);
      const fileExtension = this.getFileExtension(file.originalname || file.mimetype);
      const fileName = `${userId}/${folder}/${uuidv4()}.${fileExtension}`;

      logger.info('Uploading file to storage', {
        userId,
        fileName,
        size: file.buffer?.length || file.size,
        contentType: file.mimetype
      });

      const { data, error } = await supabase
        .storage
        .from(this.bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (error) {
        logger.error('Storage upload error', {
          error: error.message,
          errorCode: error.statusCode,
          userId,
          fileName
        });
        throw error;
      }

      logger.info('File uploaded successfully', { userId, fileName });

      return {
        path: fileName,
        url: this.getPublicUrl(fileName, userToken)
      };
    } catch (error) {
      logger.error('Error uploading file', { error: error.message, userId });
      throw new AppError('Failed to upload file', 500);
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
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'text/plain': 'txt'
    };

    // If it's a mimetype
    if (mimeToExt[filenameOrMime]) {
      return mimeToExt[filenameOrMime];
    }

    // If it's a filename, extract extension
    const parts = filenameOrMime.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'bin';
  }

  /**
   * Get public URL for a file
   */
  getPublicUrl(filePath, userToken = null) {
    const supabase = userToken 
      ? this.getUserClient(userToken)
      : createClient(this.supabaseUrl, this.supabaseAnonKey);

    const { data } = supabase
      .storage
      .from(this.bucket)
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
}

module.exports = new StorageService();