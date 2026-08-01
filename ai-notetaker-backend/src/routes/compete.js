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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

  // Generate HTML via Anthropic API
  const typeInstructions = {
    quiz: `Create a timed multiple-choice quiz with ${numQuestions} questions. Each question has 4 options, one correct. Show a timer counting up. Track correct/total answers.`,
    speed_round: `Create a speed round with ${numQuestions} rapid-fire true/false questions. Give 10 seconds per question with a countdown timer. Track speed and accuracy.`,
    memory_game: `Create a memory matching game using ${Math.min(numQuestions, 8)} pairs of key terms and their definitions from the content. Track time to complete and number of attempts.`,
    word_scramble: `Create a word scramble game with ${numQuestions} key terms from the content. Scramble each word, show a hint (the definition), and track how many they unscramble correctly and time taken.`,
    true_false: `Create a true/false challenge with ${numQuestions} statements about the content. Some should be true, some subtly false. Track correct answers and time.`
  };

  const challengePrompt = `You are creating a competitive challenge game that will be shared between friends. It must be fun, engaging, and fair.

## SOURCE MATERIAL
Title: ${note.title || 'Challenge'}
${content.substring(0, 20000)}

## CHALLENGE TYPE
${typeInstructions[challengeType] || typeInstructions.quiz}

## REQUIREMENTS FOR THE HTML PAGE
1. Output a COMPLETE self-contained HTML page with inline CSS and JS
2. Dark theme: background #0a0a0b, text #ffffff, accent #9333ea, cards #111111, correct #22c55e, wrong #ef4444
3. Mobile-first (max-width: 600px, centered)
4. Show a welcome screen with the challenge title and a "Start" button
5. Track: correct answers, total questions, time spent (seconds)
6. At the end show a results screen with score percentage and time
7. The results screen MUST call: window.ScribeCompete.submitScore(correct, total, timeSeconds)
8. Also show a "View Leaderboard" button that calls: window.ScribeCompete.showLeaderboard()
9. Make it visually polished — animations, transitions, progress bar
10. Include a "Share Challenge" button on the results screen that calls: window.ScribeCompete.shareChallenge()
11. Show question number progress (e.g., "3 of 10")

CRITICAL: Your ENTIRE response must be ONLY the HTML page, starting with <!DOCTYPE html> and ending with </html>. No text before or after.`;

  const anthropicResponse = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: challengePrompt }]
  }, {
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    timeout: 120000
  });

  let rawHTML = anthropicResponse.data?.content?.[0]?.text || '';
  if (!rawHTML) throw new AppError('Failed to generate challenge', 500);

  // Clean up HTML
  rawHTML = rawHTML.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const doctypeIdx = rawHTML.indexOf('<!DOCTYPE');
  const htmlTagIdx = rawHTML.indexOf('<html');
  const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlTagIdx;
  if (startIdx > 0) rawHTML = rawHTML.substring(startIdx);
  const endIdx = rawHTML.lastIndexOf('</html>');
  if (endIdx > 0) rawHTML = rawHTML.substring(0, endIdx + 7);

  const html = rawHTML;
  const metadata = { title: note.title, totalQuestions: numQuestions, type: challengeType };
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

  const shareUrl = `${process.env.WEB_APP_URL || 'https://ai-notetaker-backend.fly.dev'}/compete/${shareToken}`;

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
    shareUrl: `${process.env.WEB_APP_URL || 'https://ai-notetaker-backend.fly.dev'}/compete/${c.share_token}`
  }));

  res.json({ success: true, data: challenges });
}));

module.exports = router;
