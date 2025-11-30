const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const pdfService = require('../services/pdfService');
const videoService = require('../services/videoService');
const scanService = require('../services/scanService');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client with service role for signed URLs
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// In-memory job status store (use Redis in production for multi-instance)
const jobStatus = new Map();

// Constants for signed URL uploads
const SIGNED_URL_EXPIRY = 60 * 10; // 10 minutes
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint', // ppt
  'application/vnd.oasis.opendocument.presentation', // odp
  'text/plain'
];

// Configure multer for file uploads (kept for backward compatibility)
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
router.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// =============================================================================
// NEW SIGNED URL UPLOAD FLOW (bypasses Cloud Run 32MB limit)
// =============================================================================

/**
 * Step 1: Request a signed upload URL
 * POST /api/uploads/request-upload
 * Body: { fileName, fileSize, mimeType }
 * Returns: { uploadUrl, filePath, jobId }
 */
router.post('/request-upload', asyncHandler(async (req, res) => {
  const { fileName, fileSize, mimeType } = req.body;
  const userId = req.userId;

  // Validate request
  if (!fileName || !fileSize || !mimeType) {
    throw new AppError('Missing required fields: fileName, fileSize, mimeType', 400);
  }

  // Validate file size
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new AppError(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB`, 400);
  }

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new AppError('Invalid file type. Allowed: PDF, DOCX, PPTX, TXT', 400);
  }

  // Generate unique file path
  const fileExt = fileName.split('.').pop() || 'pdf';
  const uniqueFileName = `${uuidv4()}.${fileExt}`;
  const filePath = `uploads/${userId}/${uniqueFileName}`;

  // Generate signed upload URL
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUploadUrl(filePath);

  if (error) {
    logger.error('Failed to create signed URL', { error: error.message, userId });
    throw new AppError('Failed to create upload URL', 500);
  }

  // Create job ID for tracking
  const jobId = uuidv4();
  
  // Initialize job status
  jobStatus.set(jobId, {
    status: 'pending_upload',
    step: 0,
    steps: [
      { name: 'Uploading document', status: 'pending' },
      { name: 'Analyzing content', status: 'pending' },
      { name: 'Summarizing key points', status: 'pending' },
      { name: 'Finalizing your note', status: 'pending' }
    ],
    userId,
    filePath,
    fileName,
    mimeType,
    fileSize,
    createdAt: new Date().toISOString(),
    error: null,
    noteId: null
  });

  logger.info('Signed upload URL created', { userId, jobId, filePath });

  res.status(200).json({
    success: true,
    data: {
      uploadUrl: data.signedUrl,
      filePath,
      jobId,
      expiresIn: SIGNED_URL_EXPIRY
    }
  });
}));

/**
 * Step 2: Confirm upload and start processing
 * POST /api/uploads/process
 * Body: { jobId, title? }
 * Returns: { jobId, status }
 */
router.post('/process', asyncHandler(async (req, res) => {
  const { jobId, title } = req.body;
  const userId = req.userId;

  if (!jobId) {
    throw new AppError('Missing jobId', 400);
  }

  // Get job status
  const job = jobStatus.get(jobId);
  if (!job) {
    throw new AppError('Invalid or expired job ID', 404);
  }

  // Verify ownership
  if (job.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }

  // Check if already processing
  if (job.status !== 'pending_upload') {
    return res.status(200).json({
      success: true,
      data: { jobId, status: job.status }
    });
  }

  // Update job status
  job.status = 'processing';
  job.title = title;
  job.steps[0].status = 'completed';
  job.step = 1;

  // Start async processing (don't await - fire and forget)
  processDocumentAsync(jobId).catch(err => {
    logger.error('Document processing failed', { jobId, error: err.message });
  });

  res.status(200).json({
    success: true,
    data: {
      jobId,
      status: 'processing'
    }
  });
}));

/**
 * Step 3: Check processing status
 * GET /api/uploads/status/:jobId
 * Returns: { status, step, steps, noteId?, error? }
 */
router.get('/status/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const userId = req.userId;

  const job = jobStatus.get(jobId);
  if (!job) {
    throw new AppError('Job not found', 404);
  }

  // Verify ownership
  if (job.userId !== userId) {
    throw new AppError('Unauthorized', 403);
  }

  res.status(200).json({
    success: true,
    data: {
      jobId,
      status: job.status,
      step: job.step,
      steps: job.steps,
      noteId: job.noteId,
      error: job.error
    }
  });
}));

/**
 * Async document processing function
 */
async function processDocumentAsync(jobId) {
  const job = jobStatus.get(jobId);
  if (!job) return;

  try {
    // Step 2: Download and analyze content
    updateJobStep(jobId, 1, 'in_progress');

    // Download file from Supabase
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(job.filePath);

    if (downloadError) {
      throw new AppError('Failed to download file: ' + downloadError.message, 500);
    }

    // Convert to buffer
    const buffer = Buffer.from(await fileData.arrayBuffer());
    
    logger.info('File downloaded from storage', { 
      jobId, 
      size: buffer.length,
      mimeType: job.mimeType 
    });

    // Process using existing pdfService
    updateJobStep(jobId, 1, 'completed');
    updateJobStep(jobId, 2, 'in_progress');

    // Create a file object compatible with existing pdfService
    const fileObject = {
      buffer,
      originalname: job.fileName,
      mimetype: job.mimeType,
      size: buffer.length
    };

    // Get source type
    const sourceType = getSourceType(job.mimeType);

    // Use existing PDF service to process (it handles text extraction)
    const result = await pdfService.processFromBuffer(
      job.userId,
      fileObject,
      job.title || job.fileName.replace(/\.[^/.]+$/, ''),
      sourceType,
      job.filePath // Pass storage path for reference
    );

    updateJobStep(jobId, 2, 'completed');
    updateJobStep(jobId, 3, 'in_progress');

    // Small delay to show final step
    await new Promise(resolve => setTimeout(resolve, 500));

    updateJobStep(jobId, 3, 'completed');

    // Mark job as complete
    job.status = 'completed';
    job.noteId = result.note.id;

    logger.info('Document processed successfully', { 
      jobId, 
      noteId: result.note.id,
      userId: job.userId 
    });

    // Clean up job after 5 minutes
    setTimeout(() => jobStatus.delete(jobId), 5 * 60 * 1000);

  } catch (error) {
    logger.error('Document processing error', { 
      jobId, 
      error: error.message,
      stack: error.stack
    });

    job.status = 'failed';
    job.error = error.message || 'Processing failed';

    // Mark current step as failed
    const currentStep = job.steps.findIndex(s => s.status === 'in_progress');
    if (currentStep >= 0) {
      job.steps[currentStep].status = 'failed';
    }

    // Clean up failed jobs after 10 minutes
    setTimeout(() => jobStatus.delete(jobId), 10 * 60 * 1000);
  }
}

/**
 * Helper: Update job step status
 */
function updateJobStep(jobId, stepIndex, status) {
  const job = jobStatus.get(jobId);
  if (job && job.steps[stepIndex]) {
    job.steps[stepIndex].status = status;
    job.step = stepIndex;
    
    if (status === 'in_progress') {
      logger.info(`Processing step ${stepIndex + 1}: ${job.steps[stepIndex].name}`, { jobId });
    }
  }
}

/**
 * Helper: Get source type from mime type
 */
function getSourceType(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('presentationml') || mimeType.includes('powerpoint')) return 'slideshow';
  if (mimeType === 'text/plain') return 'txt';
  return 'document';
}

// =============================================================================
// EXISTING ROUTES (kept for backward compatibility / smaller files)
// =============================================================================

/**
 * Upload and process PDF (direct upload - subject to Cloud Run 32MB limit)
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
 */
router.post('/scan', scanUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PDF file provided', 400);
  }

  const { extractedText, title } = req.body;
  
  if (!extractedText) {
    throw new AppError('No extracted text provided', 400);
  }

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
 */
router.post('/scan/batch', scanUpload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No PDF file provided', 400);
  }

  let { pages, title } = req.body;
  
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

  const combinedText = pages
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map(page => page.extractedText)
    .join('\n\n');

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
 * Get upload status (legacy endpoint)
 * GET /api/uploads/:id
 */
router.get('/:id', asyncHandler(async (req, res) => {
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