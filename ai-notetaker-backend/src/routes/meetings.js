/**
 * Meetings Routes
 * API endpoints for meeting bot functionality
 *
 * NOTE: Webhook routes are defined in app.js BEFORE express.json() middleware
 * to allow raw body parsing for signature verification
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSubscriptionForPodcast } = require('../middleware/subscription');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const meetingService = require('../services/meetingService');
const recallService = require('../services/recallService');

// All routes in this file require authentication
router.use(authenticate);

/**
 * Create a new meeting and deploy bot
 * POST /api/meetings
 * Body: { meetingUrl, title?, scheduledStart? }
 */
router.post(
  '/',
  requireSubscriptionForPodcast,
  asyncHandler(async (req, res) => {
    const { meetingUrl, title, scheduledStart } = req.body;

    if (!meetingUrl) {
      throw new AppError('Meeting URL is required', 400);
    }

    const result = await meetingService.createMeeting(req.userId, meetingUrl, {
      title,
      scheduledStart,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  })
);

/**
 * Get all meetings for user
 * GET /api/meetings
 * Query: page, limit, status
 */
router.get(
  '/',
  requireSubscriptionForPodcast,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;

    const result = await meetingService.getMeetings(req.userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
    });

    res.json({
      success: true,
      data: result.meetings,
      pagination: result.pagination,
    });
  })
);

/**
 * Get meeting status
 * GET /api/meetings/:id
 */
router.get(
  '/:id',
  requireSubscriptionForPodcast,
  asyncHandler(async (req, res) => {
    const meeting = await meetingService.getMeetingStatus(req.userId, req.params.id);

    res.json({
      success: true,
      data: meeting,
    });
  })
);

/**
 * Cancel meeting / stop bot
 * POST /api/meetings/:id/cancel
 */
router.post(
  '/:id/cancel',
  requireSubscriptionForPodcast,
  asyncHandler(async (req, res) => {
    await meetingService.cancelMeeting(req.userId, req.params.id);

    res.json({
      success: true,
      message: 'Meeting cancelled',
    });
  })
);

/**
 * Delete a meeting
 * DELETE /api/meetings/:id
 */
router.delete(
  '/:id',
  requireSubscriptionForPodcast,
  asyncHandler(async (req, res) => {
    await meetingService.deleteMeeting(req.userId, req.params.id);

    res.json({
      success: true,
      message: 'Meeting deleted',
    });
  })
);

/**
 * Get supported platforms
 * GET /api/meetings/platforms
 */
router.get(
  '/platforms',
  asyncHandler(async (req, res) => {
    const platforms = recallService.getSupportedPlatforms();

    res.json({
      success: true,
      data: platforms,
    });
  })
);

/**
 * Validate meeting URL
 * POST /api/meetings/validate-url
 * Body: { meetingUrl }
 */
router.post(
  '/validate-url',
  asyncHandler(async (req, res) => {
    const { meetingUrl } = req.body;

    if (!meetingUrl) {
      throw new AppError('Meeting URL is required', 400);
    }

    const isValid = recallService.validateMeetingUrl(meetingUrl);
    const platform = isValid ? recallService.detectPlatform(meetingUrl) : null;

    res.json({
      success: true,
      data: {
        valid: isValid,
        platform,
      },
    });
  })
);

module.exports = router;
