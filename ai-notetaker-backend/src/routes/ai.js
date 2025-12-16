const express = require('express');
const { logger } = require('../utils/logger');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const aiService = require('../services/aiService');

// All routes require authentication
router.use(authenticate);

/**
 * Chat with note content
 * POST /api/ai/chat
 * Body: { note_id, question, conversation_history }
 */
router.post('/chat', validate('chatWithNote'), asyncHandler(async (req, res) => {
  const { note_id, question, conversation_history, language } = req.validatedBody;

  const response = await aiService.chatWithNote(req.userId, note_id, question, conversation_history, language);

  res.json({
    success: true,
    data: response
  });
}));

/**
 * Generate chat suggestions for a note
 * GET /api/ai/suggestions/:note_id?language=spanish
 */
router.get('/suggestions/:note_id', asyncHandler(async (req, res) => {
  const { note_id } = req.params;
  const { language = 'english' } = req.query;

  const response = await aiService.generateChatSuggestions(req.userId, note_id, language);

  res.json({
    success: true,
    data: response
  });
}));

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
 * Generate podcast script and audio (async)
 * POST /api/ai/podcast
 */
router.post('/podcast', validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  logger.info('Starting async podcast generation', { 
    userId: req.userId, 
    noteId: note_id 
  });

  // Return immediately with pending status
  res.json({
    success: true,
    data: {
      note_id,
      status: 'generating',
      message: 'Podcast generation started. Please wait 60-90 seconds.'
    }
  });

  // Generate in background (don't await)
  aiService.generatePodcast(req.userId, note_id, options)
    .then(result => {
      logger.info('Background podcast generation completed', { 
        noteId: note_id,
        hasAudio: !!result.audio_url 
      });
    })
    .catch(error => {
      logger.error('Background podcast generation failed', { 
        error: error.message,
        noteId: note_id
      });
    });
}));

/**
 * Check podcast generation status
 * GET /api/ai/podcast/status/:note_id
 */
router.get('/podcast/status/:note_id', asyncHandler(async (req, res) => {
  const { note_id } = req.params;

  // Get the most recent podcast for this note
  const content = await aiService.getLatestPodcastForNote(req.userId, note_id);

  if (!content) {
    return res.json({
      success: true,
      data: {
        status: 'not_found',
        message: 'No podcast generated yet'
      }
    });
  }

  // Check if it has audio
  if (content.content.audio_url) {
    return res.json({
      success: true,
      data: {
        status: 'ready',
        id: content.id,
        audio_url: content.content.audio_url,
        script: content.content.script,
        duration: content.content.duration,
        style: content.content.style,
        note_id: content.note_id
      }
    });
  } else {
    return res.json({
      success: true,
      data: {
        status: 'generating',
        message: 'Podcast is still being generated'
      }
    });
  }
}));

/**
 * Get audio URL for a podcast
 * GET /api/ai/podcast/:id/audio
 */
router.get('/podcast/:id/audio', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.userId;

  // Get AI content
  const { supabaseAdmin } = require('../config/supabase');
  const { data, error } = await supabaseAdmin
    .from('ai_content')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ 
      success: false,
      error: 'Podcast not found' 
    });
  }

  const audioUrl = data.content?.audio_url;
  if (!audioUrl) {
    return res.status(404).json({ 
      success: false,
      error: 'Audio not generated yet' 
    });
  }

  // Redirect to audio URL
  res.redirect(audioUrl);
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