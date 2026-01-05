/**
 * Creator Network Routes
 * Handles creator registration, promo codes, earnings, and payouts
 */

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { supabaseAdmin } = require('../config/supabase');
const creatorService = require('../services/creatorService');
const payoutService = require('../services/payoutService');
const earningMaturityService = require('../services/earningMaturityService');
const creatorUsageService = require('../services/creatorUsageService');
const creatorActivityService = require('../services/creatorActivityService');
const fraudAnomalyService = require('../services/fraudAnomalyService');

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Middleware to check if user is a creator
const requireCreator = async (req, res, next) => {
  try {
    const creator = await creatorService.getCreatorByUserId(req.user.id);
    if (!creator) {
      return res.status(403).json({
        success: false,
        error: 'You are not registered as a creator',
      });
    }
    if (creator.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: 'Your creator account is not active',
      });
    }
    req.creator = creator;
    next();
  } catch (error) {
    logger.error('Error in requireCreator middleware', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to verify creator status',
    });
  }
};

// =====================================================
// PUBLIC ENDPOINTS
// =====================================================

/**
 * POST /api/creators/register
 * Register as a new creator (auto-approved)
 */
router.post('/register', asyncHandler(async (req, res) => {
  const {
    email,
    name,
    username,
    socialPlatform,
    socialUrl,
    socialFollowers,
  } = req.body;

  // Validation
  if (!email || !name || !username) {
    return res.status(400).json({
      success: false,
      error: 'Email, name, and username are required',
    });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format',
    });
  }

  // Username validation
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({
      success: false,
      error: 'Username must be 3-20 characters, alphanumeric and underscores only',
    });
  }

  try {
    const result = await creatorService.registerCreator({
      email,
      name,
      username,
      socialPlatform,
      socialUrl,
      socialFollowers: socialFollowers ? parseInt(socialFollowers) : null,
    });

    res.status(201).json({
      success: true,
      data: {
        creator: {
          id: result.creator.id,
          email: result.creator.email,
          name: result.creator.name,
          username: result.creator.username,
          status: result.creator.status,
        },
        promoCode: result.promoCode?.code,
      },
      message: 'Welcome to the Scribe AI Creator Program!',
    });
  } catch (error) {
    logger.error('Error registering creator', { error: error.message });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/creators/login
 * Login as creator (send magic link or verify email)
 * For now, creators need to link their Scribe AI account
 *
 * Also registers device/IP fingerprints for fraud detection
 */
router.post('/login', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const { deviceFingerprint } = req.body;

  // Extract IP address from request
  const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress;

  // Check if user is already a creator
  let creator = await creatorService.getCreatorByUserId(userId);

  if (creator) {
    // Register fingerprints for fraud detection
    await creatorService.registerCreatorFingerprints(creator.id, {
      deviceFingerprint,
      ipAddress,
    });

    return res.json({
      success: true,
      data: { creator },
      message: 'Logged in as creator',
    });
  }

  // Check if there's a creator account with this email
  creator = await creatorService.getCreatorByEmail(userEmail);

  if (creator) {
    // Link user account to creator
    await creatorService.linkUserToCreator(creator.id, userId);
    creator = await creatorService.getCreatorById(creator.id);

    // Register fingerprints for fraud detection
    await creatorService.registerCreatorFingerprints(creator.id, {
      deviceFingerprint,
      ipAddress,
    });

    return res.json({
      success: true,
      data: { creator },
      message: 'Your Scribe AI account has been linked to your creator account',
    });
  }

  res.status(404).json({
    success: false,
    error: 'No creator account found. Please register first.',
  });
}));

// =====================================================
// AUTHENTICATED CREATOR ENDPOINTS
// =====================================================

/**
 * GET /api/creators/profile
 * Get creator's own profile
 */
router.get('/profile', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const creator = req.creator;

  res.json({
    success: true,
    data: {
      id: creator.id,
      email: creator.email,
      name: creator.name,
      username: creator.username,
      socialPlatform: creator.social_platform,
      socialUrl: creator.social_url,
      socialFollowers: creator.social_followers,
      status: creator.status,
      hasPremiumAccess: creator.has_premium_access,
      revenueSharePercent: parseFloat(creator.revenue_share_percent),
      minimumPayoutAmount: parseFloat(creator.minimum_payout_amount),
      stripeConnectStatus: creator.stripe_connect_status,
      stripeOnboardingComplete: creator.stripe_onboarding_complete,
      createdAt: creator.created_at,
    },
  });
}));

/**
 * PUT /api/creators/profile
 * Update creator profile
 */
router.put('/profile', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { name, socialPlatform, socialUrl, socialFollowers } = req.body;

  const updates = {};
  if (name) updates.name = name;
  if (socialPlatform) updates.social_platform = socialPlatform;
  if (socialUrl) updates.social_url = socialUrl;
  if (socialFollowers) updates.social_followers = parseInt(socialFollowers);

  const creator = await creatorService.updateCreatorProfile(req.creator.id, updates);

  res.json({
    success: true,
    data: { creator },
    message: 'Profile updated successfully',
  });
}));

/**
 * GET /api/creators/dashboard
 * Get creator dashboard stats
 */
router.get('/dashboard', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const dashboard = await creatorService.getCreatorDashboard(req.creator.id);

  res.json({
    success: true,
    data: dashboard,
  });
}));

// =====================================================
// PROMO CODE MANAGEMENT
// =====================================================

/**
 * GET /api/creators/promo-codes
 * List creator's promo codes
 */
router.get('/promo-codes', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const promoCodes = await creatorService.getCreatorPromoCodes(req.creator.id);

  res.json({
    success: true,
    data: promoCodes.map(code => ({
      id: code.id,
      code: code.code,
      isActive: code.is_active,
      discountType: code.discount_type,
      discountValue: parseFloat(code.discount_value),
      trialExtensionDays: code.trial_extension_days,
      validFrom: code.valid_from,
      validUntil: code.valid_until,
      maxRedemptions: code.max_redemptions,
      currentRedemptions: code.current_redemptions,
      createdAt: code.created_at,
    })),
  });
}));

/**
 * POST /api/creators/promo-codes
 * Create a new promo code
 *
 * IMPORTANT: Discounts are limited to a maximum of 10% on the first month only.
 * This is enforced to prevent creators from offering excessive discounts that
 * would reduce platform revenue. The discount cost is absorbed by the creator
 * (their earnings are calculated on the discounted amount).
 */
router.post('/promo-codes', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const {
    discountType = 'none',
    discountValue = 0,
    trialExtensionDays = 0,
    validUntil,
    maxRedemptions,
  } = req.body;

  // Validate discount - maximum 10% allowed, first month only
  if (discountType === 'percent') {
    if (discountValue < 0 || discountValue > 10) {
      return res.status(400).json({
        success: false,
        error: 'Discount percentage must be between 0 and 10%. Discounts apply to the first month only.',
      });
    }
  }

  // Fixed amount discounts are not allowed - only percentage discounts up to 10%
  if (discountType === 'fixed') {
    return res.status(400).json({
      success: false,
      error: 'Fixed amount discounts are not supported. Please use percentage discount (max 10%).',
    });
  }

  const promoCode = await creatorService.createPromoCode(req.creator.id, {
    discountType,
    discountValue: parseFloat(discountValue),
    trialExtensionDays: parseInt(trialExtensionDays),
    validUntil: validUntil || null,
    maxRedemptions: maxRedemptions ? parseInt(maxRedemptions) : null,
  });

  res.status(201).json({
    success: true,
    data: {
      id: promoCode.id,
      code: promoCode.code,
      discountType: promoCode.discount_type,
      discountValue: parseFloat(promoCode.discount_value),
    },
    message: 'Promo code created successfully',
  });
}));

/**
 * PUT /api/creators/promo-codes/:id
 * Update a promo code
 */
router.put('/promo-codes/:id', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive, discountType, discountValue, validUntil, maxRedemptions } = req.body;

  // Validate discount - maximum 10% allowed
  if (discountType === 'percent' && discountValue !== undefined) {
    if (discountValue < 0 || discountValue > 10) {
      return res.status(400).json({
        success: false,
        error: 'Discount percentage must be between 0 and 10%. Discounts apply to the first month only.',
      });
    }
  }

  // Fixed amount discounts are not allowed
  if (discountType === 'fixed') {
    return res.status(400).json({
      success: false,
      error: 'Fixed amount discounts are not supported. Please use percentage discount (max 10%).',
    });
  }

  // Verify ownership
  const promoCodes = await creatorService.getCreatorPromoCodes(req.creator.id);
  const promoCode = promoCodes.find(c => c.id === id);

  if (!promoCode) {
    return res.status(404).json({
      success: false,
      error: 'Promo code not found',
    });
  }

  const { supabaseAdmin } = require('../config/supabase');

  const updates = {};
  if (isActive !== undefined) updates.is_active = isActive;
  if (discountType) updates.discount_type = discountType;
  if (discountValue !== undefined) updates.discount_value = parseFloat(discountValue);
  if (validUntil !== undefined) updates.valid_until = validUntil;
  if (maxRedemptions !== undefined) updates.max_redemptions = maxRedemptions ? parseInt(maxRedemptions) : null;

  const { data: updated, error } = await supabaseAdmin
    .from('promo_codes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Error updating promo code', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to update promo code',
    });
  }

  res.json({
    success: true,
    data: updated,
    message: 'Promo code updated successfully',
  });
}));

/**
 * DELETE /api/creators/promo-codes/:id
 * Deactivate a promo code (soft delete)
 */
router.delete('/promo-codes/:id', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify ownership
  const promoCodes = await creatorService.getCreatorPromoCodes(req.creator.id);
  const promoCode = promoCodes.find(c => c.id === id);

  if (!promoCode) {
    return res.status(404).json({
      success: false,
      error: 'Promo code not found',
    });
  }

  const { supabaseAdmin } = require('../config/supabase');

  await supabaseAdmin
    .from('promo_codes')
    .update({ is_active: false })
    .eq('id', id);

  res.json({
    success: true,
    message: 'Promo code deactivated',
  });
}));

// =====================================================
// EARNINGS & PAYOUTS
// =====================================================

/**
 * GET /api/creators/earnings
 * List creator's earnings
 */
router.get('/earnings', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const result = await creatorService.getCreatorEarnings(req.creator.id, {
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  res.json({
    success: true,
    data: result.earnings.map(e => ({
      id: e.id,
      transactionType: e.transaction_type,
      grossAmount: parseFloat(e.gross_amount),
      platformFeePercent: parseFloat(e.platform_fee_percent),
      platformFeeAmount: parseFloat(e.platform_fee_amount),
      netRevenue: parseFloat(e.net_revenue),
      revenueSharePercent: parseFloat(e.revenue_share_percent),
      creatorEarning: parseFloat(e.creator_earning),
      currency: e.currency,
      status: e.status,
      createdAt: e.created_at,
    })),
    pagination: {
      total: result.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

/**
 * GET /api/creators/earnings/summary
 * Get earnings summary with maturity status breakdown
 */
router.get('/earnings/summary', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const dashboard = await creatorService.getCreatorDashboard(req.creator.id);

  res.json({
    success: true,
    data: {
      // Legacy fields
      totalEarnings: dashboard.totalEarnings,
      pendingEarnings: dashboard.pendingEarnings,
      thisMonthEarnings: dashboard.thisMonthEarnings,
      totalConversions: dashboard.conversions,
      // New maturity-aware fields
      earnings: dashboard.earnings,
    },
  });
}));

/**
 * GET /api/creators/earnings/maturity
 * Get detailed maturity breakdown for earnings
 */
router.get('/earnings/maturity', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const summary = await earningMaturityService.getCreatorEarningsSummary(req.creator.id);

  res.json({
    success: true,
    data: {
      maturing: {
        count: summary.maturing.count,
        total: summary.maturing.total,
        nextMaturityDate: summary.maturing.nextMaturity,
      },
      approved: {
        count: summary.approved.count,
        total: summary.approved.total,
      },
      paid: {
        count: summary.paid.count,
        total: summary.paid.total,
      },
      clawbacks: {
        count: summary.clawbacks.count,
        total: summary.clawbacks.total,
      },
      availableForPayout: summary.availableForPayout,
      pendingMaturity: summary.pendingMaturity,
      totalEarned: summary.totalEarned,
      totalClawedBack: summary.totalClawedBack,
    },
  });
}));

/**
 * GET /api/creators/commission-caps
 * Get creator's commission cap status for current month
 *
 * RULE 9: Shows creators their cap status including:
 * - Monthly commission cap and how much remains
 * - Current tier and rate
 * - Referral count to next tier
 * - Whether they're in grace period
 */
router.get('/commission-caps', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const capStatus = await creatorService.getCreatorCommissionCapStatus(req.creator.id);

  res.json({
    success: true,
    data: {
      yearMonth: capStatus.yearMonth,
      config: {
        maxMonthlyCommission: capStatus.capConfig.maxMonthlyCommission,
        capMethod: capStatus.capConfig.capMethod,
        isExempt: capStatus.capConfig.isExempt,
        inGracePeriod: capStatus.capConfig.inGracePeriod,
        graceEndDate: capStatus.capConfig.graceEndDate,
      },
      monthlyStats: capStatus.monthlyStats ? {
        totalReferrals: capStatus.monthlyStats.totalReferrals,
        paidReferrals: capStatus.monthlyStats.paidReferrals,
        grossCommission: capStatus.monthlyStats.grossCommission,
        actualCommission: capStatus.monthlyStats.cappedCommission,
        savingsFromCaps: capStatus.monthlyStats.capSavings,
        monthlyCapHit: capStatus.monthlyStats.monthlyCapHit,
        monthlyCapHitAt: capStatus.monthlyStats.monthlyCapHitAt,
      } : null,
      tierStatus: capStatus.tierStatus ? {
        currentTier: capStatus.tierStatus.currentTier,
        currentRate: capStatus.tierStatus.currentRate,
        referralsUntilNextTier: capStatus.tierStatus.referralsUntilNextTier,
        tierBreakdown: {
          tier1: capStatus.tierStatus.tier1Referrals,
          tier2: capStatus.tierStatus.tier2Referrals,
          tier3: capStatus.tierStatus.tier3Referrals,
        },
      } : null,
      capStatus: capStatus.capStatus ? {
        remainingCap: capStatus.capStatus.remainingCap,
        percentUsed: capStatus.capStatus.capPercentUsed,
        isNearCap: capStatus.capStatus.isNearCap,
        isAtCap: capStatus.capStatus.isAtCap,
      } : null,
    },
  });
}));

/**
 * GET /api/creators/payouts
 * List creator's payouts
 */
router.get('/payouts', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const result = await payoutService.getCreatorPayoutHistory(req.creator.id, {
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  res.json({
    success: true,
    data: result.payouts.map(p => ({
      id: p.id,
      amount: parseFloat(p.amount),
      currency: p.currency,
      status: p.status,
      earningsCount: p.earnings_count,
      stripeTransferId: p.stripe_transfer_id,
      initiatedAt: p.initiated_at,
      completedAt: p.completed_at,
      failureReason: p.failure_reason,
      createdAt: p.created_at,
    })),
    pagination: {
      total: result.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

/**
 * GET /api/creators/payouts/estimate
 * Get estimated next payout info
 */
router.get('/payouts/estimate', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const estimate = await payoutService.getNextPayoutEstimate(req.creator.id);

  res.json({
    success: true,
    data: {
      availableNow: estimate.availableNow,
      pendingMaturity: estimate.pendingMaturity,
      totalEarned: estimate.totalEarned,
      minimumPayout: estimate.minimumPayout,
      meetsMinimum: estimate.meetsMinimum,
      stripeReady: estimate.stripeReady,
      nextPayoutDate: estimate.nextPayoutDate,
      nextMaturityDate: estimate.nextMaturityDate,
      estimatedNextPayout: estimate.estimatedNextPayout,
      canRequestPayout: estimate.meetsMinimum && estimate.stripeReady,
    },
  });
}));

/**
 * POST /api/creators/payouts/request
 * Request a manual payout (if eligible)
 */
router.post('/payouts/request', authenticate, requireCreator, asyncHandler(async (req, res) => {
  try {
    const result = await payoutService.requestManualPayout(req.creator.id);

    res.json({
      success: true,
      data: {
        payoutId: result.payoutId,
        amount: result.amount,
      },
      message: 'Payout initiated successfully!',
    });
  } catch (error) {
    logger.error('Error requesting payout', { error: error.message, creatorId: req.creator.id });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

// =====================================================
// USAGE LIMITS & TRACKING
// =====================================================

/**
 * GET /api/creators/usage
 * Get creator's usage dashboard with limits and current usage
 */
router.get('/usage', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const dashboard = await creatorUsageService.getUsageDashboard(req.creator.id);

  res.json({
    success: true,
    data: dashboard,
  });
}));

/**
 * GET /api/creators/usage/history
 * Get detailed usage history
 */
router.get('/usage/history', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, type } = req.query;

  let query = supabaseAdmin
    .from('creator_usage')
    .select('*', { count: 'exact' })
    .eq('creator_id', req.creator.id)
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (type) {
    query = query.eq('usage_type', type);
  }

  const { data: usage, error, count } = await query;

  if (error) {
    logger.error('Error fetching usage history', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch usage history',
    });
  }

  res.json({
    success: true,
    data: usage?.map(u => ({
      id: u.id,
      usageType: u.usage_type,
      tokensUsed: u.tokens_used,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      status: u.status,
      processingTimeMs: u.processing_time_ms,
      createdAt: u.created_at,
    })) || [],
    pagination: {
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

/**
 * GET /api/creators/usage/queued-jobs
 * Get creator's queued jobs
 */
router.get('/usage/queued-jobs', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { data: jobs, error } = await supabaseAdmin
    .from('creator_job_queue')
    .select('*')
    .eq('creator_id', req.creator.id)
    .in('status', ['queued', 'processing'])
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Error fetching queued jobs', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch queued jobs',
    });
  }

  res.json({
    success: true,
    data: jobs?.map(j => ({
      id: j.id,
      jobType: j.job_type,
      status: j.status,
      queuePosition: j.queue_position,
      estimatedTokens: j.estimated_tokens,
      createdAt: j.created_at,
      startedAt: j.started_at,
    })) || [],
  });
}));

/**
 * DELETE /api/creators/usage/queued-jobs/:id
 * Cancel a queued job
 */
router.delete('/usage/queued-jobs/:id', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify ownership
  const { data: job } = await supabaseAdmin
    .from('creator_job_queue')
    .select('*')
    .eq('id', id)
    .eq('creator_id', req.creator.id)
    .single();

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  if (job.status !== 'queued') {
    return res.status(400).json({
      success: false,
      error: 'Only queued jobs can be cancelled',
    });
  }

  await creatorUsageService.updateJobStatus(id, 'cancelled');

  res.json({
    success: true,
    message: 'Job cancelled successfully',
  });
}));

// =====================================================
// ACTIVITY TRACKING
// =====================================================

/**
 * GET /api/creators/activity
 * Get creator's activity dashboard with requirements and progress
 */
router.get('/activity', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const dashboard = await creatorActivityService.getActivityDashboard(req.creator.id);

  res.json({
    success: true,
    data: dashboard,
  });
}));

/**
 * GET /api/creators/activity/history
 * Get creator's activity event history
 */
router.get('/activity/history', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  const { data: events, error, count } = await supabaseAdmin
    .from('creator_activity_history')
    .select('*', { count: 'exact' })
    .eq('creator_id', req.creator.id)
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (error) {
    logger.error('Error fetching activity history', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch activity history',
    });
  }

  res.json({
    success: true,
    data: events?.map(e => ({
      id: e.id,
      eventType: e.event_type,
      details: e.details,
      paidReferralsCount: e.paid_referrals_count,
      contentSubmissionsCount: e.content_submissions_count,
      totalSignupsCount: e.total_signups_count,
      createdAt: e.created_at,
    })) || [],
    pagination: {
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

/**
 * GET /api/creators/content
 * Get creator's content submissions
 */
router.get('/content', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0 } = req.query;

  const result = await creatorActivityService.getCreatorContentSubmissions(req.creator.id, {
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  res.json({
    success: true,
    data: result.submissions.map(s => ({
      id: s.id,
      contentType: s.content_type,
      contentUrl: s.content_url,
      title: s.title,
      description: s.description,
      platform: s.platform,
      isVerified: s.is_verified,
      verifiedAt: s.verified_at,
      createdAt: s.created_at,
    })),
    pagination: {
      total: result.total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    },
  });
}));

/**
 * POST /api/creators/content
 * Submit content for activity tracking
 *
 * Content types: video, blog, social_post, podcast, other
 * Platforms: youtube, tiktok, instagram, twitter, linkedin, blog, podcast, other
 */
router.post('/content', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { contentType, contentUrl, title, description, platform } = req.body;

  // Validation
  if (!contentType || !contentUrl) {
    return res.status(400).json({
      success: false,
      error: 'Content type and URL are required',
    });
  }

  const validContentTypes = ['video', 'blog', 'social_post', 'podcast', 'other'];
  if (!validContentTypes.includes(contentType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid content type. Must be one of: ${validContentTypes.join(', ')}`,
    });
  }

  // Basic URL validation
  try {
    new URL(contentUrl);
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format',
    });
  }

  try {
    const submission = await creatorActivityService.submitContent(req.creator.id, {
      contentType,
      contentUrl,
      title,
      description,
      platform,
    });

    // Check if this submission brought creator back to active status
    const activityDashboard = await creatorActivityService.getActivityDashboard(req.creator.id);

    res.status(201).json({
      success: true,
      data: {
        id: submission.id,
        contentType: submission.content_type,
        contentUrl: submission.content_url,
        createdAt: submission.created_at,
      },
      activityStatus: activityDashboard.status,
      message: activityDashboard.status.meetsRequirements
        ? 'Content submitted! You now meet the activity requirements.'
        : 'Content submitted successfully!',
    });
  } catch (error) {
    logger.error('Error submitting content', { error: error.message, creatorId: req.creator.id });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * DELETE /api/creators/content/:id
 * Delete a content submission (only if not verified)
 */
router.delete('/content/:id', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify ownership and check if verified
  const { data: submission } = await supabaseAdmin
    .from('creator_content_submissions')
    .select('*')
    .eq('id', id)
    .eq('creator_id', req.creator.id)
    .single();

  if (!submission) {
    return res.status(404).json({
      success: false,
      error: 'Content submission not found',
    });
  }

  if (submission.is_verified) {
    return res.status(400).json({
      success: false,
      error: 'Cannot delete verified content submissions',
    });
  }

  const { error } = await supabaseAdmin
    .from('creator_content_submissions')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error('Error deleting content submission', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete content submission',
    });
  }

  res.json({
    success: true,
    message: 'Content submission deleted',
  });
}));

// =====================================================
// PROMO CODE VALIDATION (PUBLIC/USER)
// =====================================================

/**
 * POST /api/promo-codes/validate
 * Validate a promo code (public endpoint)
 */
router.post('/validate-code', optionalAuth, asyncHandler(async (req, res) => {
  const { code } = req.body;
  // Get userId if authenticated (to check discount eligibility)
  const userId = req.user?.id || null;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Promo code is required',
    });
  }

  const result = await creatorService.validatePromoCode(code, userId);

  if (!result.valid) {
    return res.status(400).json({
      success: false,
      error: result.error,
    });
  }

  res.json({
    success: true,
    data: {
      valid: true,
      code: result.promoCode.code,
      discountType: result.promoCode.discountType,
      discountValue: result.promoCode.discountValue,
      trialExtensionDays: result.promoCode.trialExtensionDays,
      creatorName: result.creator.name,
      // Let client know if discount will be applied (10% off first subscription)
      discountEligible: result.discountEligible,
    },
  });
}));

/**
 * POST /api/promo-codes/apply
 * Apply a promo code to user account
 *
 * Accepts optional fingerprint data for fraud detection:
 * - deviceFingerprint: Unique device identifier
 * - ipAddress: Client IP (can also be extracted from request)
 */
router.post('/apply-code', authenticate, asyncHandler(async (req, res) => {
  const { code, platform = 'web', deviceFingerprint } = req.body;
  const userId = req.user.id;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Promo code is required',
    });
  }

  // Extract IP address from request
  const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress;

  try {
    const result = await creatorService.applyPromoCode(userId, code, platform, {
      deviceFingerprint,
      ipAddress,
    });

    res.json({
      success: true,
      data: {
        redemptionId: result.redemption.id,
        code: result.promoCode.code,
        discountType: result.promoCode.discountType,
        discountValue: result.promoCode.discountValue,
        creatorName: result.creator.name,
        // Indicates if 10% discount was applied (one-time per user)
        discountEligible: result.discountEligible,
      },
      message: result.discountEligible
        ? 'Promo code applied! You\'ll get 10% off your first subscription.'
        : 'Promo code applied! (Discount already used on a previous subscription)',
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * GET /api/promo-codes/current
 * Get user's active promo code
 */
router.get('/current-code', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const redemption = await creatorService.getUserActiveRedemption(userId);

  if (!redemption) {
    return res.json({
      success: true,
      data: null,
    });
  }

  res.json({
    success: true,
    data: {
      code: redemption.code_used,
      discountType: redemption.promo_codes?.discount_type,
      discountValue: redemption.promo_codes?.discount_value ? parseFloat(redemption.promo_codes.discount_value) : 0,
      creatorName: redemption.creators?.name,
      status: redemption.attribution_status,
      appliedAt: redemption.redeemed_at,
      discountEligible: redemption.discount_applied === true, // User gets 10% off if this is true
    },
  });
}));

// =====================================================
// STRIPE CONNECT INTEGRATION
// =====================================================

/**
 * POST /api/creators/stripe/connect
 * Create Stripe Connect account and return onboarding link
 */
router.post('/stripe/connect', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const { supabaseAdmin } = require('../config/supabase');

  const creator = req.creator;

  // Check if already has a Stripe account
  if (creator.stripe_connect_account_id && creator.stripe_connect_status === 'active') {
    return res.json({
      success: true,
      data: {
        status: 'already_connected',
        message: 'Stripe account already connected',
      },
    });
  }

  try {
    let accountId = creator.stripe_connect_account_id;

    // Create Stripe Express account if doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: creator.email,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          creator_id: creator.id,
        },
      });

      accountId = account.id;

      // Save account ID to database
      await supabaseAdmin
        .from('creators')
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_status: 'onboarding',
        })
        .eq('id', creator.id);
    }

    // Create account link for onboarding
    const baseUrl = process.env.WEB_APP_URL || 'https://app.scribeai.online';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/creator/settings?stripe=refresh`,
      return_url: `${baseUrl}/creator/settings?stripe=success`,
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      data: {
        onboardingUrl: accountLink.url,
        accountId,
      },
    });
  } catch (error) {
    logger.error('Error creating Stripe Connect account', { error: error.message, creatorId: creator.id });
    res.status(500).json({
      success: false,
      error: 'Failed to initialize Stripe Connect',
    });
  }
}));

/**
 * GET /api/creators/stripe/status
 * Check Stripe Connect account status
 */
router.get('/stripe/status', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const { supabaseAdmin } = require('../config/supabase');

  const creator = req.creator;

  if (!creator.stripe_connect_account_id) {
    return res.json({
      success: true,
      data: {
        status: 'not_connected',
        canReceivePayouts: false,
      },
    });
  }

  try {
    const account = await stripe.accounts.retrieve(creator.stripe_connect_account_id);

    const canReceivePayouts = account.charges_enabled && account.payouts_enabled;
    let status = 'pending';

    if (canReceivePayouts) {
      status = 'active';
    } else if (account.details_submitted) {
      status = 'restricted';
    } else {
      status = 'onboarding';
    }

    // Update status in database if changed
    if (status !== creator.stripe_connect_status) {
      await supabaseAdmin
        .from('creators')
        .update({
          stripe_connect_status: status,
          stripe_onboarding_complete: account.details_submitted,
        })
        .eq('id', creator.id);
    }

    res.json({
      success: true,
      data: {
        status,
        canReceivePayouts,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      },
    });
  } catch (error) {
    logger.error('Error checking Stripe account status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to check Stripe status',
    });
  }
}));

/**
 * POST /api/creators/stripe/dashboard
 * Get Stripe Express dashboard login link
 */
router.post('/stripe/dashboard', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  const creator = req.creator;

  if (!creator.stripe_connect_account_id) {
    return res.status(400).json({
      success: false,
      error: 'Stripe account not connected',
    });
  }

  try {
    const loginLink = await stripe.accounts.createLoginLink(creator.stripe_connect_account_id);

    res.json({
      success: true,
      data: {
        dashboardUrl: loginLink.url,
      },
    });
  } catch (error) {
    logger.error('Error creating Stripe dashboard link', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create dashboard link',
    });
  }
}));

// =====================================================
// FRAUD ANOMALY DETECTION (Rule 10)
// =====================================================

/**
 * GET /api/creators/fraud-status
 * Get creator's own fraud status (for dashboard display)
 */
router.get('/fraud-status', authenticate, requireCreator, asyncHandler(async (req, res) => {
  const status = await fraudAnomalyService.getCreatorFraudStatus(req.creator.id);

  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Could not retrieve fraud status',
    });
  }

  res.json({
    success: true,
    data: {
      riskScore: status.riskScore,
      commissionFrozen: status.commissionFrozen,
      commissionFrozenReason: status.commissionFrozenReason,
      requiresReview: status.requiresReview,
      activeFlagCount: status.activeFlagCount,
      // Don't expose detailed flag evidence to creators
      flags: status.activeFlags.map(f => ({
        type: f.type,
        severity: f.severity,
        createdAt: f.createdAt,
      })),
    },
  });
}));

// =====================================================
// ADMIN FRAUD REVIEW ENDPOINTS
// These require admin authentication
// =====================================================

/**
 * Middleware to verify admin access
 * In production, implement proper admin role checking
 */
const requireAdmin = async (req, res, next) => {
  // Check if user has admin role
  // This is a simplified check - implement proper RBAC in production
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (!user || user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
  }

  next();
};

/**
 * GET /api/creators/admin/fraud-review
 * Get all creators requiring fraud review
 */
router.get('/admin/fraud-review', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const creators = await fraudAnomalyService.getCreatorsRequiringReview();

  res.json({
    success: true,
    data: {
      count: creators.length,
      creators,
    },
  });
}));

/**
 * GET /api/creators/admin/fraud-status/:creatorId
 * Get detailed fraud status for a specific creator (admin view)
 */
router.get('/admin/fraud-status/:creatorId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { creatorId } = req.params;

  const status = await fraudAnomalyService.getCreatorFraudStatus(creatorId);

  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Creator not found or could not retrieve fraud status',
    });
  }

  res.json({
    success: true,
    data: status, // Full status including evidence for admins
  });
}));

/**
 * POST /api/creators/admin/scan-creator/:creatorId
 * Trigger a fraud scan for a specific creator
 */
router.post('/admin/scan-creator/:creatorId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { creatorId } = req.params;

  const result = await fraudAnomalyService.scanCreatorForAnomalies(creatorId, 'manual');

  res.json({
    success: true,
    data: {
      creatorId: result.creatorId,
      anomaliesFound: result.anomalies.length,
      flagsCreated: result.flags.length,
      anomalies: result.anomalies,
      durationMs: result.duration,
    },
  });
}));

/**
 * POST /api/creators/admin/resolve-flag/:flagId
 * Resolve a fraud flag (confirm, dismiss, or resolve)
 */
router.post('/admin/resolve-flag/:flagId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { flagId } = req.params;
  const {
    status,        // 'confirmed', 'dismissed', or 'resolved'
    notes,
    resolutionNotes,
    unfreezeCommissions = false,
    unsuspendCreator = false,
  } = req.body;

  if (!status || !['confirmed', 'dismissed', 'resolved'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: 'Valid status is required (confirmed, dismissed, or resolved)',
    });
  }

  try {
    await fraudAnomalyService.resolveFraudFlag(flagId, {
      status,
      reviewedBy: req.user.email || req.user.id,
      notes,
      resolutionNotes,
      unfreezeCommissions,
      unsuspendCreator,
    });

    res.json({
      success: true,
      message: `Flag ${status} successfully`,
    });
  } catch (error) {
    logger.error('Error resolving fraud flag', { flagId, error: error.message });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/creators/admin/freeze-commissions/:creatorId
 * Manually freeze a creator's commissions
 */
router.post('/admin/freeze-commissions/:creatorId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { creatorId } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({
      success: false,
      error: 'Reason is required',
    });
  }

  try {
    await fraudAnomalyService.freezeCreatorCommissions(
      creatorId,
      reason,
      req.user.email || req.user.id
    );

    res.json({
      success: true,
      message: 'Commissions frozen successfully',
    });
  } catch (error) {
    logger.error('Error freezing commissions', { creatorId, error: error.message });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

/**
 * POST /api/creators/admin/unfreeze-commissions/:creatorId
 * Manually unfreeze a creator's commissions
 */
router.post('/admin/unfreeze-commissions/:creatorId', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { creatorId } = req.params;
  const { reason } = req.body;

  if (!reason) {
    return res.status(400).json({
      success: false,
      error: 'Reason is required',
    });
  }

  try {
    await fraudAnomalyService.unfreezeCreatorCommissions(
      creatorId,
      reason,
      req.user.email || req.user.id
    );

    res.json({
      success: true,
      message: 'Commissions unfrozen successfully',
    });
  } catch (error) {
    logger.error('Error unfreezing commissions', { creatorId, error: error.message });
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}));

// =====================================================
// CRON ENDPOINTS (protected by CRON_SECRET_TOKEN)
// =====================================================

const CRON_SECRET = process.env.CRON_SECRET_TOKEN;

// Middleware to verify cron requests
const verifyCronAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);
  if (token !== CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Invalid cron token' });
  }

  next();
};

// Cron: Mature earnings after 45-day holding period
router.post('/cron/mature-earnings', verifyCronAuth, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/supabase');

  // Find earnings older than 45 days that are still pending/maturing
  const maturityDate = new Date();
  maturityDate.setDate(maturityDate.getDate() - 45);

  const { data: earnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .update({ status: 'approved' })
    .in('status', ['pending', 'maturing'])
    .lt('created_at', maturityDate.toISOString())
    .select();

  if (error) {
    logger.error('Error maturing earnings', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }

  logger.info('Matured earnings', { count: earnings?.length || 0 });
  res.json({
    success: true,
    message: `Matured ${earnings?.length || 0} earnings records`,
    maturedCount: earnings?.length || 0,
  });
}));

// Cron: Process monthly payouts
router.post('/cron/process-payouts', verifyCronAuth, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/supabase');
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  // Find creators with approved earnings >= $50 and Stripe connected
  const { data: creators, error: creatorsError } = await supabaseAdmin
    .from('creators')
    .select('id, email, name, stripe_connect_account_id, minimum_payout_amount')
    .eq('stripe_onboarding_complete', true)
    .eq('status', 'active');

  if (creatorsError) {
    logger.error('Error fetching creators for payout', { error: creatorsError.message });
    return res.status(500).json({ success: false, error: creatorsError.message });
  }

  const results = { processed: 0, skipped: 0, failed: 0, errors: [] };

  for (const creator of creators || []) {
    try {
      // Get approved earnings not yet paid
      const { data: earnings } = await supabaseAdmin
        .from('creator_earnings')
        .select('id, creator_earning')
        .eq('creator_id', creator.id)
        .eq('status', 'approved')
        .is('payout_id', null);

      const totalEarnings = (earnings || []).reduce((sum, e) => sum + parseFloat(e.creator_earning), 0);
      const minPayout = parseFloat(creator.minimum_payout_amount) || 50;

      if (totalEarnings < minPayout) {
        results.skipped++;
        continue;
      }

      // Create Stripe transfer
      const transfer = await stripe.transfers.create({
        amount: Math.round(totalEarnings * 100), // cents
        currency: 'usd',
        destination: creator.stripe_connect_account_id,
        description: `Scribe AI Creator Payout - ${new Date().toISOString().slice(0, 7)}`,
      });

      // Create payout record
      const { data: payout } = await supabaseAdmin
        .from('creator_payouts')
        .insert({
          creator_id: creator.id,
          amount: totalEarnings,
          currency: 'USD',
          status: 'completed',
          stripe_transfer_id: transfer.id,
          processed_at: new Date().toISOString(),
        })
        .select()
        .single();

      // Update earnings with payout_id
      if (payout) {
        await supabaseAdmin
          .from('creator_earnings')
          .update({ status: 'paid', payout_id: payout.id })
          .in('id', earnings.map(e => e.id));
      }

      results.processed++;
      logger.info('Processed payout', { creatorId: creator.id, amount: totalEarnings });
    } catch (err) {
      results.failed++;
      results.errors.push({ creatorId: creator.id, error: err.message });
      logger.error('Payout failed', { creatorId: creator.id, error: err.message });
    }
  }

  res.json({
    success: true,
    message: `Processed ${results.processed} payouts, skipped ${results.skipped}, failed ${results.failed}`,
    results,
  });
}));

// Cron: Check creator activity and warn/suspend inactive creators
router.post('/cron/check-activity', verifyCronAuth, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/supabase');

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Get active creators
  const { data: creators } = await supabaseAdmin
    .from('creators')
    .select('id, email, name, created_at')
    .eq('status', 'active')
    .lt('created_at', ninetyDaysAgo.toISOString());

  const results = { warned: 0, suspended: 0 };

  for (const creator of creators || []) {
    // Check for activity in last 90 days
    const { data: redemptions } = await supabaseAdmin
      .from('promo_redemptions')
      .select('id')
      .eq('creator_id', creator.id)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .limit(1);

    const { data: earnings } = await supabaseAdmin
      .from('creator_earnings')
      .select('id')
      .eq('creator_id', creator.id)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .limit(1);

    const hasActivity = (redemptions?.length > 0) || (earnings?.length > 0);

    if (!hasActivity) {
      // Check if already warned (in metadata)
      const { data: creatorData } = await supabaseAdmin
        .from('creators')
        .select('metadata')
        .eq('id', creator.id)
        .single();

      const metadata = creatorData?.metadata || {};

      if (metadata.inactivity_warned) {
        // Already warned, suspend
        await supabaseAdmin
          .from('creators')
          .update({
            status: 'inactive',
            has_premium_access: false,
            metadata: { ...metadata, suspended_at: new Date().toISOString() }
          })
          .eq('id', creator.id);
        results.suspended++;
      } else {
        // First warning
        await supabaseAdmin
          .from('creators')
          .update({
            metadata: { ...metadata, inactivity_warned: new Date().toISOString() }
          })
          .eq('id', creator.id);
        results.warned++;
        // TODO: Send warning email
      }
    }
  }

  logger.info('Activity check complete', results);
  res.json({
    success: true,
    message: `Warned ${results.warned} creators, suspended ${results.suspended}`,
    results,
  });
}));

// Cron: Expire attributions older than 30 days without conversion
router.post('/cron/expire-attributions', verifyCronAuth, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/supabase');

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: expired, error } = await supabaseAdmin
    .from('promo_redemptions')
    .update({ attribution_status: 'expired' })
    .eq('attribution_status', 'pending')
    .lt('created_at', thirtyDaysAgo.toISOString())
    .select();

  if (error) {
    logger.error('Error expiring attributions', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }

  logger.info('Expired attributions', { count: expired?.length || 0 });
  res.json({
    success: true,
    message: `Expired ${expired?.length || 0} attributions`,
    expiredCount: expired?.length || 0,
  });
}));

// Cron: Cleanup/deactivate expired promo codes
router.post('/cron/cleanup-expired-codes', verifyCronAuth, asyncHandler(async (req, res) => {
  const { supabaseAdmin } = require('../config/supabase');

  const now = new Date().toISOString();

  const { data: deactivated, error } = await supabaseAdmin
    .from('promo_codes')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('valid_until', now)
    .not('valid_until', 'is', null)
    .select();

  if (error) {
    logger.error('Error cleaning up expired codes', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }

  logger.info('Deactivated expired codes', { count: deactivated?.length || 0 });
  res.json({
    success: true,
    message: `Deactivated ${deactivated?.length || 0} expired promo codes`,
    deactivatedCount: deactivated?.length || 0,
  });
}));

module.exports = router;
