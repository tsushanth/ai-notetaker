const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const exportService = require('../services/exportService');
const { logger } = require('../utils/logger');

/**
 * Middleware: require premium subscription for export
 */
const requireExportAccess = async (req, res, next) => {
  try {
    const userId = req.userId;
    const status = await getSubscriptionStatus(userId);

    if (status.isSubscribed || status.isInTrial) {
      return next();
    }

    logger.info('Export blocked - not premium', { userId });
    return res.status(403).json({
      success: false,
      error: 'Premium subscription required to export notes',
      code: 'PREMIUM_REQUIRED'
    });
  } catch (error) {
    logger.error('Export access check failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to verify subscription' });
  }
};

// ============================================
// Export note as PDF
// ============================================
router.get('/:id/export/pdf', authenticate, requireExportAccess, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const noteId = req.params.id;

  logger.info('PDF export requested', { userId, noteId });

  const { buffer, filename } = await exportService.generatePDF(userId, noteId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

// ============================================
// Export note as DOCX
// ============================================
router.get('/:id/export/docx', authenticate, requireExportAccess, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const noteId = req.params.id;

  logger.info('DOCX export requested', { userId, noteId });

  const { buffer, filename } = await exportService.generateDOCX(userId, noteId);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

module.exports = router;
