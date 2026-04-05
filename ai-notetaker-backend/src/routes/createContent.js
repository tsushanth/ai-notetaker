const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const noteService = require('../services/noteService');
const { logger } = require('../utils/logger');
const axios = require('axios');

const WORKER_URL = process.env.LEARNING_WORKER_URL || 'http://178.156.231.255:3458';
const WORKER_SECRET = process.env.LEARNING_WORKER_SECRET;

// ============================================
// Create custom content from a note (Premium)
// ============================================
router.post('/:noteId', authenticate, asyncHandler(async (req, res) => {
  // Premium gate
  const status = await getSubscriptionStatus(req.userId);
  if (!status.isSubscribed && !status.isInTrial) {
    return res.status(403).json({ success: false, error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' });
  }
  const { prompt } = req.body;
  const noteId = req.params.noteId;

  if (!prompt || prompt.trim().length < 3) {
    throw new AppError('Please describe what you want to create', 400);
  }

  const note = await noteService.getNoteById(req.userId, noteId);
  if (!note) throw new AppError('Note not found', 404);

  const content = note.formatted_content || note.content || '';

  logger.info('Creating custom content', { userId: req.userId, noteId, prompt: prompt.substring(0, 100) });

  try {
    const workerResponse = await axios.post(`${WORKER_URL}/create-content`, {
      content,
      title: note.title,
      userPrompt: prompt,
      noteId
    }, {
      headers: { 'Authorization': `Bearer ${WORKER_SECRET}` },
      timeout: 300000 // 5 min — Claude can take a while
    });

    if (!workerResponse.data?.success || !workerResponse.data?.data?.html) {
      throw new AppError('Content generation returned empty result', 500);
    }

    res.json({
      success: true,
      data: {
        html: workerResponse.data.data.html,
        prompt
      }
    });

  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('Content creation failed', { error: error.message, noteId });
    throw new AppError('Failed to create content. Please try again.', 500);
  }
}));

module.exports = router;
