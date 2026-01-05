/**
 * Recall.ai API Service
 * Handles all communication with the Recall.ai meeting bot platform
 */

const axios = require('axios');
const { logger } = require('../utils/logger');

const RECALL_API_BASE = 'https://us-west-2.recall.ai/api/v1';
const RECALL_API_KEY = process.env.RECALL_API_KEY;

class RecallService {
  constructor() {
    if (!RECALL_API_KEY) {
      logger.warn('RECALL_API_KEY not set - meeting bot features will not work');
    }

    this.client = axios.create({
      baseURL: RECALL_API_BASE,
      headers: {
        Authorization: `Token ${RECALL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add request/response logging
    this.client.interceptors.request.use((config) => {
      logger.debug('Recall API request', {
        method: config.method,
        url: config.url,
      });
      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Recall API response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('Recall API error', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        });
        throw error;
      }
    );
  }

  /**
   * Create a bot to join a meeting
   * Uses the new Recall.ai API structure with recording_config
   * @param {string} meetingUrl - The meeting URL to join
   * @param {Object} options - Bot configuration options
   * @returns {Promise<Object>} - Created bot data
   */
  async createBot(meetingUrl, options = {}) {
    const {
      botName = 'ScribeAI Notetaker',
      joinAt = null,
      automaticLeave = {
        waiting_room_timeout: 600, // 10 minutes
        noone_joined_timeout: 300, // 5 minutes
        everyone_left_timeout: 30, // 30 seconds
      },
    } = options;

    const payload = {
      meeting_url: meetingUrl,
      bot_name: botName,
      automatic_leave: automaticLeave,
      // Use Recall.ai's built-in transcription with the new API structure
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: 'prioritize_accuracy',
            },
          },
        },
      },
    };

    // If scheduledStart provided, set join_at
    if (joinAt) {
      payload.join_at = new Date(joinAt).toISOString();
    }

    try {
      const response = await this.client.post('/bot', payload);
      logger.info('Bot created successfully', {
        botId: response.data.id,
        meetingUrl,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to create bot', {
        error: error.message,
        meetingUrl,
        responseData: error.response?.data,
      });
      throw new Error(error.response?.data?.detail || 'Failed to create meeting bot');
    }
  }

  /**
   * Get bot status and details
   * @param {string} botId - The Recall bot ID
   * @returns {Promise<Object>} - Bot status data
   */
  async getBotStatus(botId) {
    try {
      const response = await this.client.get(`/bot/${botId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get bot status', {
        botId,
        error: error.message,
      });
      throw new Error('Failed to get bot status');
    }
  }

  /**
   * Stop and remove bot from meeting
   * @param {string} botId - The Recall bot ID
   * @returns {Promise<Object>} - Response data
   */
  async stopBot(botId) {
    try {
      const response = await this.client.post(`/bot/${botId}/leave_call`);
      logger.info('Bot stopped successfully', { botId });
      return response.data;
    } catch (error) {
      logger.error('Failed to stop bot', {
        botId,
        error: error.message,
      });
      throw new Error('Failed to stop meeting bot');
    }
  }

  /**
   * Get recording download URL
   * Uses the updated Recall.ai API structure
   * @param {string} botId - The Recall bot ID
   * @returns {Promise<Object>} - Recording data with download URL
   */
  async getRecordingUrl(botId) {
    try {
      // Get bot details which includes recording info
      const botDetails = await this.getBotStatus(botId);

      // New API structure: recordings[0].media_shortcuts.video_mixed.data.download_url
      const recording = botDetails.recordings?.[0];
      const videoData = recording?.media_shortcuts?.video_mixed?.data;

      if (videoData?.download_url) {
        // Calculate duration from recording timestamps
        let durationSeconds = null;
        if (recording.started_at && recording.completed_at) {
          const start = new Date(recording.started_at);
          const end = new Date(recording.completed_at);
          durationSeconds = Math.round((end - start) / 1000);
        }

        return {
          download_url: videoData.download_url,
          duration_seconds: durationSeconds,
        };
      }

      // Fallback: try output_media structure
      if (botDetails.output_media?.video) {
        return {
          download_url: botDetails.output_media.video.download_url,
          duration_seconds: botDetails.output_media.video.duration_seconds,
        };
      }

      logger.warn('No recording data found in bot response', {
        botId,
        hasRecordings: !!botDetails.recordings?.length,
      });

      throw new Error('Recording not yet available');
    } catch (error) {
      logger.error('Failed to get recording URL', {
        botId,
        error: error.message,
        responseData: error.response?.data,
      });
      throw new Error('Failed to get meeting recording');
    }
  }

  /**
   * Get transcript from bot
   * Uses the updated Recall.ai API structure
   * @param {string} botId - The Recall bot ID
   * @returns {Promise<Object>} - Transcript data
   */
  async getTranscript(botId) {
    try {
      // Get bot details which includes transcript URL
      const botDetails = await this.getBotStatus(botId);

      // New API structure: recordings[0].media_shortcuts.transcript.data.download_url
      const recording = botDetails.recordings?.[0];
      const transcriptData = recording?.media_shortcuts?.transcript?.data;

      if (transcriptData?.download_url) {
        // Download the transcript JSON from the URL
        logger.info('Downloading transcript from URL', { botId });
        const response = await axios.get(transcriptData.download_url);
        return response.data;
      }

      // Fallback: try output_media structure
      if (botDetails.output_media?.transcript?.data) {
        return botDetails.output_media.transcript.data;
      }

      logger.warn('No transcript data found in bot response', {
        botId,
        hasRecordings: !!botDetails.recordings?.length,
        hasMediaShortcuts: !!recording?.media_shortcuts,
      });

      throw new Error('Transcript not yet available');
    } catch (error) {
      logger.error('Failed to get transcript', {
        botId,
        error: error.message,
        responseData: error.response?.data,
      });
      throw new Error('Failed to get meeting transcript');
    }
  }

  /**
   * Detect meeting platform from URL
   * @param {string} meetingUrl - The meeting URL
   * @returns {string} - Platform identifier
   */
  detectPlatform(meetingUrl) {
    const url = meetingUrl.toLowerCase();
    if (url.includes('zoom.us')) return 'zoom';
    if (url.includes('meet.google.com')) return 'google_meet';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    if (url.includes('webex.com')) return 'webex';
    return 'other';
  }

  /**
   * Validate meeting URL format
   * @param {string} meetingUrl - The meeting URL to validate
   * @returns {boolean} - Whether the URL is valid
   */
  validateMeetingUrl(meetingUrl) {
    if (!meetingUrl || typeof meetingUrl !== 'string') return false;

    const urlPatterns = [
      // Zoom patterns
      /https?:\/\/[\w.-]*zoom\.us\/j\/\d+/i,
      /https?:\/\/[\w.-]*zoom\.us\/my\/[\w.-]+/i,
      // Google Meet patterns
      /https?:\/\/meet\.google\.com\/[\w-]+/i,
      // Microsoft Teams patterns
      /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/.+/i,
      /https?:\/\/teams\.live\.com\/meet\/.+/i,
      // Webex patterns
      /https?:\/\/[\w.-]*webex\.com\/.+/i,
    ];

    return urlPatterns.some((pattern) => pattern.test(meetingUrl));
  }

  /**
   * Get list of supported meeting platforms
   * @returns {Array<Object>} - List of supported platforms
   */
  getSupportedPlatforms() {
    return [
      { id: 'zoom', name: 'Zoom', urlExample: 'https://zoom.us/j/123456789' },
      { id: 'google_meet', name: 'Google Meet', urlExample: 'https://meet.google.com/abc-defg-hij' },
      { id: 'teams', name: 'Microsoft Teams', urlExample: 'https://teams.microsoft.com/l/meetup-join/...' },
      { id: 'webex', name: 'Webex', urlExample: 'https://company.webex.com/meet/...' },
    ];
  }
}

module.exports = new RecallService();
