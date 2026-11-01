const { logger } = require('../utils/logger');
const { reportBackendError, reportCounted } = require('../utils/failureReporter');

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true, report = null) {
    super(message);
    // Optional { message, context }: a 4xx that is really a failed user journey (rejected upload). Counted, not per request.
    this.report = report;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log error
  logger.error('Error occurred', {
    message: error.message,
    statusCode: error.statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400);
  }

  // Multer file upload error
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new AppError('File size too large', 400);
    // The user saw a failed upload and nothing else did: tell the owner (counted, not per request).
    reportCounted('upload_rejected', 'Upload rejected: file too large', { reason: 'FILE_TOO_LARGE', route: `${req.baseUrl || ''}${req.route?.path || ''}` });
  } else if (err.name === 'MulterError') {
    reportCounted('upload_rejected', 'Upload rejected: malformed multipart request', { reason: String(err.code || 'MULTER') });
  }

  // Duplicate key error
  if (err.code === 11000) {
    error = new AppError('Duplicate field value entered', 400);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401);
  }

  if (err.report && err.report.message) {
    reportCounted('upload_rejected', err.report.message, err.report.context || {});
  }

  // Only real server failures page us; 4xx is user/validation noise
  reportBackendError(req, err, error.statusCode);

  // Default error response
  res.status(error.statusCode).json({
    success: false,
    error: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  AppError,
  errorHandler,
  asyncHandler
};
