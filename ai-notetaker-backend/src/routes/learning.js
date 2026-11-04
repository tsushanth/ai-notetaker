const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { adminSecretMatches: secretsMatch } = require('../middleware/adminSecret');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { hasStandardAccess } = require('../middleware/subscription');
const learningService = require('../services/learningService');
const { logger } = require('../utils/logger');
const { reportFailure } = require('../utils/failureReporter');
const { admitFeature } = require('../middleware/freeTierLimits');

// ============================================
// Start or resume a learning session for a note (Premium)
// ============================================
router.post('/:noteId/start', authenticate, asyncHandler(async (req, res) => {
  if (!(await hasStandardAccess(req.userId))) {
    return res.status(403).json({ success: false, error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' });
  }
  // Daily Learn cap is charged here, when a session is started or resumed. /lesson/:id/submit is deliberately not capped:
  // rejecting it would throw away the learner's answer.
  if (!(await admitFeature('learning', req, res))) return;
  const result = await learningService.startSession(req.userId, req.params.noteId);
  res.json({ success: true, data: result });
}));

// ============================================
// Get session status + current lesson
// ============================================
router.get('/session/:sessionId', authenticate, asyncHandler(async (req, res) => {
  const result = await learningService.getSessionStatus(req.userId, req.params.sessionId);
  res.json({ success: true, data: result });
}));

// ============================================
// Get all user's learning sessions
// ============================================
router.get('/sessions', authenticate, asyncHandler(async (req, res) => {
  const sessions = await learningService.getUserSessions(req.userId);
  res.json({ success: true, data: sessions });
}));

// ============================================
// Submit response to a lesson
// ============================================
router.post('/lesson/:lessonId/submit', authenticate, asyncHandler(async (req, res) => {
  const result = await learningService.submitLessonResponse(
    req.userId,
    req.params.lessonId,
    req.body
  );
  res.json({ success: true, data: result });
}));

// ============================================
// Webhook: Hetzner worker delivers generated lesson
// (No auth middleware — uses shared secret)
// ============================================
router.post('/webhook/lesson-ready', asyncHandler(async (req, res) => {
  const { sessionId, lessonData, secret, error } = req.body;

  if (!sessionId || !secret) {
    throw new AppError('Missing required fields', 400);
  }
  // Authenticate BEFORE acting on anything in the body: the failure branch below used to run for any caller who knew a session id.
  if (!secretsMatch(secret, process.env.LEARNING_WORKER_SECRET)) {
    throw new AppError('Invalid worker secret', 401);
  }

  // Handle generation failure from worker
  if (error || !lessonData) {
    logger.error('Lesson generation failed', { sessionId, error });
    reportFailure('learning_lesson_failed', new Error('Lesson generation failed (worker callback)'), { code: 'WORKER_REPORTED_FAILURE' });
    const { supabaseAdmin } = require('../config/supabase');
    await supabaseAdmin
      .from('learning_sessions')
      .update({ generation_status: 'failed' })
      .eq('id', sessionId);
    return res.json({ success: true, note: 'marked as failed' });
  }

  await learningService.handleGeneratedLesson(sessionId, lessonData, secret);
  res.json({ success: true });
}));

// ============================================
// Webhook: Hetzner worker delivers generated infographic
// ============================================
router.post('/webhook/infographic-ready', asyncHandler(async (req, res) => {
  const { type, noteId, userId, svg, extractedData, style, secret, error: genError } = req.body;

  if (!secretsMatch(secret, process.env.LEARNING_WORKER_SECRET)) {
    throw new AppError('Invalid worker secret', 401);
  }

  if (type === 'infographic_error' || !svg) {
    logger.error('Infographic generation failed', { noteId, error: genError });
    reportFailure('learning_infographic_failed', new Error('Infographic generation failed (worker callback)'), { code: 'WORKER_REPORTED_FAILURE' });
    return res.json({ success: true, note: 'infographic failed' });
  }

  // Store SVG in Supabase
  const { supabaseAdmin } = require('../config/supabase');
  const fileName = `infographics/${userId}/${noteId}/${Date.now()}.svg`;

  const { error: uploadError } = await supabaseAdmin
    .storage
    .from('notetaker-files')
    .upload(fileName, Buffer.from(svg, 'utf-8'), {
      contentType: 'image/svg+xml',
      upsert: true
    });

  if (uploadError) {
    logger.error('Failed to upload infographic SVG', { error: uploadError.message });
    reportFailure('learning_infographic_failed', new Error('Infographic SVG storage upload failed'), { code: 'STORAGE_UPLOAD_FAILED' });
    return res.json({ success: false, error: 'Upload failed' });
  }

  const { data: urlData } = supabaseAdmin
    .storage
    .from('notetaker-files')
    .getPublicUrl(fileName);

  // Save as AI content
  const noteService = require('../services/noteService');
  const aiService = require('../services/aiService');
  await aiService.saveAIContent(noteId, 'infographic', {
    image_url: urlData.publicUrl,
    extracted_data: extractedData || {},
    style: style || 'modern',
    model: 'claude-cli-svg'
  });

  logger.info('Infographic stored from worker callback', { noteId, userId });
  res.json({ success: true });
}));

module.exports = router;
