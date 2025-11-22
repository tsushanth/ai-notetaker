const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const transcriptionService = require('../services/transcriptionService');
const storageService = require('../services/storageService');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg', 
      'audio/mp3', 
      'audio/wav', 
      'audio/wave', 
      'audio/x-wav', 
      'audio/webm', 
      'audio/ogg', 
      'audio/m4a',
      'audio/mp4', 
      'audio/x-m4a', 
      'audio/aac',
      'audio/x-aac',
      'video/mp4', 
      'video/webm',
      'application/octet-stream' // ✅ Add this as fallback
    ];

    console.log('File mimetype:', file.mimetype);
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Invalid file type. Only audio/video files are allowed', 400));
    }
  }
});

// All routes require authentication
router.use(authenticate);

/**
 * Upload audio recording
 * POST /api/recordings/upload
 * Multipart form data with 'audio' field
 */
router.post('/upload', upload.single('audio'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No audio file provided', 400);
  }

  const { note_id, title } = req.body;

  // Upload to Supabase Storage
  const recording = await storageService.uploadRecording(
    req.userId,
    req.file,
    { note_id, title }
  );

  res.status(201).json({
    success: true,
    data: recording
  });
}));

/**
 * Transcribe audio recording
 * POST /api/recordings/transcribe
 * Body: { recording_id }
 */
router.post('/transcribe', asyncHandler(async (req, res) => {
  const { recording_id } = req.body;

  if (!recording_id) {
    throw new AppError('Recording ID is required', 400);
  }

  // Start transcription (can be async in production)
  const result = await transcriptionService.transcribeRecording(req.userId, recording_id);

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Get recording details
 * GET /api/recordings/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const recording = await transcriptionService.getRecording(req.userId, req.params.id);

  if (!recording) {
    return res.status(404).json({
      success: false,
      error: 'Recording not found'
    });
  }

  res.json({
    success: true,
    data: recording
  });
}));

/**
 * List all recordings for user
 * GET /api/recordings
 */
router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const recordings = await transcriptionService.getRecordings(req.userId, {
    page: parseInt(page),
    limit: parseInt(limit)
  });

  res.json({
    success: true,
    data: recordings
  });
}));

/**
 * Delete a recording
 * DELETE /api/recordings/:id
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await transcriptionService.deleteRecording(req.userId, req.params.id);

  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Recording not found'
    });
  }

  res.json({
    success: true,
    message: 'Recording deleted successfully'
  });
}));

module.exports = router;
