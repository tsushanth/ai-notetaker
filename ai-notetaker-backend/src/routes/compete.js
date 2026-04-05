const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const { supabaseAdmin } = require('../config/supabase');
const noteService = require('../services/noteService');
const { logger } = require('../utils/logger');
const axios = require('axios');
const crypto = require('crypto');

const WORKER_URL = process.env.LEARNING_WORKER_URL || 'http://178.156.231.255:3458';
const WORKER_SECRET = process.env.LEARNING_WORKER_SECRET;

// ============================================
// Create a challenge from a note (Premium)
// ============================================
router.post('/:noteId/create', authenticate, asyncHandler(async (req, res) => {
  const status = await getSubscriptionStatus(req.userId);
  if (!status.isSubscribed && !status.isInTrial) {
    return res.status(403).json({ success: false, error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' });
  }

  const { challengeType = 'quiz', numQuestions = 10 } = req.body;
  const noteId = req.params.noteId;

  const note = await noteService.getNoteById(req.userId, noteId);
  if (!note) throw new AppError('Note not found', 404);

  const content = note.formatted_content || note.content || '';

  logger.info('Creating challenge', { userId: req.userId, noteId, challengeType });

  // Generate via worker
  const workerResponse = await axios.post(`${WORKER_URL}/generate-challenge`, {
    content,
    title: note.title,
    challengeType,
    numQuestions,
    noteId
  }, {
    headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
    timeout: 300000
  });

  if (!workerResponse.data?.success) {
    throw new AppError('Failed to generate challenge', 500);
  }

  const { html, metadata } = workerResponse.data.data;
  const shareToken = crypto.randomBytes(8).toString('hex');

  // Store in Supabase
  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .insert({
      creator_user_id: req.userId,
      note_id: noteId,
      title: metadata.title || note.title,
      challenge_type: challengeType,
      content_html: html,
      share_token: shareToken,
      total_questions: metadata.totalQuestions || numQuestions
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to save challenge', { error: error.message });
    throw new AppError('Failed to save challenge', 500);
  }

  const shareUrl = `${process.env.WEB_APP_URL || 'https://ai-notetaker-backend-917362189743.us-central1.run.app'}/compete/${shareToken}`;

  // Creator auto-joins as first participant
  res.json({
    success: true,
    data: {
      challengeId: challenge.id,
      shareToken,
      shareUrl,
      title: challenge.title,
      type: challengeType
    }
  });
}));

// ============================================
// Get challenge + leaderboard (Public)
// ============================================
router.get('/challenge/:shareToken', asyncHandler(async (req, res) => {
  const { shareToken } = req.params;

  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .select('id, title, challenge_type, total_questions, share_token, created_at, is_active')
    .eq('share_token', shareToken)
    .eq('is_active', true)
    .single();

  if (error || !challenge) {
    throw new AppError('Challenge not found', 404);
  }

  // Get leaderboard
  const { data: participants } = await supabaseAdmin
    .from('challenge_participants')
    .select('display_name, score, correct_answers, total_questions, time_spent_seconds, completed_at')
    .eq('challenge_id', challenge.id)
    .order('score', { ascending: false })
    .order('time_spent_seconds', { ascending: true })
    .limit(50);

  res.json({
    success: true,
    data: {
      challenge,
      leaderboard: participants || []
    }
  });
}));

// ============================================
// Get challenge HTML content (Public)
// ============================================
router.get('/challenge/:shareToken/content', asyncHandler(async (req, res) => {
  const { shareToken } = req.params;

  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .select('content_html')
    .eq('share_token', shareToken)
    .eq('is_active', true)
    .single();

  if (error || !challenge) {
    throw new AppError('Challenge not found', 404);
  }

  res.json({ success: true, data: { html: challenge.content_html } });
}));

// ============================================
// Submit score (Public — anyone with link can play)
// ============================================
router.post('/challenge/:shareToken/submit', asyncHandler(async (req, res) => {
  const { shareToken } = req.params;
  const { displayName, correct, total, timeSeconds, userId } = req.body;

  if (!displayName || displayName.trim().length < 1) {
    throw new AppError('Display name is required', 400);
  }

  const { data: challenge, error } = await supabaseAdmin
    .from('challenges')
    .select('id')
    .eq('share_token', shareToken)
    .eq('is_active', true)
    .single();

  if (error || !challenge) {
    throw new AppError('Challenge not found', 404);
  }

  const score = total > 0 ? correct / total : 0;

  const { data: participant, error: insertError } = await supabaseAdmin
    .from('challenge_participants')
    .insert({
      challenge_id: challenge.id,
      user_id: userId || null,
      display_name: displayName.trim().substring(0, 100),
      score,
      correct_answers: correct,
      total_questions: total,
      time_spent_seconds: timeSeconds || 0
    })
    .select()
    .single();

  if (insertError) {
    logger.error('Failed to save score', { error: insertError.message });
    throw new AppError('Failed to save score', 500);
  }

  // Return updated leaderboard
  const { data: leaderboard } = await supabaseAdmin
    .from('challenge_participants')
    .select('display_name, score, correct_answers, total_questions, time_spent_seconds, completed_at')
    .eq('challenge_id', challenge.id)
    .order('score', { ascending: false })
    .order('time_spent_seconds', { ascending: true })
    .limit(50);

  res.json({
    success: true,
    data: {
      rank: (leaderboard || []).findIndex(p => p.display_name === displayName.trim()) + 1,
      leaderboard: leaderboard || []
    }
  });
}));

// ============================================
// Get user's challenges
// ============================================
router.get('/my-challenges', authenticate, asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('challenges')
    .select(`
      id, title, challenge_type, total_questions, share_token, is_active, created_at,
      challenge_participants(count)
    `)
    .eq('creator_user_id', req.userId)
    .order('created_at', { ascending: false });

  const challenges = (data || []).map(c => ({
    ...c,
    participantCount: c.challenge_participants?.[0]?.count || 0,
    shareUrl: `${process.env.WEB_APP_URL || 'https://ai-notetaker-backend-917362189743.us-central1.run.app'}/compete/${c.share_token}`
  }));

  res.json({ success: true, data: challenges });
}));

module.exports = router;
