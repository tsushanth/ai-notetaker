const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const pdfService = require('../services/pdfService');
const videoService = require('../services/videoService');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.presentation'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Invalid file type', 400));
    }
  }
});

// All routes require authentication
router.use(authenticate);

/**
 * Upload and process PDF
 * POST /api/uploads/pdf
 * Multipart form data with 'file' field
 */
router.post('/pdf', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PDF file provided', 400);
  }

  const { title } = req.body;
  
  // ✅ FIX: Get user token from request
  // Your auth middleware should set this
  const userToken = req.token || req.user?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!userToken) {
    throw new AppError('Authentication token missing', 401);
  }

  // ✅ FIX: Pass userToken to PDF service
  const result = await pdfService.processPDF(
    req.userId, 
    req.file, 
    title,
    'pdf',
    userToken  // ← Pass the token for RLS
  );

  res.status(201).json({
    success: true,
    data: result
  });
}));

/**
 * Process video URL (YouTube, etc.)
 * POST /api/uploads/video-url
 * Body: { url, title }
 */
router.post('/video-url', validate('processVideoUrl'), asyncHandler(async (req, res) => {
  const { url, title } = req.validatedBody;

  const result = await videoService.processVideoUrl(req.userId, url, title);

  res.status(201).json({
    success: true,
    data: result
  });
}));

/**
 * Upload and process slideshow (PPT, PPTX)
 * POST /api/uploads/slideshow
 * Multipart form data with 'file' field
 */
router.post('/slideshow', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No slideshow file provided', 400);
  }

  const { title } = req.body;
  
  // ✅ FIX: Get user token
  const userToken = req.token || req.user?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!userToken) {
    throw new AppError('Authentication token missing', 401);
  }

  // ✅ FIX: Pass userToken to PDF service
  const result = await pdfService.processPDF(
    req.userId, 
    req.file, 
    title, 
    'slideshow',
    userToken  // ← Pass the token for RLS
  );

  res.status(201).json({
    success: true,
    data: result
  });
}));

/**
 * Get upload status
 * GET /api/uploads/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
  // This would check the status of an upload/processing job
  // Implementation depends on whether you use async processing
  
  res.json({
    success: true,
    data: {
      id: req.params.id,
      status: 'completed',
      message: 'Upload processing completed'
    }
  });
}));

module.exports = router;