const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

// DON'T create admin client here - do it lazily
let _supabaseAdmin = null;

class StorageService {
  constructor() {
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'notetaker-files';
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  }

  /**
   * Get admin client (lazy initialization)
   */
  getAdminClient() {
    if (!_supabaseAdmin) {
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      
      if (!serviceKey) {
        throw new AppError('SUPABASE_SERVICE_KEY not configured', 500);
      }

      _supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        serviceKey
      );
    }
    
    return _supabaseAdmin;
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
   * Upload audio recording (used by /api/recordings/upload)
   * @param {string} userId - User ID
   * @param {Object} file - Multer file object
   * @param {Object} options - Additional options (note_id, title)
   */
  async uploadRecording(userId, file, options = {}) {
    try {
      const supabaseAdmin = this.getAdminClient();
      const { note_id, title } = options;
      
      // Generate unique filename
      const fileExt = this.getFileExtension(file.originalname || file.mimetype);
      const fileName = `${userId}/recordings/${uuidv4()}_${Date.now()}.${fileExt}`;

      logger.info('Uploading recording to storage', { 
        userId, 
        fileName,
        size: file.size || file.buffer?.length,
        mimetype: file.mimetype
      });

      // Upload to Supabase Storage using admin client (bypass RLS)
      const { data: uploadData, error: uploadError } = await supabaseAdmin
        .storage
        .from(this.bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        logger.error('Storage upload error', { 
          error: uploadError.message,
          errorCode: uploadError.statusCode,
          fileName 
        });
        throw new AppError('Failed to upload audio file', 500);
      }

      // Get public URL
      const { data: { publicUrl } } = supabaseAdmin
        .storage
        .from(this.bucket)
        .getPublicUrl(fileName);

      logger.info('Recording uploaded to storage', { 
        fileName,
        publicUrl 
      });

      // Create recording record in database using admin client
      const { data: recording, error: dbError } = await supabaseAdmin
        .from('recordings')
        .insert({
          id: uuidv4(),
          user_id: userId,
          note_id: note_id || null,
          title: title || 'Voice Recording',
          storage_path: fileName,
          file_url: publicUrl,
          file_size: file.size || file.buffer?.length,
          format: fileExt,
          status: 'uploaded'
        })
        .select()
        .single();

      if (dbError) {
        logger.error('Database insert error', { error: dbError.message });
        
        // Clean up uploaded file
        await supabaseAdmin.storage
          .from(this.bucket)
          .remove([fileName])
          .catch(() => {});
        
        throw new AppError('Failed to create recording record', 500);
      }

      logger.info('Recording record created', { recordingId: recording.id });

      return recording;

    } catch (error) {
      logger.error('Upload recording error', { 
        error: error.message,
        userId 
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to upload recording', 500);
    }
  }

  /**
   * Download file from Supabase Storage
   * @param {string} storagePath - Path to file in storage
   */
  async downloadFile(storagePath) {
    try {
      const supabaseAdmin = this.getAdminClient();
      
      logger.info('Downloading file from storage', { storagePath });

      const { data, error } = await supabaseAdmin
        .storage
        .from(this.bucket)
        .download(storagePath);

      if (error) {
        logger.error('Storage download error', { 
          error: error.message,
          storagePath 
        });
        throw new AppError('Failed to download file', 500);
      }

      // Convert Blob to Buffer
      const arrayBuffer = await data.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      logger.info('File downloaded successfully', { 
        storagePath,
        size: buffer.length 
      });

      return buffer;

    } catch (error) {
      logger.error('Download file error', { 
        error: error.message,
        storagePath 
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to download file', 500);
    }
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
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
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