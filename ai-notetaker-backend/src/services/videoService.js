const ytdl = require('@distube/ytdl-core');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { openai, MODELS } = require('../config/openai');
const noteService = require('./noteService');

class VideoService {
  /**
   * Process a video URL and transcribe its audio
   */
  async processVideoUrl(userId, videoUrl, title) {
    try {
      // Validate URL
      if (!this.isValidVideoUrl(videoUrl)) {
        throw new AppError('Invalid video URL', 400);
      }

      // Check if it's a YouTube URL
      if (ytdl.validateURL(videoUrl)) {
        return await this.processYouTubeVideo(userId, videoUrl, title);
      }

      // For other video platforms, you'd implement similar logic
      throw new AppError('Only YouTube URLs are currently supported', 400);

    } catch (error) {
      logger.error('Error processing video URL', { error: error.message, userId, videoUrl });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process video URL', 500);
    }
  }

  /**
   * Process YouTube video
   */
  async processYouTubeVideo(userId, videoUrl, customTitle) {
    try {
      // Get video info
      const info = await ytdl.getInfo(videoUrl);
      const videoTitle = customTitle || info.videoDetails.title;
      const videoDuration = parseInt(info.videoDetails.lengthSeconds);

      // Check duration limit (e.g., 2 hours)
      const maxDuration = parseInt(process.env.MAX_AUDIO_DURATION) || 7200;
      if (videoDuration > maxDuration) {
        throw new AppError(
          `Video is too long. Maximum duration is ${maxDuration / 60} minutes`,
          400
        );
      }

      // Download audio
      const tempAudioPath = path.join(os.tmpdir(), `video_${Date.now()}.mp3`);
      
      await new Promise((resolve, reject) => {
        const stream = ytdl(videoUrl, { 
          quality: 'highestaudio',
          filter: 'audioonly',
          // Add these options to bypass bot detection
          requestOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9',
            }
          }
        });

        const writeStream = require('fs').createWriteStream(tempAudioPath);
        
        stream.pipe(writeStream);

        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        stream.on('error', reject);
      });

      try {
        // Transcribe audio with OpenAI Whisper
        const audioFile = await fs.readFile(tempAudioPath);
        const transcription = await openai.audio.transcriptions.create({
          file: new File([audioFile], 'audio.mp3', { type: 'audio/mpeg' }),
          model: MODELS.WHISPER,
          language: 'en',
          response_format: 'verbose_json'
        });

        // Clean up temp file
        await fs.unlink(tempAudioPath).catch(() => {});

        // Create note with transcription
        const note = await noteService.createNote(userId, {
          title: videoTitle,
          content: transcription.text,
          source_type: 'video',
          source_url: videoUrl,
          metadata: {
            video_id: info.videoDetails.videoId,
            channel: info.videoDetails.author.name,
            duration: videoDuration,
            published_at: info.videoDetails.publishDate,
            thumbnail: info.videoDetails.thumbnails[0]?.url
          }
        });

        logger.info('YouTube video processed', { 
          userId, 
          noteId: note.id,
          videoId: info.videoDetails.videoId
        });

        return {
          note,
          stats: {
            duration: videoDuration,
            characters: transcription.text.length,
            words: transcription.text.split(/\s+/).length
          }
        };

      } catch (transcribeError) {
        // Clean up temp file on error
        await fs.unlink(tempAudioPath).catch(() => {});
        throw transcribeError;
      }

    } catch (error) {
      logger.error('Error processing YouTube video', { error: error.message, userId });
      throw new AppError('Failed to process YouTube video', 500);
    }
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
      /youtube\.com\/v\/([^&\n?#]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Get video captions/subtitles if available
   * This is an alternative to transcription for videos that have captions
   */
  async getVideoCaptions(videoUrl) {
    try {
      const info = await ytdl.getInfo(videoUrl);
      const captions = info.player_response?.captions;
      
      if (!captions || !captions.playerCaptionsTracklistRenderer) {
        return null;
      }

      const captionTracks = captions.playerCaptionsTracklistRenderer.captionTracks;
      
      // Get English captions
      const englishTrack = captionTracks.find(track => 
        track.languageCode === 'en' || track.languageCode.startsWith('en')
      );

      if (!englishTrack) return null;

      // Fetch caption content
      const response = await axios.get(englishTrack.baseUrl);
      
      // Parse and clean caption text (remove timestamps, tags, etc.)
      // This is a simplified version - you might want more sophisticated parsing
      const text = response.data
        .replace(/<[^>]*>/g, '') // Remove XML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      return text;
    } catch (error) {
      logger.warn('Could not fetch captions', { error: error.message });
      return null;
    }
  }
}

module.exports = new VideoService();