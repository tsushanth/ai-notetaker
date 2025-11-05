const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const aiService = require('../services/aiService');
const podcastService = require('../services/podcastService');

// All routes require authentication
router.use(authenticate);

/**
 * Generate summary from note
 * POST /api/ai/summary
 * Body: { note_id, options: { length: 'short'|'medium'|'long' } }
 */
router.post('/summary', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const summary = await aiService.generateSummary(req.userId, note_id, options);

  res.json({
    success: true,
    data: summary
  });
}));

/**
 * Generate quiz questions from note
 * POST /api/ai/quiz
 * Body: { note_id, options: { difficulty, num_questions } }
 */
router.post('/quiz', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const quiz = await aiService.generateQuiz(req.userId, note_id, options);

  res.json({
    success: true,
    data: quiz
  });
}));

/**
 * Generate flashcards from note
 * POST /api/ai/flashcards
 * Body: { note_id, options: { num_cards } }
 */
router.post('/flashcards', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const flashcards = await aiService.generateFlashcards(req.userId, note_id, options);

  res.json({
    success: true,
    data: flashcards
  });
}));

/**
 * Generate podcast script from note
 * POST /api/ai/podcast
 * Body: { note_id, options: { style } }
 */
router.post('/podcast', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const podcast = await podcastService.generatePodcastScript(req.userId, note_id, options);

  res.json({
    success: true,
    data: podcast
  });
}));

/**
 * Generate visual learning diagram (Mermaid format)
 * POST /api/ai/diagram
 * Body: { note_id, options: { style } }
 */
router.post('/diagram', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const diagram = await aiService.generateDiagram(req.userId, note_id, options);

  res.json({
    success: true,
    data: diagram
  });
}));

/**
 * Get all AI-generated content for a note
 * GET /api/ai/note/:note_id
 */
router.get('/note/:note_id', asyncHandler(async (req, res) => {
  const content = await aiService.getAIContentForNote(req.userId, req.params.note_id);

  res.json({
    success: true,
    data: content
  });
}));

/**
 * Delete AI-generated content
 * DELETE /api/ai/:content_id
 */
router.delete('/:content_id', asyncHandler(async (req, res) => {
  const deleted = await aiService.deleteAIContent(req.userId, req.params.content_id);

  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'AI content not found'
    });
  }

  res.json({
    success: true,
    message: 'AI content deleted successfully'
  });
}));

module.exports = router;
