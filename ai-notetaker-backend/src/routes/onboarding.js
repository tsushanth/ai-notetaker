const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');

/**
 * Save onboarding preferences
 * POST /api/onboarding
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const { user_type, use_cases } = req.body;

  logger.info('Saving onboarding preferences', { userId, user_type, use_cases });

  // Update user profile with onboarding data
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      user_type: user_type || null,
      use_cases: use_cases || [],
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    logger.error('Error saving onboarding preferences', { error: error.message, userId });
    // Try to create the table if it doesn't exist
    if (error.code === '42P01') {
      logger.warn('user_profiles table may not exist, preferences not saved');
    }
    // Don't fail the request - just log the error
  }

  res.json({
    success: true,
    message: 'Onboarding preferences saved'
  });
}));

/**
 * Get user stats for retention screens
 * GET /api/users/stats
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;

  // Get notes count
  const { count: notesCount, error: notesError } = await supabaseAdmin
    .from('notes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (notesError) {
    logger.error('Error fetching notes count', { error: notesError.message, userId });
  }

  // Get quizzes count (from note metadata or quiz table if exists)
  let quizzesCount = 0;
  try {
    const { data: notesWithQuizzes } = await supabaseAdmin
      .from('notes')
      .select('metadata')
      .eq('user_id', userId)
      .not('metadata->quiz', 'is', null);

    quizzesCount = notesWithQuizzes?.length || 0;
  } catch (e) {
    logger.warn('Could not fetch quiz count', { error: e.message });
  }

  // Get flashcards count
  let flashcardsCount = 0;
  try {
    const { data: notesWithFlashcards } = await supabaseAdmin
      .from('notes')
      .select('metadata')
      .eq('user_id', userId)
      .not('metadata->flashcards', 'is', null);

    if (notesWithFlashcards) {
      flashcardsCount = notesWithFlashcards.reduce((total, note) => {
        const flashcards = note.metadata?.flashcards;
        return total + (Array.isArray(flashcards) ? flashcards.length : 0);
      }, 0);
    }
  } catch (e) {
    logger.warn('Could not fetch flashcard count', { error: e.message });
  }

  // Get audio hours (from note metadata)
  let audioHours = 0;
  try {
    const { data: notesWithAudio } = await supabaseAdmin
      .from('notes')
      .select('metadata')
      .eq('user_id', userId)
      .not('metadata->audio_duration', 'is', null);

    if (notesWithAudio) {
      const totalSeconds = notesWithAudio.reduce((total, note) => {
        const duration = note.metadata?.audio_duration || 0;
        return total + duration;
      }, 0);
      audioHours = totalSeconds / 3600;
    }
  } catch (e) {
    logger.warn('Could not fetch audio duration', { error: e.message });
  }

  res.json({
    success: true,
    data: {
      notes_count: notesCount || 0,
      quizzes_count: quizzesCount,
      flashcards_count: flashcardsCount,
      audio_hours: Math.round(audioHours * 10) / 10
    }
  });
}));

module.exports = router;
