/**
 * TTS Routes
 * Text-to-Speech with voice cloning support
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const ttsService = require('../services/ttsService');

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Multer for file uploads (voice samples)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio file type. Supported: WAV, MP3, M4A'));
    }
  },
});

// =====================================================
// TTS SYNTHESIS
// =====================================================

/**
 * POST /api/tts/synthesize
 * Synthesize text to speech
 */
router.post('/synthesize', authenticate, asyncHandler(async (req, res) => {
  const {
    text,
    voice = 'rachel',
    speed = 1.0,
    cloned_voice_id,
    exaggeration = 0.5,
    provider, // 'listenai', 'openai', or null for auto
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
      clonedVoiceId: cloned_voice_id,
      exaggeration: parseFloat(exaggeration),
      forceProvider: provider,
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
 * GET /api/tts/voices
 * Get available voices
 */
router.get('/voices', authenticate, asyncHandler(async (req, res) => {
  const voices = ttsService.getVoices();

  // Get user's cloned voices
  const clonedVoices = await ttsService.getUserClonedVoices(req.user.id);

  res.json({
    success: true,
    data: {
      builtin: voices,
      cloned: clonedVoices.map(v => ({
        id: v.id,
        name: v.name,
        audio_url: v.audio_url,
        duration: v.duration_seconds,
        created_at: v.created_at,
      })),
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

// =====================================================
// VOICE CLONING
// =====================================================

/**
 * POST /api/tts/cloned-voices
 * Create a cloned voice from audio sample
 */
router.post('/cloned-voices', authenticate, upload.single('audio'), asyncHandler(async (req, res) => {
  const { name } = req.body;
  const audioFile = req.file;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Voice name is required',
    });
  }

  if (!audioFile) {
    return res.status(400).json({
      success: false,
      error: 'Audio file is required',
    });
  }

  // Validate audio duration (estimate from file size, ~16KB/sec for WAV)
  const estimatedDuration = audioFile.size / 16000;

  if (estimatedDuration < 10) {
    return res.status(400).json({
      success: false,
      error: 'Audio sample too short. Please provide at least 10 seconds.',
    });
  }

  if (estimatedDuration > 300) {
    return res.status(400).json({
      success: false,
      error: 'Audio sample too long. Maximum 5 minutes.',
    });
  }

  try {
    const voice = await ttsService.createClonedVoice(
      req.user.id,
      name,
      audioFile.buffer,
      Math.round(estimatedDuration)
    );

    logger.info('Cloned voice created', {
      userId: req.user.id,
      voiceId: voice.id,
      name,
      duration: estimatedDuration,
    });

    res.status(201).json({
      success: true,
      data: {
        id: voice.id,
        name: voice.name,
        audio_url: voice.audio_url,
        duration: voice.duration_seconds,
        status: voice.status,
      },
    });
  } catch (error) {
    logger.error('Failed to create cloned voice', {
      error: error.message,
      userId: req.user.id,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * GET /api/tts/cloned-voices
 * Get user's cloned voices
 */
router.get('/cloned-voices', authenticate, asyncHandler(async (req, res) => {
  const voices = await ttsService.getUserClonedVoices(req.user.id);

  res.json({
    success: true,
    data: voices.map(v => ({
      id: v.id,
      name: v.name,
      audio_url: v.audio_url,
      duration: v.duration_seconds,
      status: v.status,
      created_at: v.created_at,
    })),
  });
}));

/**
 * DELETE /api/tts/cloned-voices/:id
 * Delete a cloned voice
 */
router.delete('/cloned-voices/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    await ttsService.deleteClonedVoice(req.user.id, id);

    logger.info('Cloned voice deleted', {
      userId: req.user.id,
      voiceId: id,
    });

    res.json({
      success: true,
      message: 'Voice deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete cloned voice', {
      error: error.message,
      userId: req.user.id,
      voiceId: id,
    });
    res.status(error.message === 'Voice not found' ? 404 : 500).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/tts/cloned-voices/:id/synthesize
 * Synthesize with a specific cloned voice
 */
router.post('/cloned-voices/:id/synthesize', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { text, speed = 1.0, exaggeration = 0.5 } = req.body;

  if (!text) {
    return res.status(400).json({
      success: false,
      error: 'Text is required',
    });
  }

  try {
    const audioBuffer = await ttsService.synthesize(text, {
      clonedVoiceId: id,
      speed: parseFloat(speed),
      exaggeration: parseFloat(exaggeration),
    });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
    });

    res.send(audioBuffer);
  } catch (error) {
    logger.error('Cloned voice synthesis error', {
      error: error.message,
      userId: req.user.id,
      voiceId: id,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}));

module.exports = router;
