const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { MODELS } = require('../config/openai');
const noteService = require('./noteService');

const INVIDIOUS_INSTANCES = [
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://vid.puffyan.us'
];

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
   * Process YouTube video - tries yt-dlp first, then Invidious fallback
   */
  async processYouTubeVideo(userId, videoUrl, videoId, customTitle) {
    let tempAudioPath = null;

    try {
      let metadata;
      let useInvidious = false;

      // Try yt-dlp first with all strategies
      try {
        logger.info('Attempting yt-dlp download', { videoId });
        metadata = await this.getVideoMetadata(videoUrl);
        logger.info('yt-dlp metadata successful', { videoId, title: metadata.title });
      } catch (error) {
        logger.warn('yt-dlp failed, falling back to Invidious', { 
          error: error.message,
          videoId 
        });
        
        // Fallback to Invidious
        const invidiousData = await this.getVideoInfoViaInvidious(videoId);
        
        if (!invidiousData.audioUrl) {
          throw new AppError(
            'Unable to access this video. It may be private, age-restricted, or unavailable in your region.',
            403
          );
        }

        metadata = {
          title: invidiousData.title,
          duration: invidiousData.duration,
          uploader: invidiousData.uploader,
          thumbnail: invidiousData.thumbnail
        };
        useInvidious = true;
        
        logger.info('Downloading audio via Invidious', { 
          videoId,
          audioUrl: invidiousData.audioUrl.substring(0, 100) + '...'
        });
        tempAudioPath = await this.downloadAudioFromUrl(invidiousData.audioUrl, videoId);
      }

      const videoTitle = customTitle || metadata.title || `YouTube Video ${videoId}`;
      const videoDuration = metadata.duration || 0;

      // Check duration limit
      const maxDuration = parseInt(process.env.MAX_AUDIO_DURATION) || 7200;
      if (videoDuration > maxDuration) {
        throw new AppError(
          `Video is too long. Maximum duration is ${Math.floor(maxDuration / 60)} minutes`,
          400
        );
      }

      // If using yt-dlp (not Invidious), download audio normally
      if (!useInvidious) {
        logger.info('Downloading audio via yt-dlp', { videoId, duration: videoDuration });
        tempAudioPath = await this.downloadAudio(videoUrl, videoId);
      }

      // Check file size (Whisper has 25MB limit)
      const stats = await fs.stat(tempAudioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        throw new AppError('Audio file too large for transcription (max 25MB)', 400);
      }

      logger.info('Transcribing audio with Whisper', { 
        videoId, 
        fileSizeMB: fileSizeMB.toFixed(2),
        method: useInvidious ? 'invidious' : 'yt-dlp'
      });

      // Transcribe with Deepgram
      const audioBuffer = await fs.readFile(tempAudioPath);

      const dgResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/mpeg',
        },
        body: audioBuffer,
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
          transcription_language: 'en',
          processing_method: useInvidious ? 'invidious' : 'yt-dlp'
        }
      });

      logger.info('YouTube video processed successfully', { 
        userId, 
        noteId: note.id,
        videoId: videoId,
        duration: videoDuration,
        method: useInvidious ? 'invidious' : 'yt-dlp'
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
        stack: error.stack,
        userId, 
        videoId 
      });

      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process YouTube video', 500);
    }
  }

  /**
   * Get video info using Invidious API (bot-detection free)
   * Improved to check multiple audio format types
   */
  async getVideoInfoViaInvidious(videoId) {
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        logger.info('Trying Invidious instance', { instance, videoId });
        
        const response = await axios.get(`${instance}/api/v1/videos/${videoId}`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        if (!response.data) {
          logger.warn('Invidious returned no data', { instance });
          continue;
        }

        logger.info('Invidious response received', { 
          instance,
          hasAdaptiveFormats: !!response.data.adaptiveFormats,
          adaptiveFormatsCount: response.data.adaptiveFormats?.length || 0,
          hasFormatStreams: !!response.data.formatStreams,
          formatStreamsCount: response.data.formatStreams?.length || 0
        });

        // Try to find audio stream in multiple locations
        let audioUrl = null;
        
        // Strategy 1: Check adaptiveFormats for audio-only streams
        if (response.data.adaptiveFormats && response.data.adaptiveFormats.length > 0) {
          // Look for audio-only formats (no video)
          const audioOnly = response.data.adaptiveFormats.find(f => 
            f.type && f.type.includes('audio') && !f.type.includes('video')
          );
          
          if (audioOnly?.url) {
            audioUrl = audioOnly.url;
            logger.info('Found audio-only stream in adaptiveFormats', { 
              type: audioOnly.type,
              bitrate: audioOnly.bitrate 
            });
          }
        }

        // Strategy 2: Check formatStreams (contains audio+video)
        if (!audioUrl && response.data.formatStreams && response.data.formatStreams.length > 0) {
          // Use lowest quality to save bandwidth (audio quality is same)
          const lowestQuality = response.data.formatStreams
            .filter(f => f.url)
            .sort((a, b) => (a.qualityLabel || '720p').localeCompare(b.qualityLabel || '720p'))[0];
          
          if (lowestQuality?.url) {
            audioUrl = lowestQuality.url;
            logger.info('Using formatStreams (audio+video)', { 
              quality: lowestQuality.qualityLabel,
              type: lowestQuality.type
            });
          }
        }

        // Strategy 3: Last resort - use any adaptive format
        if (!audioUrl && response.data.adaptiveFormats && response.data.adaptiveFormats.length > 0) {
          const anyFormat = response.data.adaptiveFormats.find(f => f.url);
          if (anyFormat?.url) {
            audioUrl = anyFormat.url;
            logger.info('Using any available adaptive format', { 
              type: anyFormat.type 
            });
          }
        }

        if (audioUrl) {
          return {
            title: response.data.title,
            duration: response.data.lengthSeconds,
            uploader: response.data.author,
            thumbnail: response.data.videoThumbnails?.[0]?.url,
            audioUrl: audioUrl
          };
        }

        logger.warn('No audio URL found in Invidious response', { instance });
        continue;

      } catch (error) {
        logger.warn('Invidious instance failed', { 
          instance, 
          error: error.message,
          status: error.response?.status
        });
        continue;
      }
    }
    
    throw new AppError(
      'Unable to access video from any source. The video may be private, age-restricted, or region-blocked.',
      403
    );
  }

  /**
   * Download audio from direct URL (from Invidious)
   * Improved with better error handling and progress logging
   */
  async downloadAudioFromUrl(audioUrl, videoId) {
    const tempAudioPath = path.join(os.tmpdir(), `video_${videoId}_${Date.now()}.mp4`);
    
    try {
      logger.info('Starting audio download from URL', { 
        videoId,
        urlPrefix: audioUrl.substring(0, 100)
      });

      const response = await axios({
        method: 'GET',
        url: audioUrl,
        responseType: 'stream',
        timeout: 180000, // 3 minutes
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        }
      });

      const writer = fs.createWriteStream(tempAudioPath);
      
      let downloadedBytes = 0;
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length;
      });

      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info('Audio download completed', { 
            videoId,
            bytes: downloadedBytes,
            mb: (downloadedBytes / (1024 * 1024)).toFixed(2)
          });
          resolve(tempAudioPath);
        });
        writer.on('error', (error) => {
          logger.error('Audio download stream error', { 
            videoId,
            error: error.message
          });
          reject(error);
        });
        
        // Timeout handler
        setTimeout(() => {
          writer.destroy();
          reject(new Error('Download timeout after 3 minutes'));
        }, 180000);
      });
    } catch (error) {
      logger.error('Audio download failed', { 
        videoId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get video metadata using yt-dlp with multiple fallback strategies
   */
  async getVideoMetadata(videoUrl) {
    const strategies = [
      // Strategy 1: Android client
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=android',
        '--extractor-args', 'youtube:skip=translated_subs',
        '--no-check-certificates',
        videoUrl
      ],
      // Strategy 2: Web client
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=web',
        '--extractor-args', 'youtube:skip=translated_subs,hls,dash',
        '--age-limit', '21',
        '--no-check-certificates',
        videoUrl
      ],
      // Strategy 3: MediaConnect
      [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=mediaconnect',
        '--no-check-certificates',
        videoUrl
      ],
      // Strategy 4: TV embedded
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
        logger.info(`Metadata strategy ${i + 1} succeeded`, { videoUrl });
        return metadata;
      } catch (error) {
        logger.warn(`Metadata strategy ${i + 1} failed`, { error: error.message });
        if (i === strategies.length - 1) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
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
        '--extractor-args', 'youtube:player_client=android',
        '--extractor-args', 'youtube:skip=translated_subs',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ],
      // Strategy 2: Web client
      [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=web',
        '--extractor-args', 'youtube:skip=translated_subs,hls,dash',
        '--age-limit', '21',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ],
      // Strategy 3: MediaConnect
      [
        '-f', 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=mediaconnect',
        '--no-check-certificates',
        '-o', tempAudioPath,
        videoUrl
      ]
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        await this._tryDownload(strategies[i], tempAudioPath);
        logger.info(`Download strategy ${i + 1} succeeded`, { videoId });
        return tempAudioPath;
      } catch (error) {
        logger.warn(`Download strategy ${i + 1} failed`, { error: error.message });
        if (i === strategies.length - 1) {
          throw error;
        }
        await fs.unlink(tempAudioPath).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
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

        // Check for the file
        fs.access(expectedPath)
          .then(() => resolve(expectedPath))
          .catch(() => {
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
   * Create File object for OpenAI API
   */
  async createFile(buffer, filename) {
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