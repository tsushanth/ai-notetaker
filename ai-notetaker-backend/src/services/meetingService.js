/**
 * Meeting Service
 * Handles business logic for meeting bot functionality
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const recallService = require('./recallService');
const noteService = require('./noteService');
const storageService = require('./storageService');
const axios = require('axios');
const {
  BOT_STATUS, TERMINAL_BOT_STATUSES, MESSAGES,
  extractStatus, isOutOfOrder, summarizeBot, describeFailure,
} = require('../utils/recallStatus');

// A status event never overwrites these meeting statuses; PostgREST filter list, applied in the same UPDATE.
const SETTLED_MEETING_STATUSES = '("transcribing","completed","failed","cancelled")';
const ACTIVE_BOT_STATUSES = ['joining', 'in_call', 'recording'];

/** Should this bot be re-read from Recall? Also covers a finished bot whose meeting still waits for processing. */
function needsReconcile(meeting, botRun) {
  if (!botRun.recall_bot_id) return false;
  return ACTIVE_BOT_STATUSES.includes(botRun.status) || (meeting.status === 'processing' && botRun.status === 'done');
}

class MeetingService {
  constructor() {
    // Wait before processing so Recall has finished writing its files, and between transcript retries.
    this.processingDelayMs = 5000;
    this.transcriptRetryMs = 5000;
  }

  /**
   * Create a new meeting and deploy bot
   * @param {string} userId - User ID
   * @param {string} meetingUrl - Meeting URL to join
   * @param {Object} options - Meeting options
   * @returns {Promise<Object>} - Created meeting with bot info
   */
  async createMeeting(userId, meetingUrl, options = {}) {
    const { title, scheduledStart } = options;

    if (recallService.isZoomGovUrl(meetingUrl)) {
      throw new AppError('Zoom for Government (zoomgov.com) meetings are not supported.', 400);
    }

    // Validate URL
    if (!recallService.validateMeetingUrl(meetingUrl)) {
      throw new AppError(
        'Invalid meeting URL. Supported platforms: Zoom, Google Meet, Microsoft Teams, Webex',
        400
      );
    }

    // Detect platform
    const platform = recallService.detectPlatform(meetingUrl);

    // Create meeting record
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .insert({
        user_id: userId,
        title: title || `Meeting - ${new Date().toLocaleString()}`,
        meeting_url: meetingUrl,
        platform,
        status: 'pending',
        scheduled_start: scheduledStart || null,
      })
      .select()
      .single();

    if (meetingError) {
      logger.error('Failed to create meeting record', { error: meetingError.message, userId });
      throw new AppError('Failed to create meeting record', 500);
    }

    logger.info('Meeting record created', { meetingId: meeting.id, userId, platform });

    // Create and deploy bot
    try {
      const bot = await recallService.createBot(meetingUrl, {
        botName: 'ScribeAI Notetaker',
        joinAt: scheduledStart,
      });

      // Create bot run record
      const { data: botRun, error: botError } = await supabaseAdmin
        .from('bot_runs')
        .insert({
          meeting_id: meeting.id,
          recall_bot_id: bot.id,
          status: 'joining',
        })
        .select()
        .single();

      if (botError) {
        logger.error('Failed to create bot run record', { error: botError.message });
      }

      // Update meeting status, unless a status event for this bot already moved it on
      await supabaseAdmin
        .from('meetings')
        .update({ status: 'bot_joining' })
        .eq('id', meeting.id)
        .eq('status', 'pending');

      logger.info('Bot deployed successfully', {
        meetingId: meeting.id,
        botId: bot.id,
        botRunId: botRun?.id,
      });

      return {
        meeting: { ...meeting, status: 'bot_joining' },
        botRun,
        recallBotId: bot.id,
      };
    } catch (error) {
      // Update meeting to failed
      await supabaseAdmin
        .from('meetings')
        .update({
          status: 'failed',
          error_message: error.message,
        })
        .eq('id', meeting.id);

      logger.error('Failed to deploy meeting bot', {
        meetingId: meeting.id,
        error: error.message,
      });

      throw new AppError(`Failed to deploy meeting bot: ${error.message}`, 500);
    }
  }

  /**
   * Get meeting status with bot details
   * @param {string} userId - User ID
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<Object>} - Meeting with status
   */
  async getMeetingStatus(userId, meetingId) {
    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .select(
        `
        *,
        bot_runs (*),
        meeting_recordings (*)
      `
      )
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (error || !meeting) {
      throw new AppError('Meeting not found', 404);
    }

    // If bot is active, optionally get latest status from Recall
    const activeBotRun = meeting.bot_runs?.find((br) => needsReconcile(meeting, br));

    if (activeBotRun?.recall_bot_id) {
      try {
        const recallStatus = await recallService.getBotStatus(activeBotRun.recall_bot_id);
        meeting.recallStatus = recallStatus;
        await this.reconcileFromRecall(activeBotRun.recall_bot_id, recallStatus);
      } catch (e) {
        logger.warn('Failed to get Recall bot status', {
          botId: activeBotRun.recall_bot_id,
          error: e.message,
        });
      }
    }

    // Re-fetch the meeting if we may have just updated its status, so the
    // response reflects the latest state to the client.
    if (activeBotRun?.recall_bot_id) {
      const { data: fresh } = await supabaseAdmin
        .from('meetings')
        .select(`*, bot_runs (*), meeting_recordings (*)`)
        .eq('id', meetingId)
        .eq('user_id', userId)
        .single();
      if (fresh) {
        fresh.recallStatus = meeting.recallStatus;
        return fresh;
      }
    }

    return meeting;
  }

  /**
   * Bring DB state in sync with Recall.ai's current view of a bot.
   *
   * Recall.ai webhooks are configured at the account level via the dashboard.
   * If they're missing or pointing at a stale URL, status updates never reach
   * us and the meeting gets stuck in `bot_joining` even though the bot has
   * already joined and is recording. We fix that by treating any polled status
   * read as a synthetic webhook event and running it through the same handler.
   *
   * Idempotent — if a real webhook beats us to it, the rows already match and
   * the update is a no-op write.
   *
   * @param {string} botId - Recall bot id
   * @param {Object} recallStatus - Full bot detail from Recall.ai API
   */
  async reconcileFromRecall(botId, recallStatus) {
    try {
      const { change } = summarizeBot(recallStatus);
      if (!change) return;

      await this.handleBotStatusWebhook({
        event: `bot.${change.code}`,
        data: {
          bot: { id: botId },
          data: { code: change.code, created_at: change.created_at, sub_code: change.sub_code },
        },
      });
    } catch (e) {
      logger.warn('reconcileFromRecall failed', { botId, error: e.message });
    }
  }

  /**
   * Get all meetings for a user
   * @param {string} userId - User ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Meetings with pagination
   */
  async getMeetings(userId, options = {}) {
    const { page = 1, limit = 20, status } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('meetings')
      .select('*, bot_runs(*)', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Failed to fetch meetings', { error: error.message, userId });
      throw new AppError('Failed to fetch meetings', 500);
    }

    // Self-heal stuck meetings: for any meeting still in an active bot state,
    // reconcile against Recall.ai. iOS polls this endpoint every 5s while a
    // bot is active, so this is the path that drives status updates when the
    // Recall webhook isn't firing.
    const meetings = data || [];
    const reconcileTargets = [];
    for (const m of meetings) {
      const active = m.bot_runs?.find((br) => needsReconcile(m, br));
      if (active) reconcileTargets.push(active.recall_bot_id);
    }
    if (reconcileTargets.length) {
      await Promise.all(
        reconcileTargets.map(async (botId) => {
          try {
            const status = await recallService.getBotStatus(botId);
            await this.reconcileFromRecall(botId, status);
          } catch (e) {
            logger.warn('list reconcile failed', { botId, error: e.message });
          }
        })
      );
      // Re-fetch the page once with the updated statuses applied
      const { data: refreshed } = await query;
      return {
        meetings: refreshed || meetings,
        pagination: {
          page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit),
        },
      };
    }

    return {
      meetings,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
    };
  }

  /**
   * Cancel a meeting / stop bot
   * @param {string} userId - User ID
   * @param {string} meetingId - Meeting ID
   * @returns {Promise<Object>} - Success status
   */
  async cancelMeeting(userId, meetingId) {
    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .select('*, bot_runs(*)')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (error || !meeting) {
      throw new AppError('Meeting not found', 404);
    }

    // Stop any active bots
    for (const botRun of meeting.bot_runs || []) {
      if (botRun.recall_bot_id && ['joining', 'in_call', 'recording'].includes(botRun.status)) {
        try {
          await recallService.stopBot(botRun.recall_bot_id);
          await supabaseAdmin
            .from('bot_runs')
            .update({ status: 'done', leave_time: new Date().toISOString() })
            .eq('id', botRun.id);

          logger.info('Bot stopped', { botRunId: botRun.id, recallBotId: botRun.recall_bot_id });
        } catch (e) {
          logger.error('Failed to stop bot', {
            botId: botRun.recall_bot_id,
            error: e.message,
          });
        }
      }
    }

    // Update meeting status
    await supabaseAdmin.from('meetings').update({ status: 'cancelled' }).eq('id', meetingId);

    logger.info('Meeting cancelled', { meetingId, userId });

    return { success: true };
  }

  /**
   * Handle Recall.ai webhook for bot status updates
   * @param {Object} payload - Webhook payload from Recall.ai
   */
  async handleBotStatusWebhook(payload) {
    // Payload shapes are described in utils/recallStatus.js
    const { botId: bot_id, code: status, subCode, at } = extractStatus(payload);

    logger.info('Processing Recall webhook', {
      botId: bot_id,
      status,
      subCode,
      event: payload.event,
      dataKeys: payload.data ? Object.keys(payload.data) : [],
    });

    if (!bot_id) {
      logger.warn('No bot_id found in webhook payload', { payload: JSON.stringify(payload) });
      return;
    }

    // Find bot run
    const { data: botRun, error } = await supabaseAdmin
      .from('bot_runs')
      .select('*, meetings(*)')
      .eq('recall_bot_id', bot_id)
      .single();

    if (error || !botRun) {
      logger.warn('Bot run not found for webhook', {
        botId: bot_id,
        error: error?.message,
        errorCode: error?.code,
        errorDetails: error?.details,
      });
      return;
    }

    // Only bot status events (and recording.done) move statuses; other artifact events say nothing about the bot.
    const aboutBot = !payload.event || payload.event.startsWith('bot.') || payload.event === 'recording.done';
    const mappedBotStatus = aboutBot ? BOT_STATUS[status] : undefined;

    if (mappedBotStatus) {
      const storedAt = extractStatus(botRun.recall_status || {}).at;
      if (isOutOfOrder({ status: botRun.status, at: storedAt }, mappedBotStatus, at)) {
        logger.info('Ignoring out-of-order bot status', {
          botRunId: botRun.id,
          current: botRun.status,
          incoming: mappedBotStatus,
        });
      } else {
        await this.applyBotStatus(botRun, { payload, status: mappedBotStatus, code: status, subCode, at });
      }
    }

    // Process recording when meeting analysis is complete
    // recording.done or analysis_done events indicate transcript is ready
    if (status === 'done' || status === 'analysis_done' || payload.event === 'recording.done') {
      // Add a small delay to ensure Recall.ai has finished processing
      setTimeout(() => {
        this.processRecordingAsync(botRun.id, bot_id).catch((err) => {
          logger.error('Recording processing failed', {
            botRunId: botRun.id,
            error: err.message,
          });
        });
      }, this.processingDelayMs);
    }
  }

  /**
   * Write one bot status change to the bot run and its meeting. The filters are part of each UPDATE so that two events
   * handled at the same time cannot move a finished bot or a settled meeting backwards.
   */
  async applyBotStatus(botRun, { payload, status, code, subCode, at }) {
    const when = Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
    const botRunUpdate = { status, recall_status: payload };

    if (code === 'in_call_recording' && !botRun.join_time) {
      botRunUpdate.join_time = when;
    }

    if ((code === 'call_ended' || code === 'done') && !botRun.leave_time) {
      botRunUpdate.leave_time = when;
    }

    let reason = null;
    if (status === 'failed') {
      reason = describeFailure(subCode);
      botRunUpdate.error_code = subCode;
      botRunUpdate.error_message = reason;
    }

    let botQuery = supabaseAdmin.from('bot_runs').update(botRunUpdate).eq('id', botRun.id);
    if (status === 'done') botQuery = botQuery.neq('status', 'failed');
    if (!TERMINAL_BOT_STATUSES.includes(status)) botQuery = botQuery.not('status', 'in', '("done","failed")');
    const { error: botError } = await botQuery;
    if (botError) logger.error('Failed to update bot run status', { botRunId: botRun.id, error: botError.message });

    // Update meeting status
    const meetingStatusMap = {
      joining: 'bot_joining',
      in_call: 'in_progress',
      recording: 'recording',
      done: 'processing',
      failed: 'failed',
    };

    const mappedMeetingStatus = meetingStatusMap[status];
    if (mappedMeetingStatus) {
      let meetingQuery = supabaseAdmin
        .from('meetings')
        .update({ status: mappedMeetingStatus, ...(reason && { error_message: reason }) })
        .eq('id', botRun.meeting_id)
        .not('status', 'in', SETTLED_MEETING_STATUSES);
      if (!TERMINAL_BOT_STATUSES.includes(status)) meetingQuery = meetingQuery.neq('status', 'processing');
      const { error: meetingError } = await meetingQuery;
      if (meetingError) logger.error('Failed to update meeting status', { meetingId: botRun.meeting_id, error: meetingError.message });
    }

    logger.info('Bot status updated', {
      botRunId: botRun.id,
      meetingId: botRun.meeting_id,
      oldStatus: botRun.status,
      newStatus: status,
      subCode,
    });
  }

  /** End a meeting that this process has claimed ('transcribing') as failed, with a reason the user can read. */
  async failClaimedMeeting(meetingId, botRunId, message, subCode = null) {
    await supabaseAdmin
      .from('bot_runs')
      .update({ status: 'failed', error_code: subCode, error_message: message })
      .eq('id', botRunId);
    await supabaseAdmin
      .from('meetings')
      .update({ status: 'failed', error_message: message })
      .eq('id', meetingId)
      .eq('status', 'transcribing');
    logger.info('Meeting ended without a recording', { meetingId, botRunId, subCode });
  }

  /**
   * Process recording after meeting ends (runs asynchronously)
   * @param {string} botRunId - Bot run ID
   * @param {string} recallBotId - Recall.ai bot ID
   */
  async processRecordingAsync(botRunId, recallBotId) {
    try {
      // Get bot run with meeting
      const { data: botRun } = await supabaseAdmin
        .from('bot_runs')
        .select('*, meetings(*)')
        .eq('id', botRunId)
        .single();

      if (!botRun) {
        logger.error('Bot run not found for processing', { botRunId });
        return;
      }

      const userId = botRun.meetings.user_id;
      const meetingId = botRun.meeting_id;

      // Atomically claim the meeting for processing by updating status to 'transcribing'
      // Only update if status is NOT already in a terminal or processing state
      // This prevents race conditions when multiple webhooks arrive
      const { data: claimedMeeting, error: claimError } = await supabaseAdmin
        .from('meetings')
        .update({ status: 'transcribing' })
        .eq('id', meetingId)
        .not('status', 'in', SETTLED_MEETING_STATUSES)
        .is('note_id', null)
        .select()
        .single();

      if (claimError || !claimedMeeting) {
        logger.info('Meeting already being processed or completed, skipping', {
          meetingId,
          currentStatus: botRun.meetings.status,
          hasNoteId: !!botRun.meetings.note_id,
        });
        return;
      }

      logger.info('Starting recording processing', { meetingId, botRunId });

      let summary = null;
      try {
        summary = summarizeBot(await recallService.getBotStatus(recallBotId));
      } catch (statusError) {
        logger.warn('Could not read the bot before processing', { meetingId, error: statusError.message });
      }

      // Never admitted, refused permission to record, and so on: there is nothing to fetch.
      if (summary?.terminal && !summary.recorded) {
        await this.failClaimedMeeting(meetingId, botRunId, describeFailure(summary.subCode, MESSAGES.NEVER_RECORDED), summary.subCode);
        return;
      }

      // Get transcript from Recall with retry logic
      let transcript = '';
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const transcriptData = await recallService.getTranscript(recallBotId);
          transcript = this.formatTranscript(transcriptData);
          logger.info('Transcript retrieved', {
            meetingId,
            transcriptLength: transcript.length,
            attempt,
          });
          break; // Success, exit retry loop
        } catch (transcriptError) {
          logger.warn('Failed to get transcript', {
            meetingId,
            error: transcriptError.message,
            attempt,
            maxRetries,
          });
          if (attempt < maxRetries) {
            // Wait before retrying (exponential backoff)
            await new Promise((resolve) => setTimeout(resolve, attempt * this.transcriptRetryMs));
          }
        }
      }

      // Try to get recording info
      let recordingDuration = null;
      let recordingPath = null;

      try {
        const recordingData = await recallService.getRecordingUrl(recallBotId);

        if (recordingData?.download_url) {
          // Download and store recording
          const recordingBuffer = await this.downloadRecording(recordingData.download_url);
          const uploadPath = `meetings/${userId}/${meetingId}/recording.mp4`;

          const supabaseAdmin2 = storageService.getAdminClient();
          const { error: uploadError } = await supabaseAdmin2.storage
            .from(storageService.bucket)
            .upload(uploadPath, recordingBuffer, {
              contentType: 'video/mp4',
              upsert: true,
            });

          if (uploadError) {
            logger.warn('Failed to upload recording', { error: uploadError.message });
          } else {
            recordingPath = uploadPath;
            logger.info('Recording uploaded', { meetingId, path: recordingPath });

            // Create recording record
            await supabaseAdmin.from('meeting_recordings').insert({
              meeting_id: meetingId,
              bot_run_id: botRunId,
              storage_path: recordingPath,
              file_size_bytes: recordingBuffer.length,
              duration_seconds: recordingData.duration_seconds,
              status: 'stored',
            });

            recordingDuration = recordingData.duration_seconds;
          }
        }
      } catch (recordingError) {
        logger.warn('Failed to process recording', {
          meetingId,
          error: recordingError.message,
        });
      }

      // Update bot run with transcript
      await supabaseAdmin
        .from('bot_runs')
        .update({
          recording_path: recordingPath,
          transcript_raw: transcript,
        })
        .eq('id', botRunId);

      // Create note from transcript if we have content
      let noteId = null;
      if (transcript && transcript.length > 50) {
        const note = await noteService.createNote(userId, {
          title: botRun.meetings.title || `Meeting - ${new Date().toLocaleDateString()}`,
          content: transcript,
          source_type: 'meeting',
          metadata: {
            meeting_id: meetingId,
            platform: botRun.meetings.platform,
            duration_seconds: recordingDuration,
            recording_path: recordingPath,
          },
        });

        noteId = note.id;
        logger.info('Note created from meeting', { meetingId, noteId });
      }

      // Nothing the user can open: this is a failure, not a completed meeting.
      if (!noteId && !recordingPath) {
        if (!summary) {
          // Recall could not be read at all. Release the claim so a later pass (meetingSweeper) tries again.
          await supabaseAdmin.from('meetings').update({ status: 'processing' }).eq('id', meetingId).eq('status', 'transcribing');
          return;
        }
        const message = summary.recorded ? MESSAGES.NOTHING_RETRIEVED : describeFailure(summary.subCode, MESSAGES.NEVER_RECORDED);
        await this.failClaimedMeeting(meetingId, botRunId, message, summary.subCode);
        return;
      }

      // Calculate duration from timestamps if not from recording
      let duration = recordingDuration;
      if (!duration && botRun.join_time) {
        const joinTime = new Date(botRun.join_time);
        const leaveTime = botRun.leave_time ? new Date(botRun.leave_time) : new Date();
        duration = Math.round((leaveTime - joinTime) / 1000);
      }

      // Update meeting with note link and completion
      await supabaseAdmin
        .from('meetings')
        .update({
          status: 'completed',
          note_id: noteId,
          duration_seconds: duration,
          actual_end: new Date().toISOString(),
        })
        .eq('id', meetingId);

      logger.info('Meeting processing completed', {
        meetingId,
        noteId,
        duration,
        hasTranscript: transcript.length > 0,
      });
    } catch (error) {
      logger.error('Error processing meeting', {
        botRunId,
        error: error.message,
        stack: error.stack,
      });

      // Update meeting to failed
      const { data: botRun } = await supabaseAdmin
        .from('bot_runs')
        .select('meeting_id')
        .eq('id', botRunId)
        .single();

      if (botRun) {
        await supabaseAdmin
          .from('meetings')
          .update({
            status: 'failed',
            error_message: MESSAGES.PROCESSING_FAILED,
          })
          .eq('id', botRun.meeting_id);
      }
    }
  }

  /**
   * Download recording from URL
   * @param {string} url - Recording URL
   * @returns {Promise<Buffer>} - Recording buffer
   */
  async downloadRecording(url) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 300000, // 5 minutes for large recordings
    });
    return Buffer.from(response.data);
  }

  /**
   * Format transcript from Recall.ai format
   * @param {Object} transcriptData - Raw transcript data
   * @returns {string} - Formatted transcript
   */
  formatTranscript(transcriptData) {
    if (!transcriptData) return '';

    // Handle different transcript formats from Recall
    if (typeof transcriptData === 'string') {
      return transcriptData;
    }

    // If it's an array of utterances
    if (Array.isArray(transcriptData)) {
      return transcriptData
        .map((utterance) => {
          // Speaker can be an object like { id: "...", name: "John" } or a string
          let speaker = utterance.speaker || utterance.participant || 'Speaker';
          if (typeof speaker === 'object') {
            speaker = speaker.name || speaker.id || 'Speaker';
          }
          const text = utterance.text || utterance.words?.map((w) => w.text).join(' ') || '';
          return `${speaker}: ${text}`;
        })
        .join('\n\n');
    }

    // If it has a words array (detailed transcript)
    if (transcriptData.words && Array.isArray(transcriptData.words)) {
      let currentSpeaker = null;
      let currentSpeakerName = null;
      let lines = [];
      let currentLine = '';

      for (const word of transcriptData.words) {
        // Speaker can be an object or string
        let speaker = word.speaker || 'Speaker';
        let speakerName = speaker;
        if (typeof speaker === 'object') {
          speakerName = speaker.name || speaker.id || 'Speaker';
        }

        // Use stringified speaker for comparison
        const speakerKey = typeof speaker === 'object' ? JSON.stringify(speaker) : speaker;
        const currentSpeakerKey = typeof currentSpeaker === 'object' ? JSON.stringify(currentSpeaker) : currentSpeaker;

        if (speakerKey !== currentSpeakerKey) {
          if (currentLine) {
            lines.push(`${currentSpeakerName}: ${currentLine.trim()}`);
          }
          currentSpeaker = speaker;
          currentSpeakerName = speakerName;
          currentLine = word.text + ' ';
        } else {
          currentLine += word.text + ' ';
        }
      }

      if (currentLine) {
        lines.push(`${currentSpeakerName}: ${currentLine.trim()}`);
      }

      return lines.join('\n\n');
    }

    // Fallback: stringify if object
    if (typeof transcriptData === 'object') {
      return JSON.stringify(transcriptData, null, 2);
    }

    return '';
  }

  /**
   * Handle real-time transcription webhook
   * @param {Object} payload - Transcription update payload
   */
  async handleTranscriptionWebhook(payload) {
    // Real-time transcription updates (optional enhancement)
    // For now, just log - could be used for live transcription display
    logger.debug('Real-time transcription update', {
      botId: payload.bot_id,
      words: payload.words?.length || 0,
    });
  }

  /**
   * Delete a meeting and associated data
   * @param {string} userId - User ID
   * @param {string} meetingId - Meeting ID
   */
  async deleteMeeting(userId, meetingId) {
    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('user_id', userId)
      .single();

    if (error || !meeting) {
      throw new AppError('Meeting not found', 404);
    }

    // Cancel any active bots first
    if (['pending', 'bot_joining', 'in_progress', 'recording'].includes(meeting.status)) {
      await this.cancelMeeting(userId, meetingId);
    }

    // Delete meeting (cascade will handle bot_runs and recordings)
    await supabaseAdmin.from('meetings').delete().eq('id', meetingId);

    logger.info('Meeting deleted', { meetingId, userId });

    return { success: true };
  }
}

module.exports = new MeetingService();
