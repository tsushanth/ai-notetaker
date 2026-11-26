const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { TranscriptError } = require('../utils/transcriptError');
const { createSupadataClient } = require('./supadataClient');
const { createTranscriptGeneration } = require('./transcriptGeneration');
const noteService = require('./noteService');

// Released Android apps stop waiting after 60 seconds, so an answer goes out before that.
const RESPONSE_BUDGET_MS = 50_000;

/**
 * YouTube Transcript Service
 *
 * 1. Existing captions from Supadata (mode=native, 1 credit).
 * 2. No captions: Supadata writes the transcript (services/transcriptGeneration.js: limits, cost ledger, kill switch).
 */
class YouTubeTranscriptService {
  constructor({ supadata, generation } = {}) {
    this.supadata = supadata || null;
    this.generation = generation || null;
  }

  client() { return (this.supadata ||= createSupadataClient()); }

  generator() { return (this.generation ||= createTranscriptGeneration({ supadata: this.client() })); }

  /** A transcript for this link is already being written for this user: asking again costs nothing. */
  isGenerating(userId, videoUrl) {
    const videoId = typeof videoUrl === 'string' ? this.extractYouTubeId(videoUrl) : null;
    return !!videoId && !!this.generation?.isRunning(userId, videoId.slice(0, 11));
  }

  /**
   * Process YouTube video URL and create a note
   */
  async processVideoUrl(userId, videoUrl, title, { budgetMs = RESPONSE_BUDGET_MS } = {}) {
    const began = Date.now();
    try {
      // Validate URL
      if (!this.isValidVideoUrl(videoUrl)) {
        throw new AppError('Invalid YouTube URL', 400);
      }

      // Extract video ID (11 characters; anything after that is share-text debris)
      const videoId = /^[A-Za-z0-9_-]{11}/.exec(this.extractYouTubeId(videoUrl) || '')?.[0];
      if (!videoId) {
        throw new AppError('Could not extract video ID from URL', 400);
      }

      logger.info('Processing YouTube video', { userId, videoId });

      const save = async (content, source, lang) => {
        // Get video info
        const videoInfo = await this.getVideoInfo(videoId);
        return noteService.createNote(userId, {
          title: title || videoInfo.title || `YouTube Video ${videoId}`,
          content,
          source_type: 'video',
          source_url: videoUrl,
          metadata: {
            video_id: videoId,
            channel: videoInfo.author_name,
            thumbnail: videoInfo.thumbnail_url,
            transcript_source: source,
            transcript_language: lang || 'auto',
            segment_count: 1
          }
        });
      };
      const answer = (note, transcriptSource) => {
        const text = String(note.content ?? '');
        logger.info('YouTube video processed successfully', { userId, noteId: note.id, videoId, transcriptSource, characters: text.length });
        return { note, stats: { segments: 1, characters: text.length, words: text.split(/\s+/).filter(Boolean).length, transcriptSource } };
      };
      const waitForGeneration = async () => {
        const job = this.generator().start({ userId, videoId, saveNote: (content, lang) => save(content, 'supadata_generated', lang) });
        let timer;
        const pending = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, began + budgetMs - Date.now())); });
        const done = await Promise.race([job, pending]).finally(() => clearTimeout(timer));
        if (!done) throw new TranscriptError('TRANSCRIPT_PENDING');
        return answer(done.note, 'supadata_generated');
      };

      if (this.isGenerating(userId, videoUrl)) return await waitForGeneration();

      const native = await this.getCaptions(videoId, Math.max(1000, began + budgetMs - Date.now()));
      if (!native) {
        logger.info('YouTube video has no captions', { userId, videoId });
        return await waitForGeneration();
      }
      return answer(await save(native.content, 'supadata_native', native.lang), 'supadata_native');

    } catch (error) {
      logger.error('Error processing YouTube video', {
        error: error.message,
        code: error.publicCode,
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

  /** The video's own captions: { content, lang }, or null when it has none. */
  async getCaptions(videoId, pollTimeoutMs = RESPONSE_BUDGET_MS) {
    try {
      let result = await this.client().transcript(videoId, 'native');
      // Long videos are answered with a job to poll.
      if (result.jobId) result = await this.client().pollJob(result.jobId, { intervalMs: 2000, timeoutMs: pollTimeoutMs });
      return result.content && result.content.trim() ? result : null;
    } catch (error) {
      if (error.code === 'transcript-unavailable') return null;
      logger.error('Supadata captions request failed', { videoId, code: error.code, error: error.message });
      if (['not-found', 'forbidden'].includes(error.code)) throw new TranscriptError('VIDEO_UNAVAILABLE');
      if (error.code === 'invalid-request') throw new TranscriptError('NO_TRANSCRIPT');
      throw new TranscriptError('TRANSCRIPT_SERVICE_ERROR');
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
    // A watch link may carry other parameters before v= (watch?app=desktop&v=...); live streams use /live/.
    const patterns = [
      /(?:youtube\.com\/watch\/?\?(?:[^#\n]*?&)?v=|youtu\.be\/)([^&\n?#/]+)/i,
      /youtube\.com\/(?:embed|v|shorts|live)\/([^&\n?#/]+)/i
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
module.exports.YouTubeTranscriptService = YouTubeTranscriptService;
