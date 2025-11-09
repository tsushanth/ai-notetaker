const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { openai, MODELS } = require('../config/openai');
const noteService = require('./noteService');

class VideoService {
  /**
   * Process a video URL and transcribe its audio using Whisper
   */
  async processVideoUrl(userId, videoUrl, title) {
    try {
      // Validate URL
      if (!this.isValidVideoUrl(videoUrl)) {
        throw new AppError('Invalid video URL', 400);
      }

      // Extract video ID
      const videoId = this.extractYouTubeId(videoUrl);
      if (!videoId) {
        throw new AppError('Could not extract video ID from URL', 400);
      }

      return await this.processYouTubeVideo(userId, videoUrl, videoId, title);

    } catch (error) {
      logger.error('Error processing video URL', { error: error.message, userId, videoUrl });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process video URL', 500);
    }
  }

  /**
   * Process YouTube video using yt-dlp and Whisper API
   */
  async processYouTubeVideo(userId, videoUrl, videoId, customTitle) {
    let tempAudioPath = null;

    try {
      // Get video metadata using yt-dlp
      const metadata = await this.getVideoMetadata(videoUrl);
      const videoTitle = customTitle || metadata.title || `YouTube Video ${videoId}`;
      const videoDuration = metadata.duration || 0;

      // Check duration limit (e.g., 2 hours = 7200 seconds)
      const maxDuration = parseInt(process.env.MAX_AUDIO_DURATION) || 7200;
      if (videoDuration > maxDuration) {
        throw new AppError(
          `Video is too long. Maximum duration is ${Math.floor(maxDuration / 60)} minutes`,
          400
        );
      }

      // Download audio using yt-dlp
      logger.info('Downloading audio', { videoId, duration: videoDuration });
      tempAudioPath = await this.downloadAudio(videoUrl, videoId);

      // Check file size (Whisper has 25MB limit)
      const stats = await fs.stat(tempAudioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        throw new AppError('Audio file too large for transcription (max 25MB)', 400);
      }

      logger.info('Transcribing audio with Whisper', { 
        videoId, 
        fileSizeMB: fileSizeMB.toFixed(2) 
      });

      // Transcribe with OpenAI Whisper
      const audioBuffer = await fs.readFile(tempAudioPath);
      const transcription = await openai.audio.transcriptions.create({
        file: await this.createFile(audioBuffer, 'audio.mp3'),
        model: MODELS.WHISPER,
        language: 'en',
        response_format: 'verbose_json'
      });

      // Clean up temp file
      await fs.unlink(tempAudioPath).catch(() => {});
      tempAudioPath = null;

      // Create note with transcription
      const note = await noteService.createNote(userId, {
        title: videoTitle,
        content: transcription.text,
        source_type: 'video',
        source_url: videoUrl,
        metadata: {
          video_id: videoId,
          channel: metadata.uploader || metadata.channel,
          duration: videoDuration,
          thumbnail: metadata.thumbnail,
          transcription_language: 'en'
        }
      });

      logger.info('YouTube video processed successfully', { 
        userId, 
        noteId: note.id,
        videoId: videoId,
        duration: videoDuration
      });

      return {
        note,
        stats: {
          duration: videoDuration,
          characters: transcription.text.length,
          words: transcription.text.split(/\s+/).length
        }
      };

    } catch (error) {
      // Clean up temp file on error
      if (tempAudioPath) {
        await fs.unlink(tempAudioPath).catch(() => {});
      }

      logger.error('Error processing YouTube video', { 
        error: error.message, 
        userId, 
        videoId 
      });

      // Provide specific error messages
      if (error.message && error.message.includes('Video unavailable')) {
        throw new AppError('Video is unavailable or private', 404);
      }
      if (error.message && error.message.includes('Sign in')) {
        throw new AppError('Video requires sign-in to view', 403);
      }
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process YouTube video', 500);
    }
  }

  /**
   * Get video metadata using yt-dlp with multiple fallback strategies
   */
  async getVideoMetadata(videoUrl) {
    const strategies = [
      // Strategy 1: Android client (most reliable)
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=android,web',
        '--no-check-certificates',
        videoUrl
      ],
      // Strategy 2: iOS client fallback
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=ios',
        '--no-check-certificates',
        videoUrl
      ],
      // Strategy 3: TV embedded client
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=tv_embedded',
        '--no-check-certificates',
        videoUrl
      ]
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        const metadata = await this._tryGetMetadata(strategies[i]);
        return metadata;
      } catch (error) {
        logger.warn(`Metadata strategy ${i + 1} failed`, { error: error.message });
        if (i === strategies.length - 1) {
          throw error;
        }
        // Wait a bit before trying next strategy
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Helper method to try getting metadata with specific args
   */
  async _tryGetMetadata(args) {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', args);

      let stdout = '';
      let stderr = '';

      ytDlp.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ytDlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          logger.error('yt-dlp metadata error', { stderr, code });
          reject(new Error('Failed to fetch video metadata'));
          return;
        }

        try {
          const metadata = JSON.parse(stdout);
          resolve(metadata);
        } catch (e) {
          reject(new Error('Failed to parse video metadata'));
        }
      });

      ytDlp.on('error', (error) => {
        reject(new Error(`yt-dlp not found: ${error.message}`));
      });
    });
  }

  /**
   * Download audio using yt-dlp with multiple fallback strategies
   */
  async downloadAudio(videoUrl, videoId) {
    const tempAudioPath = path.join(os.tmpdir(), `video_${videoId}_${Date.now()}.mp3`);

    const strategies = [
      // Strategy 1: Android client
      [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=android,web',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ],
      // Strategy 2: iOS client
      [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=ios',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ],
      // Strategy 3: TV embedded
      [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=tv_embedded',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ]
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        await this._tryDownload(strategies[i], tempAudioPath);
        return tempAudioPath;
      } catch (error) {
        logger.warn(`Download strategy ${i + 1} failed`, { error: error.message });
        if (i === strategies.length - 1) {
          throw error;
        }
        // Clean up partial download before retry
        await fs.unlink(tempAudioPath).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Helper method to try downloading with specific args
   */
  async _tryDownload(args, expectedPath) {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', args);

      let stderr = '';

      ytDlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          logger.error('yt-dlp download error', { stderr, code });
          reject(new Error('Failed to download audio'));
          return;
        }

        // yt-dlp may add extensions, check for the file
        fs.access(expectedPath)
          .then(() => resolve(expectedPath))
          .catch(() => {
            // Try with .mp3 extension if not already there
            const mp3Path = expectedPath.replace(/\.[^.]+$/, '') + '.mp3';
            fs.access(mp3Path)
              .then(() => resolve(mp3Path))
              .catch(() => reject(new Error('Audio file not found after download')));
          });
      });

      ytDlp.on('error', (error) => {
        reject(new Error(`yt-dlp not found: ${error.message}`));
      });
    });
  }

  /**
   * Create File object for OpenAI API (Node.js doesn't have native File)
   */
  async createFile(buffer, filename) {
    // OpenAI SDK expects a File-like object
    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    return new File([blob], filename, { type: 'audio/mpeg' });
  }

  /**
   * Validate video URL
   */
  isValidVideoUrl(url) {
    try {
      const urlObj = new URL(url);
      const validDomains = [
        'youtube.com',
        'youtu.be',
        'www.youtube.com',
        'm.youtube.com'
      ];
      
      return validDomains.some(domain => urlObj.hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  extractYouTubeId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/embed\/([^&\n?#]+)/,
      /youtube\.com\/v\/([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Format seconds to timestamp (HH:MM:SS)
   */
  formatTimestamp(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = new VideoService();