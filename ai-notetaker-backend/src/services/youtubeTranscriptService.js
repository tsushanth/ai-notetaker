const { YoutubeTranscript } = require('youtube-transcript');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');

/**
 * YouTube Transcript Service
 * 
 * Strategy:
 * 1. Try YouTube's built-in transcript (free, fast)
 * 2. Fallback to Supadata API (handles videos without captions via AI)
 * 
 * Supadata pricing:
 * - Free tier: 100 requests/month
 * - Native transcripts (mode=native): 1 credit
 * - AI-generated transcripts (mode=generate): uses AI credits
 * 
 * Get API key at: https://supadata.ai
 */
class YouTubeTranscriptService {
  constructor() {
    this.supadataApiKey = process.env.SUPADATA_API_KEY;
    this.supadataBaseUrl = 'https://api.supadata.ai/v1';
  }

  /**
   * Process YouTube video URL and create a note
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

      // Try to get transcript
      let fullText;
      let transcriptSource = 'youtube';
      let segmentCount = 0;

      try {
        // First, try YouTube's built-in transcript (free)
        const transcript = await YoutubeTranscript.fetchTranscript(videoId);
        
        if (transcript && transcript.length > 0) {
          fullText = transcript.map(segment => segment.text).join(' ');
          segmentCount = transcript.length;
          logger.info('Got transcript from YouTube', { videoId, segments: segmentCount });
        } else {
          throw new Error('Empty transcript');
        }
      } catch (transcriptError) {
        logger.warn('YouTube transcript not available, trying Supadata', {
          videoId,
          error: transcriptError.message
        });

        // Fallback: Use Supadata API
        try {
          const supadataResult = await this.getTranscriptFromSupadata(videoUrl, videoId);
          fullText = supadataResult.content;
          transcriptSource = supadataResult.source; // 'supadata_native' or 'supadata_generated'
          segmentCount = 1;
          logger.info('Got transcript from Supadata', { 
            videoId, 
            source: transcriptSource,
            lang: supadataResult.lang
          });
        } catch (supadataError) {
          logger.error('Supadata fallback also failed', {
            videoId,
            error: supadataError.message
          });

          throw new AppError(
            'Could not get transcript for this video. The video may be private, too long, or have no audio.',
            404
          );
        }
      }

      if (!fullText || fullText.trim().length === 0) {
        throw new AppError(
          'No transcript content could be extracted from this video.',
          404
        );
      }

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
          transcript_source: transcriptSource,
          transcript_language: 'auto',
          segment_count: segmentCount
        }
      });

      logger.info('YouTube video processed successfully', {
        userId,
        noteId: note.id,
        videoId,
        transcriptSource,
        characters: fullText.length
      });

      return {
        note,
        stats: {
          segments: segmentCount,
          characters: fullText.length,
          words: fullText.split(/\s+/).length,
          transcriptSource
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
   * Get transcript using Supadata API
   * Supadata handles both native captions and AI-generated transcripts
   */
  async getTranscriptFromSupadata(videoUrl, videoId) {
    if (!this.supadataApiKey) {
      throw new Error('SUPADATA_API_KEY not configured. Get one at https://supadata.ai');
    }

    logger.info('Fetching transcript from Supadata', { videoId });

    // Build URL with parameters
    const params = new URLSearchParams({
      url: videoUrl,
      text: 'true',       // Return plain text instead of timestamped chunks
      mode: 'auto'        // Try native first, generate with AI if needed
    });

    const response = await fetch(`${this.supadataBaseUrl}/transcript?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': this.supadataApiKey,
        'Accept': 'application/json'
      }
    });

    // Handle async job (HTTP 202)
    if (response.status === 202) {
      const jobData = await response.json();
      logger.info('Supadata returned async job, polling...', { 
        videoId, 
        jobId: jobData.jobId 
      });
      
      // Poll for result
      return await this.pollSupadataJob(jobData.jobId, videoId);
    }

    // Handle immediate response
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Supadata API error: ${response.status} - ${errorData.error || errorData.message || 'Unknown error'}`
      );
    }

    const data = await response.json();

    if (!data.content) {
      throw new Error('No transcript content in Supadata response');
    }

    // Ensure content is a string (Supadata may return array of segments)
    let content = data.content;
    if (Array.isArray(content)) {
      content = content.map(segment =>
        typeof segment === 'string' ? segment : (segment.text || segment.content || '')
      ).join(' ');
    } else if (typeof content !== 'string') {
      content = String(content);
    }

    return {
      content,
      lang: data.lang || 'en',
      source: data.generated ? 'supadata_generated' : 'supadata_native'
    };
  }

  /**
   * Poll Supadata job for async transcript generation
   */
  async pollSupadataJob(jobId, videoId, maxAttempts = 30, intervalMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.debug('Polling Supadata job', { videoId, jobId, attempt });

      const response = await fetch(`${this.supadataBaseUrl}/transcript/${jobId}`, {
        method: 'GET',
        headers: {
          'x-api-key': this.supadataApiKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Supadata job poll error: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'completed') {
        logger.info('Supadata job completed', { videoId, jobId });

        // Ensure content is a string
        let content = data.result?.content || data.content;
        if (Array.isArray(content)) {
          content = content.map(segment =>
            typeof segment === 'string' ? segment : (segment.text || segment.content || '')
          ).join(' ');
        } else if (typeof content !== 'string') {
          content = String(content);
        }

        return {
          content,
          lang: data.result?.lang || data.lang || 'en',
          source: 'supadata_generated'
        };
      }

      if (data.status === 'failed') {
        throw new Error(`Supadata job failed: ${data.error || 'Unknown error'}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Supadata job timed out');
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