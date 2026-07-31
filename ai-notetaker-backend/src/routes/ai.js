const express = require('express');
const { logger } = require('../utils/logger');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  requireSubscription,
  checkUsageLimits,
  recordUsage,
  requireSubscriptionForPodcast
} = require('../middleware/subscription');
const aiService = require('../services/aiService');

// All routes require authentication
router.use(authenticate);

/**
 * Chat with note content
 * POST /api/ai/chat
 * Body: { note_id, question, conversation_history }
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/chat', checkUsageLimits('chat'), validate('chatWithNote'), asyncHandler(async (req, res) => {
  const { note_id, question, conversation_history, language } = req.validatedBody;

  const response = await aiService.chatWithNote(req.userId, note_id, question, conversation_history, language);

  // Record usage for free tier tracking
  await recordUsage(req.userId, 'chat', { note_id });

  res.json({
    success: true,
    data: response
  });
}));

/**
 * Generate chat suggestions for a note
 * GET /api/ai/suggestions/:note_id?language=spanish
 *
 * PROTECTED: Requires subscription or trial
 */
router.get('/suggestions/:note_id', requireSubscription, asyncHandler(async (req, res) => {
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
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/summary', checkUsageLimits('summary'), validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const summary = await aiService.generateSummary(req.userId, note_id, options);

  // Record usage for free tier tracking
  await recordUsage(req.userId, 'summary', { note_id });

  res.json({
    success: true,
    data: summary
  });
}));

/**
 * Generate quiz questions from note
 * POST /api/ai/quiz
 * Body: { note_id, options: { difficulty, num_questions } }
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/quiz', checkUsageLimits('quiz'), validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const quiz = await aiService.generateQuiz(req.userId, note_id, options);

  // Record usage for free tier tracking
  await recordUsage(req.userId, 'quiz', { note_id });

  res.json({
    success: true,
    data: quiz
  });
}));

/**
 * Generate flashcards from note
 * POST /api/ai/flashcards
 * Body: { note_id, options: { num_cards } }
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/flashcards', checkUsageLimits('flashcards'), validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const flashcards = await aiService.generateFlashcards(req.userId, note_id, options);

  // Record usage for free tier tracking
  await recordUsage(req.userId, 'flashcards', { note_id });

  res.json({
    success: true,
    data: flashcards
  });
}));

/**
 * Generate podcast SCRIPT ONLY (no TTS audio).
 * POST /api/ai/podcast/script
 *
 * Synchronous — returns the Host 1/Host 2 dialogue text. Used by iOS clients
 * that synthesize audio on-device via Kokoro (FluidAudio). Saves backend
 * Cloud Run TTS cost since the device handles synthesis.
 *
 * PROTECTED: Same paywall as /podcast (subscription or trial).
 */
router.post('/podcast/script', requireSubscriptionForPodcast, validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  logger.info('Starting script-only podcast generation', {
    userId: req.userId,
    noteId: note_id,
    subscription: req.subscription?.reason,
  });

  await recordUsage(req.userId, 'podcast', { note_id, mode: 'script_only' });

  try {
    const result = await aiService.generatePodcastScriptOnly(req.userId, note_id, options || {});
    return res.json({
      success: true,
      data: {
        id: result.id,
        note_id: result.note_id,
        script: result.script,
        duration: result.duration,
        style: result.style,
        status: 'ready',
      },
    });
  } catch (error) {
    logger.error('Script-only podcast generation failed', {
      error: error.message,
      userId: req.userId,
      noteId: note_id,
    });
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: 'Failed to generate podcast script' });
  }
}));

/**
 * Generate podcast script and audio (async)
 * POST /api/ai/podcast
 *
 * PROTECTED: Requires active subscription or trial (NO free tier access)
 */
router.post('/podcast', requireSubscriptionForPodcast, validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  logger.info('Starting async podcast generation', {
    userId: req.userId,
    noteId: note_id,
    subscription: req.subscription?.reason
  });

  // Record usage
  await recordUsage(req.userId, 'podcast', { note_id });

  // Create a placeholder record IMMEDIATELY so status polling returns "generating"
  // This prevents the old podcast from being returned while new one is being created
  const { supabaseAdmin } = require('../config/supabase');

  logger.info('Creating podcast placeholder...', { noteId: note_id, userId: req.userId });

  // Use upsert to handle regeneration - updates existing record if one exists
  // Note: ai_content table doesn't have user_id column - ownership is via note relationship
  const placeholderResult = await supabaseAdmin
    .from('ai_content')
    .upsert({
      note_id,
      content_type: 'podcast',
      content: {
        status: 'generating',
        duration: options?.duration || 'medium',
        style: options?.style || 'conversational',
        gender: options?.gender || 'female',
        started_at: new Date().toISOString()
      }
    }, { onConflict: 'note_id,content_type' })
    .select()
    .single();

  if (placeholderResult.error) {
    logger.error('Failed to create podcast placeholder', {
      error: placeholderResult.error.message,
      code: placeholderResult.error.code,
      details: placeholderResult.error.details,
      hint: placeholderResult.error.hint,
      noteId: note_id
    });
    // Return actual error for debugging
    return res.status(500).json({
      success: false,
      error: `Failed to start podcast generation: ${placeholderResult.error.message}`
    });
  }

  const placeholderId = placeholderResult.data?.id;

  if (!placeholderId) {
    logger.error('Placeholder created but no ID returned', { noteId: note_id, result: placeholderResult });
    return res.status(500).json({
      success: false,
      error: 'Failed to create podcast placeholder'
    });
  }

  logger.info('Created podcast placeholder successfully', {
    placeholderId,
    noteId: note_id,
    createdAt: placeholderResult.data?.created_at
  });

  // Return immediately with pending status
  res.json({
    success: true,
    data: {
      note_id,
      id: placeholderId,
      status: 'generating',
      message: 'Podcast generation started. Please wait 60-90 seconds.'
    }
  });

  // Generate in background (don't await)
  aiService.generatePodcastWithPlaceholder(req.userId, note_id, placeholderId, options)
    .then(result => {
      logger.info('Background podcast generation completed', {
        noteId: note_id,
        hasAudio: !!result.audio_url
      });
    })
    .catch(async error => {
      logger.error('Background podcast generation failed', {
        error: error.message,
        noteId: note_id
      });
      // Update placeholder with error status
      if (placeholderId) {
        await supabaseAdmin
          .from('ai_content')
          .update({
            content: {
              status: 'failed',
              error: error.message
            }
          })
          .eq('id', placeholderId);
      }
    });
}));

/**
 * Check podcast generation status
 * GET /api/ai/podcast/status/:note_id
 *
 * PROTECTED: Requires subscription or trial
 */
router.get('/podcast/status/:note_id', asyncHandler(async (req, res) => {
  const { note_id } = req.params;

  logger.info('Checking podcast status', { noteId: note_id, userId: req.userId });

  // Get the most recent podcast for this note
  const content = await aiService.getLatestPodcastForNote(req.userId, note_id);

  if (!content) {
    logger.info('No podcast content found', { noteId: note_id });
    return res.json({
      success: true,
      data: {
        status: 'not_found',
        message: 'No podcast generated yet'
      }
    });
  }

  logger.info('Podcast status check result', {
    noteId: note_id,
    contentId: content.id,
    contentStatus: content.content?.status,
    hasAudioUrl: !!content.content?.audio_url,
    createdAt: content.created_at
  });

  // Check if it's still generating (placeholder record)
  if (content.content.status === 'generating') {
    logger.info('Returning generating status', { noteId: note_id, contentId: content.id });
    return res.json({
      success: true,
      data: {
        status: 'generating',
        id: content.id,
        message: 'Podcast is being generated...'
      }
    });
  }

  // Check if generation failed
  if (content.content.status === 'failed') {
    logger.info('Returning failed status', { noteId: note_id, contentId: content.id });
    return res.json({
      success: true,
      data: {
        status: 'failed',
        id: content.id,
        message: content.content.error || 'Podcast generation failed'
      }
    });
  }

  // Check if it has audio (completed)
  if (content.content.audio_url) {
    logger.info('Returning ready status with audio', { noteId: note_id, contentId: content.id, audioUrl: content.content.audio_url?.substring(0, 50) });
    return res.json({
      success: true,
      data: {
        status: 'ready',
        id: content.id,
        audio_url: content.content.audio_url,
        script: content.content.script,
        duration: content.content.duration,
        style: content.content.style,
        note_id: content.note_id,
        created_at: content.created_at
      }
    });
  }

  // Fallback - still generating (no audio yet, no explicit status)
  logger.info('Returning fallback generating status', { noteId: note_id });
  return res.json({
    success: true,
    data: {
      status: 'generating',
      message: 'Podcast is still being generated'
    }
  });
}));

/**
 * Get audio URL for a podcast
 * GET /api/ai/podcast/:id/audio
 *
 * PROTECTED: Requires subscription or trial
 */
router.get('/podcast/:id/audio', requireSubscription, asyncHandler(async (req, res) => {
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
 * Generate interactive mind map
 * POST /api/ai/mindmap
 * Body: { note_id, options: { includeExploration } }
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/mindmap', checkUsageLimits('mindmap'), validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const mindmap = await aiService.generateMindMap(req.userId, note_id, options);

  // Record usage
  await recordUsage(req.userId, 'mindmap', { note_id });

  res.json({
    success: true,
    data: mindmap
  });
}));

/**
 * Generate visual learning diagram (Mermaid format)
 * POST /api/ai/diagram
 * Body: { note_id, options: { style } }
 *
 * PROTECTED: Requires subscription or trial, with usage limits for free tier
 */
router.post('/diagram', checkUsageLimits('diagram'), validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  const diagram = await aiService.generateDiagram(req.userId, note_id, options);

  // Record usage
  await recordUsage(req.userId, 'diagram', { note_id });

  res.json({
    success: true,
    data: diagram
  });
}));

/**
 * Generate infographic image using DALL-E 3
 * POST /api/ai/infographic
 * Body: { note_id, options: { style: 'modern'|'colorful'|'minimal'|'professional' } }
 *
 * PROTECTED: Requires active subscription (premium feature due to DALL-E cost)
 */
router.post('/infographic', requireSubscriptionForPodcast, validate('generateAIContent'), asyncHandler(async (req, res) => {
  const { note_id, options } = req.validatedBody;

  logger.info('Starting infographic generation', {
    userId: req.userId,
    noteId: note_id,
    style: options?.style || 'modern'
  });

  const infographic = await aiService.generateInfographic(req.userId, note_id, options);

  // Record usage
  await recordUsage(req.userId, 'infographic', { note_id });

  res.json({
    success: true,
    data: infographic
  });
}));

/**
 * Get all AI-generated content for a note
 * GET /api/ai/note/:note_id
 *
 * No subscription check - users can view their previously generated content
 */
router.get('/note/:note_id', asyncHandler(async (req, res) => {
  const content = await aiService.getAIContentForNote(req.userId, req.params.note_id);

  // Prevent caching to ensure fresh content after regeneration
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.json({
    success: true,
    data: content
  });
}));

/**
 * Delete AI-generated content
 * DELETE /api/ai/:content_id
 *
 * No subscription check - users can delete their own content
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
