/**
 * TTS Routes
 * Text-to-Speech using OpenAI TTS
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const ttsService = require('../services/ttsService');

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
router.post('/synthesize', authenticate, asyncHandler(async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/tts/generate
 * Generate TTS for a note and save to storage
 */
router.post('/generate', authenticate, asyncHandler(async (req, res) => {
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
    const result = await ttsService.generateForNote(req.user.id, note_id, {
      voice,
      speed: parseFloat(speed),
    });

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
    logger.error('TTS generation error', { error: error.message, userId: req.user.id, noteId: note_id });
    res.status(500).json({
      success: false,
      error: error.message,
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
