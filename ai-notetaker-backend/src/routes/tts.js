/**
 * TTS Routes
 * Text-to-Speech using OpenAI TTS
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const ttsService = require('../services/ttsService');
const ttsJobs = require('../services/ttsJobs');
const { TtsError } = require('../utils/ttsError');
const { LOCAL_ONLY_NOTE_IDS, LOCAL_ONLY_CODE } = require('../middleware/localOnlyNote');
const { featureDailyCap } = require('../middleware/freeTierLimits');
const { reportCounted } = require('../utils/failureReporter');

const ttsCap = featureDailyCap('tts');
// Joining a generation that is already running (an app retry) does not spend the daily allowance again.
const capUnlessRunning = (req, res, next) => (
  ttsJobs.isRunning(req.userId, req.body?.note_id, req.body?.voice, req.body?.speed) ? next() : ttsCap(req, res, next)
);

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// =====================================================
// TTS SYNTHESIS
// =====================================================

/**
 * POST /api/tts/synthesize
 * Synthesize text to speech (returns audio directly, not saved)
 */
router.post('/synthesize', authenticate, featureDailyCap('tts'), asyncHandler(async (req, res) => {
  const {
    text,
    voice = 'nova',
    speed = 1.0,
  } = req.body;

  if (!text) {
    return res.status(400).json({
      success: false,
      error: 'Text is required',
    });
  }

  if (text.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Text too long. Maximum 10,000 characters.',
    });
  }

  try {
    const audioBuffer = await ttsService.synthesize(text, {
      voice,
      speed: parseFloat(speed),
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache',
    });

    res.send(audioBuffer);
  } catch (error) {
    logger.error('TTS synthesis error', { error: error.message, userId: req.user.id });
    if (error instanceof TtsError) {
      // 5xx answers are reported by the safety net; a text the user cannot get audio for (4xx) is counted here.
      if (error.statusCode < 500) reportCounted('tts_failed', `Read Aloud failed: ${error.code}`, { code: error.code });
      return res.status(error.statusCode).json({ success: false, code: `TTS_${error.code}`, error: error.userMessage });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to generate audio. Please try again.',
    });
  }
}));

/**
 * POST /api/tts/generate
 * Generate TTS for a note and save to storage
 */
router.post('/generate', authenticate, capUnlessRunning, asyncHandler(async (req, res) => {
  const {
    note_id,
    voice = 'nova',
    speed = 1.0,
  } = req.body;

  if (!note_id) {
    return res.status(400).json({
      success: false,
      error: 'note_id is required',
    });
  }

  try {
    const job = ttsJobs.start(ttsService, req.user.id, note_id, {
      voice,
      speed: parseFloat(speed),
    });
    const outcome = await ttsJobs.wait(job, ttsJobs.waitBudgetMs(req.headers['x-tts-wait-ms']));

    if (!outcome.done) {
      // Not a failure: the job goes on and reports itself if it fails. An app retry joins it and picks up the audio.
      res.locals.failureReported = true;
      res.locals.outcome = 'pending';
      res.set('Retry-After', '30');
      return res.status(503).json({
        success: false,
        code: 'TTS_STILL_GENERATING',
        error: 'The audio is still being generated. Try again in a minute.',
      });
    }

    const { result } = outcome;
    logger.info('TTS generated for note', {
      userId: req.user.id,
      noteId: note_id,
      voice,
      audioUrl: result.audio_url,
    });

    res.json({
      success: true,
      data: {
        audio_url: result.audio_url,
        voice: result.voice,
        speed: result.speed,
        duration_seconds: result.duration_seconds,
      },
    });
  } catch (error) {
    // The job has already logged and reported the failure.
    res.locals.failureReported = true;
    const known = error instanceof TtsError ? error : new TtsError('INTERNAL');
    const localOnly = known.code === 'NOTE_NOT_FOUND' && LOCAL_ONLY_NOTE_IDS.has(String(note_id).toLowerCase());
    res.status(known.statusCode).json({
      success: false,
      code: localOnly ? LOCAL_ONLY_CODE : `TTS_${known.code}`,
      error: localOnly ? 'The sample note is not ready for Read Aloud yet. Try one of your own notes.' : known.userMessage,
    });
  }
}));

/**
 * GET /api/tts/note/:noteId
 * Get saved TTS for a note
 */
router.get('/note/:noteId', authenticate, asyncHandler(async (req, res) => {
  const { noteId } = req.params;

  try {
    const tts = await ttsService.getTTSForNote(req.user.id, noteId);

    if (!tts) {
      return res.json({
        success: true,
        data: null,
      });
    }

    res.json({
      success: true,
      data: {
        audio_url: tts.audio_url,
        voice: tts.voice,
        speed: tts.speed,
        duration_seconds: tts.duration_seconds,
        created_at: tts.created_at,
      },
    });
  } catch (error) {
    logger.error('Error fetching TTS for note', { error: error.message, noteId });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * GET /api/tts/voices
 * Get available voices
 */
router.get('/voices', authenticate, asyncHandler(async (req, res) => {
  const voices = ttsService.getVoices();

  res.json({
    success: true,
    data: {
      voices,
    },
  });
}));

/**
 * GET /api/tts/status
 * Get TTS service status
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await ttsService.getStatus();

  res.json({
    success: true,
    data: status,
  });
}));

module.exports = router;
