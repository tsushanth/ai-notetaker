const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');
const noteService = require('../services/noteService');

// All routes require authentication
router.use(authenticate);

/**
 * Create a new note
 * POST /api/notes
 */
router.post('/', validate('createNote'), asyncHandler(async (req, res) => {
  // Formatting is now triggered automatically in noteService.createNote()
  const note = await noteService.createNote(req.userId, req.validatedBody);

  res.status(201).json({
    success: true,
    data: note
  });
}));

/**
 * Get all notes for the authenticated user
 * GET /api/notes
 * Query params: page, limit, sort, source_type
 */
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort = 'created_at', source_type } = req.query;
  
  const result = await noteService.getNotes(req.userId, {
    page: parseInt(page),
    limit: parseInt(limit),
    sort,
    source_type
  });
  
  res.json({
    success: true,
    data: result.notes,
    pagination: result.pagination
  });
}));

/**
 * Get a specific note by ID
 * GET /api/notes/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const note = await noteService.getNoteById(req.userId, req.params.id);
  
  if (!note) {
    return res.status(404).json({
      success: false,
      error: 'Note not found'
    });
  }
  
  res.json({
    success: true,
    data: note
  });
}));

/**
 * Update a note
 * PUT /api/notes/:id
 */
router.put('/:id', validate('updateNote'), asyncHandler(async (req, res) => {
  const note = await noteService.updateNote(req.userId, req.params.id, req.validatedBody);
  
  if (!note) {
    return res.status(404).json({
      success: false,
      error: 'Note not found'
    });
  }
  
  res.json({
    success: true,
    data: note
  });
}));

/**
 * Delete a note
 * DELETE /api/notes/:id
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await noteService.deleteNote(req.userId, req.params.id);
  
  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Note not found'
    });
  }
  
  res.json({
    success: true,
    message: 'Note deleted successfully'
  });
}));

/**
 * Search notes
 * GET /api/notes/search
 */
router.get('/search/query', asyncHandler(async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Search query is required'
    });
  }
  
  const notes = await noteService.searchNotes(req.userId, q);
  
  res.json({
    success: true,
    data: notes
  });
}));

module.exports = router;
