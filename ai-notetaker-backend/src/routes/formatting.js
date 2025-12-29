const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const formattingService = require('../services/formattingService');
const noteService = require('../services/noteService');
const { logger } = require('../utils/logger');

/**
 * Format a specific note
 * POST /api/formatting/notes/:noteId
 */
router.post('/notes/:noteId', authenticate, asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const userId = req.userId;

  // Verify note belongs to user
  const note = await noteService.getNoteById(userId, noteId);
  if (!note) {
    return res.status(404).json({
      success: false,
      error: 'Note not found'
    });
  }

  logger.info('Formatting note', { userId, noteId });

  const result = await formattingService.formatNoteById(noteId);

  if (result.success) {
    res.json({
      success: true,
      data: {
        noteId: result.noteId,
        formattedContent: result.formattedContent
      }
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error
    });
  }
}));

/**
 * Get formatting status for user's notes
 * GET /api/formatting/status
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const stats = await formattingService.getFormattingStats();

  res.json({
    success: true,
    data: stats
  });
}));

/**
 * Batch format unformatted notes (admin/migration endpoint)
 * POST /api/formatting/batch
 * Requires admin secret in header or authenticated user
 */
router.post('/batch', asyncHandler(async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.ADMIN_SECRET || 'scribeai-admin-2025';

  if (adminSecret !== expectedSecret) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - admin secret required'
    });
  }

  const { limit = 10 } = req.body;

  logger.info('Starting batch formatting', { limit });

  const result = await formattingService.formatUnformattedNotes(limit);

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Re-format a note (force refresh)
 * PUT /api/formatting/notes/:noteId
 */
router.put('/notes/:noteId', authenticate, asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const userId = req.userId;

  // Verify note belongs to user
  const note = await noteService.getNoteById(userId, noteId);
  if (!note) {
    return res.status(404).json({
      success: false,
      error: 'Note not found'
    });
  }

  logger.info('Re-formatting note', { userId, noteId });

  const result = await formattingService.formatNoteById(noteId);

  if (result.success) {
    res.json({
      success: true,
      data: {
        noteId: result.noteId,
        formattedContent: result.formattedContent
      }
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error
    });
  }
}));

module.exports = router;
