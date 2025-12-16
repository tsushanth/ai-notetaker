const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth } = require('../middleware/auth');
const alertService = require('../services/alertService');
const { logger } = require('../utils/logger');

/**
 * Report a user journey error
 * POST /api/alerts/error
 * Body: { flow, error, deviceInfo? }
 */
router.post('/error', optionalAuth, asyncHandler(async (req, res) => {
  const { flow, error, deviceInfo } = req.body;

  if (!flow || !error) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: flow and error'
    });
  }

  // Get user info if authenticated
  const userId = req.userId || null;
  const userEmail = req.user?.email || null;

  logger.warn('User journey error reported', {
    flow,
    error,
    userId,
    deviceInfo
  });

  // Send email alert
  const sent = await alertService.sendErrorAlert({
    userId,
    userEmail,
    flow,
    error,
    deviceInfo,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    alertSent: sent
  });
}));

/**
 * Health check for alert service
 * GET /api/alerts/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'alerts',
    initialized: alertService.initialized
  });
});

module.exports = router;
