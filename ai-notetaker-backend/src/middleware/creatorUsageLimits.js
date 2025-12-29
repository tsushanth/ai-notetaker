/**
 * Creator Usage Limits Middleware
 * Enforces usage limits for creators on AI generation endpoints
 *
 * This middleware:
 * 1. Checks if user is a creator (has free premium via creator program)
 * 2. If creator, checks usage limits before allowing generation
 * 3. Records usage after generation completes
 * 4. Applies cooldowns for large jobs
 *
 * Normal users are NOT subject to these limits - only creators.
 */

const creatorService = require('../services/creatorService');
const creatorUsageService = require('../services/creatorUsageService');
const { logger } = require('../utils/logger');

// Map API routes to usage types
const ROUTE_TO_USAGE_TYPE = {
  '/api/ai/summary': 'ai_summary',
  '/api/ai/quiz': 'ai_quiz',
  '/api/ai/flashcards': 'ai_flashcards',
  '/api/ai/podcast': 'ai_podcast',
  '/api/ai/diagram': 'ai_diagram',
  '/api/ai/chat': 'ai_chat',
  '/api/recordings/transcribe': 'transcription',
  '/api/uploads/pdf': 'pdf_processing',
  '/api/uploads/video-url': 'video_processing',
};

/**
 * Middleware to check creator usage limits before AI generation
 *
 * Usage:
 * router.post('/summary', authenticate, checkCreatorUsageLimits, asyncHandler(...))
 */
async function checkCreatorUsageLimits(req, res, next) {
  const userId = req.user?.id;

  if (!userId) {
    return next(); // No user, let other middleware handle auth
  }

  try {
    // Check if user is a creator with free premium
    const creator = await creatorService.getCreatorByUserId(userId);

    if (!creator || !creator.has_premium_access) {
      // Not a creator with free premium - no limits apply
      // They're either a regular user or paid subscriber
      return next();
    }

    // User is a creator - check limits
    const usageType = getUsageType(req.path);
    if (!usageType) {
      return next(); // Unknown route, don't apply limits
    }

    // Estimate tokens from request body
    const estimatedTokens = estimateTokensFromRequest(req);

    // Check if allowed
    const limitCheck = await creatorUsageService.checkUsageLimits(
      creator.id,
      usageType,
      estimatedTokens
    );

    if (!limitCheck.allowed) {
      logger.warn('Creator usage limit reached', {
        creatorId: creator.id,
        userId,
        usageType,
        errorCode: limitCheck.errorCode,
        reason: limitCheck.reason,
      });

      return res.status(429).json({
        success: false,
        error: limitCheck.reason,
        errorCode: limitCheck.errorCode,
        limits: {
          limit: limitCheck.limit,
          current: limitCheck.current,
          cooldownExpiresAt: limitCheck.cooldownExpiresAt,
          secondsRemaining: limitCheck.secondsRemaining,
        },
      });
    }

    // If job should be queued, handle it
    if (limitCheck.shouldQueue) {
      try {
        const job = await creatorUsageService.queueJob({
          creatorId: creator.id,
          userId,
          jobType: usageType,
          noteId: req.body.note_id || req.body.noteId,
          requestPayload: req.body,
          estimatedTokens,
        });

        return res.status(202).json({
          success: true,
          queued: true,
          message: 'Your request has been queued due to its size.',
          data: {
            jobId: job.id,
            queuePosition: job.queue_position,
            estimatedWaitMinutes: limitCheck.estimatedWaitMinutes,
          },
        });
      } catch (queueError) {
        logger.error('Error queueing large job', { error: queueError.message });
        return res.status(500).json({
          success: false,
          error: 'Failed to queue job. Please try again.',
        });
      }
    }

    // Attach creator info and usage type to request for post-processing
    req.creatorUsage = {
      creatorId: creator.id,
      usageType,
      estimatedTokens,
      startTime: Date.now(),
    };

    // Continue to the route handler
    next();
  } catch (error) {
    logger.error('Error checking creator usage limits', {
      error: error.message,
      userId,
      path: req.path,
    });
    // Don't block on errors - let the request through
    next();
  }
}

/**
 * Middleware to record usage after successful generation
 * Should be called after the response is sent
 *
 * Usage: Use recordCreatorUsage in your route handler after processing
 */
async function recordCreatorUsage(req, res, tokensUsed = 0, inputTokens = 0, outputTokens = 0) {
  if (!req.creatorUsage) {
    return; // Not a creator or limits not checked
  }

  const { creatorId, usageType, startTime } = req.creatorUsage;
  const processingTimeMs = Date.now() - startTime;

  try {
    await creatorUsageService.recordUsage({
      creatorId,
      userId: req.user?.id,
      usageType,
      tokensUsed,
      inputTokens,
      outputTokens,
      noteId: req.body?.note_id || req.body?.noteId,
      requestSizeBytes: JSON.stringify(req.body).length,
      processingTimeMs,
      status: 'completed',
    });
  } catch (error) {
    logger.error('Error recording creator usage', {
      error: error.message,
      creatorId,
      usageType,
    });
  }
}

/**
 * Helper to record failed usage (for tracking purposes)
 */
async function recordFailedUsage(req, errorMessage) {
  if (!req.creatorUsage) {
    return;
  }

  const { creatorId, usageType, startTime } = req.creatorUsage;
  const processingTimeMs = Date.now() - startTime;

  try {
    await creatorUsageService.recordUsage({
      creatorId,
      userId: req.user?.id,
      usageType,
      tokensUsed: 0,
      noteId: req.body?.note_id || req.body?.noteId,
      requestSizeBytes: JSON.stringify(req.body).length,
      processingTimeMs,
      status: 'failed',
    });
  } catch (error) {
    logger.error('Error recording failed creator usage', {
      error: error.message,
      creatorId,
    });
  }
}

/**
 * Get usage type from request path
 */
function getUsageType(path) {
  // Direct match
  if (ROUTE_TO_USAGE_TYPE[path]) {
    return ROUTE_TO_USAGE_TYPE[path];
  }

  // Check for partial matches (for paths like /api/ai/summary)
  for (const [route, type] of Object.entries(ROUTE_TO_USAGE_TYPE)) {
    if (path.includes(route) || route.includes(path)) {
      return type;
    }
  }

  return null;
}

/**
 * Estimate tokens from request body
 */
function estimateTokensFromRequest(req) {
  let text = '';

  // Collect text from common fields
  if (req.body.content) {
    text += req.body.content;
  }
  if (req.body.transcript) {
    text += req.body.transcript;
  }
  if (req.body.text) {
    text += req.body.text;
  }
  if (req.body.prompt) {
    text += req.body.prompt;
  }
  if (req.body.message) {
    text += req.body.message;
  }
  if (req.body.messages && Array.isArray(req.body.messages)) {
    text += req.body.messages.map((m) => m.content || '').join(' ');
  }

  return creatorUsageService.estimateTokens(text);
}

/**
 * Middleware to add usage dashboard endpoint
 * GET /api/creators/usage
 */
async function getUsageDashboardHandler(req, res) {
  const userId = req.user?.id;

  try {
    const creator = await creatorService.getCreatorByUserId(userId);

    if (!creator) {
      return res.status(404).json({
        success: false,
        error: 'Creator account not found',
      });
    }

    const dashboard = await creatorUsageService.getUsageDashboard(creator.id);

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    logger.error('Error getting usage dashboard', {
      error: error.message,
      userId,
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage data',
    });
  }
}

module.exports = {
  checkCreatorUsageLimits,
  recordCreatorUsage,
  recordFailedUsage,
  getUsageDashboardHandler,
  getUsageType,
  estimateTokensFromRequest,
  ROUTE_TO_USAGE_TYPE,
};
