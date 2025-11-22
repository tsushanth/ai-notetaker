const { YoutubeTranscript } = require('youtube-transcript');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');

class YouTubeTranscriptService {
  /**
   * Process YouTube video using transcript API
   */
  async processVideoUrl(userId, videoUrl, title) {
    try {
      // Validate URL
      if (!this.isValidVideoUrl(videoUrl)) {
        throw new AppError('Invalid YouTube URL', 400);
      }

      // Extract video ID
      const videoId = this.extractYouTubeId(videoUrl);
      if (!videoId) {
        throw new AppError('Could not extract video ID from URL', 400);
      }

      logger.info('Processing YouTube video', { userId, videoId });

      // Get video info
      const videoInfo = await this.getVideoInfo(videoId);

      // Get transcript
      let transcript;
      try {
        transcript = await YoutubeTranscript.fetchTranscript(videoId);
      } catch (error) {
        logger.error('Failed to fetch transcript', {
          videoId,
          error: error.message
        });

        // Provide user-friendly error message
        if (error.message?.includes('Transcript is disabled') ||
            error.message?.includes('No transcript') ||
            error.message?.includes('Could not find')) {
          throw new AppError(
            'No transcript available for this video. Please try a video with captions/subtitles enabled.',
            404
          );
        }

        throw new AppError('Failed to fetch video transcript', 500);
      }

      if (!transcript || transcript.length === 0) {
        throw new AppError(
          'No transcript available for this video. Please try a video with captions/subtitles enabled.',
          404
        );
      }

      // Combine transcript segments into full text
      const fullText = transcript.map(segment => segment.text).join(' ');

      // Create note
      const note = await noteService.createNote(userId, {
        title: title || videoInfo.title || `YouTube Video ${videoId}`,
        content: fullText,
        source_type: 'video',
        source_url: videoUrl,
        metadata: {
          video_id: videoId,
          channel: videoInfo.author_name,
          thumbnail: videoInfo.thumbnail_url,
          transcript_language: 'auto',
          segment_count: transcript.length
        }
      });

      logger.info('YouTube video processed successfully', {
        userId,
        noteId: note.id,
        videoId,
        segmentCount: transcript.length,
        characters: fullText.length
      });

      return {
        note,
        stats: {
          segments: transcript.length,
          characters: fullText.length,
          words: fullText.split(/\s+/).length
        }
      };

    } catch (error) {
      logger.error('Error processing YouTube video', {
        error: error.message,
        stack: error.stack,
        userId,
        videoUrl
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('Failed to process YouTube video', 500);
    }
  }

  /**
   * Get video info using YouTube oEmbed API
   */
  async getVideoInfo(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch video info');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.warn('Failed to fetch video info, using defaults', {
        videoId,
        error: error.message
      });

      // Return defaults if oEmbed fails
      return {
        title: `YouTube Video ${videoId}`,
        author_name: 'Unknown',
        thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
      };
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
   * Validate YouTube URL
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
}

module.exports = new YouTubeTranscriptService();