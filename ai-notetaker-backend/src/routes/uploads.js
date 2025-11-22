const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const pdfService = require('../services/pdfService');
const videoService = require('../services/videoService');
const scanService = require('../services/scanService');

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

router.use(express.json({ limit: '50mb' }));
router.use(express.urlencoded({ limit: '50mb', extended: true }))

// Configure multer specifically for scanned documents (PDF only)
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit for scans
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new AppError('Only PDF files are allowed for scanned documents', 400));
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
  
  // Get user token from request
  const userToken = req.token || req.user?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!userToken) {
    throw new AppError('Authentication token missing', 401);
  }

  // Pass userToken to PDF service
  const result = await pdfService.processPDF(
    req.userId, 
    req.file, 
    title,
    'pdf',
    userToken
  );

  res.status(201).json({
    success: true,
    data: result
  });
}));

/**
 * Process video URL (YouTube transcripts)
 * POST /api/uploads/video-url
 * Body: { url, title }
 */
router.post('/video-url', validate('processVideoUrl'), asyncHandler(async (req, res) => {
  const { url, title } = req.validatedBody;

  // Import the new transcript service
  const youtubeTranscriptService = require('../services/youtubeTranscriptService');

  const result = await youtubeTranscriptService.processVideoUrl(req.userId, url, title);

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
  
  // Get user token
  const userToken = req.token || req.user?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!userToken) {
    throw new AppError('Authentication token missing', 401);
  }

  // Pass userToken to PDF service
  const result = await pdfService.processPDF(
    req.userId, 
    req.file, 
    title, 
    'slideshow',
    userToken
  );

  res.status(201).json({
    success: true,
    data: result
  });
}));

/**
 * Upload and process scanned document
 * POST /api/uploads/scan
 * Multipart form data with:
 * - file: PDF file (required)
 * - extractedText: OCR text from client (required)
 * - title: Custom title (optional)
 */
router.post('/scan', scanUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PDF file provided', 400);
  }

  const { extractedText, title } = req.body;
  
  if (!extractedText) {
    throw new AppError('No extracted text provided', 400);
  }

  // Process the scanned document
  const result = await scanService.processScannedDocument(
    req.userId,
    req.file.buffer,
    req.file.originalname,
    extractedText,
    title
  );

  res.status(201).json({
    success: true,
    message: 'Scanned document processed successfully',
    note: result.note,
    stats: result.stats,
    pdfUrl: result.pdfUrl
  });
}));

/**
 * Get scanned document details and PDF URL
 * GET /api/uploads/scan/:noteId
 */
router.get('/scan/:noteId', asyncHandler(async (req, res) => {
  const { noteId } = req.params;

  const result = await scanService.getDocumentUrl(req.userId, noteId);

  res.status(200).json({
    success: true,
    url: result.url,
    metadata: result.metadata
  });
}));

/**
 * Delete scanned document and associated PDF
 * DELETE /api/uploads/scan/:noteId
 */
router.delete('/scan/:noteId', asyncHandler(async (req, res) => {
  const { noteId } = req.params;

  await scanService.deleteScannedDocument(req.userId, noteId);

  res.status(200).json({
    success: true,
    message: 'Scanned document deleted successfully'
  });
}));

/**
 * Upload multiple scanned pages as batch
 * POST /api/uploads/scan/batch
 * Multipart form data with:
 * - file: Merged PDF file (required)
 * - pages: JSON array of {extractedText, pageNumber}
 * - title: Custom title (optional)
 */
router.post('/scan/batch', scanUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PDF file provided', 400);
  }

  let { pages, title } = req.body;
  
  // Parse pages if it's a string
  if (typeof pages === 'string') {
    try {
      pages = JSON.parse(pages);
    } catch (error) {
      throw new AppError('Invalid pages data format', 400);
    }
  }

  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    throw new AppError('No pages data provided', 400);
  }

  // Combine all page texts
  const combinedText = pages
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map(page => page.extractedText)
    .join('\n\n');

  // Process as single document
  const result = await scanService.processScannedDocument(
    req.userId,
    req.file.buffer,
    req.file.originalname,
    combinedText,
    title
  );

  res.status(201).json({
    success: true,
    message: 'Batch scanned document processed successfully',
    note: result.note,
    stats: result.stats,
    pdfUrl: result.pdfUrl
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