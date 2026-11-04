const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const { legacyLimitsEnabled, freeExceptCostly, PRO_FEATURES } = require('../utils/freeTierPolicy');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Free tier limits
const FREE_TIER_LIMITS = {
  notesPerMonth: 3,           // Free users can create 3 notes per month
  aiGenerationsPerMonth: 5,   // Free users get 5 AI generations (summary, quiz, flashcards) per month
  podcastsPerMonth: 0,        // No podcasts for free tier
  trialDays: 0                // No auto-trial — trial only starts via explicit Apple/Google purchase
};

/**
 * Pro access for the three costly features (meeting bot, podcasts, infographics): the REAL subscription state,
 * never affected by any flag. Pro = active subscription, trial, creator premium, or a cancelled / grace-period
 * subscription that is still inside its paid period (isProStatus). The same rule drives the Pro daily caps. `status` avoids a second lookup.
 */
function isProStatus(s) {
  return !!(s && (s.isSubscribed || s.isInTrial || s.isCreator || s.isPaidThroughPeriod));
}

async function hasPaidAccess(userId, { status } = {}) {
  return isProStatus(status || await getSubscriptionStatus(userId));
}

/**
 * Access to everything that is NOT one of the three Pro features (export, Learn, Create, Compete, integrations, share links...).
 * FREE_EXCEPT_COSTLY (default ON, read on every call): true for everyone, no subscription lookup.
 * FREE_EXCEPT_COSTLY=false: the old rule, subscriber or trial user (creator premium does not count, as in the inline
 * checks this replaced). getSubscriptionStatus is untouched and keeps reporting the real state either way.
 */
async function hasStandardAccess(userId, { status, env = process.env } = {}) {
  if (freeExceptCostly(env)) return true;
  const s = status || await getSubscriptionStatus(userId);
  return !!(s.isSubscribed || s.isInTrial);
}

/**
 * Gate for one of the Pro features (a key of PRO_FEATURES). Free users get the existing paywall response (403
 * SUBSCRIPTION_REQUIRED, details.upgradeRequired true); Pro users continue (to their per-user daily cap).
 * FREE_EXCEPT_COSTLY=false: no gate at all, which is how these three routes behaved before (the old gate was a no-op). The new daily
 * caps and the spend breaker still apply on those routes.
 */
const requireProFeature = (feature) => {
  const label = PRO_FEATURES[feature];
  if (!label) throw new Error(`unknown Pro feature: ${feature}`);
  return async (req, res, next) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
      if (!freeExceptCostly()) return next();

      const status = await getSubscriptionStatus(userId);
      if (await hasPaidAccess(userId, { status })) {
        req.subscription = status;
        return next();
      }
      logger.info('Pro feature blocked - not subscribed', { userId, feature, reason: status.reason });
      return res.status(403).json({
        success: false,
        error: `${label} requires a premium subscription`,
        code: 'SUBSCRIPTION_REQUIRED',
        details: { feature, upgradeRequired: true, reason: status.reason, trialExpired: status.trialExpired }
      });
    } catch (error) {
      logger.error('Pro feature check failed', { error: error.message, userId: req.userId, feature });
      // Fail closed: never hand a costly feature out because the subscription lookup failed.
      return res.status(503).json({
        success: false,
        error: 'Unable to verify subscription status. Please try again.',
        code: 'SUBSCRIPTION_CHECK_FAILED',
        retryable: true
      });
    }
  };
};

/**
 * Middleware to check if user has an active subscription or is in trial
 * Blocks access to premium features if not subscribed (never blocks while FREE_EXCEPT_COSTLY is on)
 */
const requireSubscription = async (req, res, next) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (freeExceptCostly()) return next();

    // Check subscription status
    const subscriptionStatus = await getSubscriptionStatus(userId);

    if (subscriptionStatus.hasAccess) {
      // User has access - attach subscription info to request
      req.subscription = subscriptionStatus;
      return next();
    }

    // No access - return paywall response
    logger.info('Premium access blocked - no subscription', {
      userId,
      reason: subscriptionStatus.reason,
      trialExpired: subscriptionStatus.trialExpired
    });

    return res.status(403).json({
      success: false,
      error: 'Premium subscription required',
      code: 'SUBSCRIPTION_REQUIRED',
      details: {
        reason: subscriptionStatus.reason,
        trialExpired: subscriptionStatus.trialExpired,
        trialDaysRemaining: subscriptionStatus.trialDaysRemaining
      }
    });
  } catch (error) {
    logger.error('Subscription check failed', { error: error.message, userId: req.userId });
    // SECURITY FIX: Fail closed - deny access on errors to prevent abuse
    return res.status(503).json({
      success: false,
      error: 'Unable to verify subscription status. Please try again.',
      code: 'SUBSCRIPTION_CHECK_FAILED',
      retryable: true
    });
  }
};

/**
 * Middleware to check usage limits for free tier users
 * Allows limited access to AI features
 */
const legacyMonthlyUsageCheck = (featureType) => {
  return async (req, res, next) => {
    try {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Check subscription status
      const subscriptionStatus = await getSubscriptionStatus(userId);

      // Subscribers have unlimited access
      if (subscriptionStatus.isSubscribed) {
        req.subscription = subscriptionStatus;
        return next();
      }

      // Trial users have full access during trial
      if (subscriptionStatus.isInTrial) {
        req.subscription = subscriptionStatus;
        return next();
      }

      // Free tier - check usage limits
      const usage = await getMonthlyUsage(userId);
      const limit = getFeatureLimit(featureType);

      if (usage[featureType] >= limit) {
        logger.info('Free tier limit reached', {
          userId,
          featureType,
          usage: usage[featureType],
          limit
        });

        return res.status(403).json({
          success: false,
          error: `Free tier limit reached for ${featureType}`,
          code: 'FREE_TIER_LIMIT_REACHED',
          details: {
            featureType,
            used: usage[featureType],
            limit,
            upgradeRequired: true
          }
        });
      }

      // Within limits - allow access
      req.subscription = subscriptionStatus;
      req.usageRemaining = limit - usage[featureType];
      next();
    } catch (error) {
      logger.error('Usage limit check failed', { error: error.message, userId: req.userId });
      // SECURITY FIX: Fail closed - deny access on errors
      return res.status(503).json({
        success: false,
        error: 'Unable to verify usage limits. Please try again.',
        code: 'USAGE_CHECK_FAILED',
        retryable: true
      });
    }
  };
};

/**
 * AI generation gate (summary, quiz, flashcards, chat, mindmap, diagram).
 *
 * Default: free for everyone. Only the per-user daily abuse backstop applies (middleware/freeTierLimits.js).
 * FREE_TIER_LEGACY_LIMITS=true restores the old monthly-limit check (legacyMonthlyUsageCheck, unchanged) in front of
 * the daily backstop. The flag is read on every request.
 * `dailyLimiter` is injectable for tests.
 */
const checkUsageLimits = (featureType, { dailyLimiter, breaker } = {}) => {
  const legacy = legacyMonthlyUsageCheck(featureType);
  let daily = dailyLimiter || null;
  let budget = breaker || null;
  return (req, res, next) => {
    if (!daily) daily = require('./freeTierLimits').aiDailyLimit();
    if (!budget) budget = require('./freeTierLimits').llmSpendBreaker();
    // Global LLM budget first (so a tripped breaker does not use up the user's own allowance), then the per-user checks.
    return budget(req, res, (bErr) => {
      if (bErr) return next(bErr);
      if (!legacyLimitsEnabled()) return daily(req, res, next);
      return legacy(req, res, (err) => (err ? next(err) : daily(req, res, next)));
    });
  };
};

/**
 * Record usage after successful operation
 */
const recordUsage = async (userId, featureType, metadata = {}) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    await supabase
      .from('usage_tracking')
      .insert({
        user_id: userId,
        feature_type: featureType,
        month_year: monthStart.toISOString().slice(0, 7), // "2024-01"
        metadata,
        created_at: new Date().toISOString()
      });

    logger.debug('Usage recorded', { userId, featureType });
  } catch (error) {
    logger.error('Failed to record usage', { error: error.message, userId, featureType });
  }
};

/**
 * Get user's subscription status with server-side trial tracking
 * Also checks for creator premium access with abuse prevention
 */
// Store webhooks map "auto-renew turned off" to 'cancelled' and "payment problem, store retrying" to 'grace_period'. The user
// has paid through the end of the current period in both cases, so they stay Pro until current_period_end passes.
const PAID_THROUGH_PERIOD_STATUSES = ['cancelled', 'grace_period'];

async function getSubscriptionStatus(userId) {
  // Check for active subscription first
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  // Real, additive field: true only for a cancelled / grace-period subscription whose paid period has not ended yet.
  // isSubscribed keeps its old meaning (status 'active'), so every pre-existing check behaves as before.
  let isPaidThroughPeriod = false;

  if (subscription && !subError) {
    const now = new Date();
    const expirationDate = subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : null;

    isPaidThroughPeriod = PAID_THROUGH_PERIOD_STATUSES.includes(subscription.status) &&
      !!expirationDate && expirationDate > now;

    const isActive = subscription.status === 'active' &&
      (!expirationDate || expirationDate > now);

    if (isActive) {
      return {
        hasAccess: true,
        isSubscribed: true,
        isPaidThroughPeriod: false,
        isInTrial: subscription.is_trial,
        reason: 'active_subscription',
        productId: subscription.product_id,
        expiresAt: subscription.current_period_end,
        platform: subscription.platform || 'unknown'
      };
    }
  }

  // Check for creator premium access (before trial check)
  const creatorAccess = await getCreatorPremiumAccess(userId);
  if (creatorAccess.hasAccess) {
    return {
      hasAccess: true,
      isSubscribed: false,
      isPaidThroughPeriod,
      isInTrial: false,
      isCreator: true,
      reason: creatorAccess.reason,
      creatorGracePeriodEnds: creatorAccess.gracePeriodEnds,
      conversions: creatorAccess.conversions
    };
  }

  // No active subscription - check trial status (server-side)
  const trialStatus = await getServerTrialStatus(userId);

  if (trialStatus.isInTrial) {
    return {
      hasAccess: true,
      isSubscribed: false,
      isPaidThroughPeriod,
      isInTrial: true,
      reason: 'trial_active',
      trialDaysRemaining: trialStatus.daysRemaining,
      trialExpiresAt: trialStatus.expiresAt
    };
  }

  // No subscription and trial expired
  return {
    hasAccess: false,
    isSubscribed: false,
    isPaidThroughPeriod,
    isInTrial: false,
    trialExpired: trialStatus.trialExpired,
    reason: trialStatus.trialExpired ? 'trial_expired' : 'no_subscription',
    trialDaysRemaining: 0
  };
}

/**
 * Check if user has creator premium access with abuse prevention
 * Rules:
 * - 30-day grace period for new creators (free premium regardless of conversions)
 * - After 30 days, require at least 1 conversion to maintain free premium
 * - Creators with no conversions after grace period lose premium until they convert someone
 */
async function getCreatorPremiumAccess(userId) {
  const CREATOR_GRACE_PERIOD_DAYS = 30;

  // Check if user is a creator
  const { data: creator, error } = await supabase
    .from('creators')
    .select('id, status, has_premium_access, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (error || !creator || !creator.has_premium_access) {
    return { hasAccess: false };
  }

  const now = new Date();
  const createdAt = new Date(creator.created_at);
  const gracePeriodEnds = new Date(createdAt.getTime() + CREATOR_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const isInGracePeriod = now < gracePeriodEnds;

  // During grace period, always grant access
  if (isInGracePeriod) {
    const daysRemaining = Math.ceil((gracePeriodEnds - now) / (24 * 60 * 60 * 1000));
    return {
      hasAccess: true,
      reason: 'creator_grace_period',
      gracePeriodEnds: gracePeriodEnds.toISOString(),
      gracePeriodDaysRemaining: daysRemaining,
      conversions: 0
    };
  }

  // Grace period expired - check for conversions
  const { count: conversions } = await supabase
    .from('promo_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', creator.id)
    .eq('attribution_status', 'attributed');

  const hasConversions = conversions > 0;

  if (hasConversions) {
    return {
      hasAccess: true,
      reason: 'creator_with_conversions',
      conversions: conversions
    };
  }

  // No conversions after grace period - no premium access
  logger.info('Creator premium access revoked - no conversions after grace period', {
    userId,
    creatorId: creator.id,
    gracePeriodEnded: gracePeriodEnds.toISOString()
  });

  return {
    hasAccess: false,
    reason: 'creator_no_conversions',
    conversions: 0,
    gracePeriodEnded: gracePeriodEnds.toISOString()
  };
}

/**
 * Get server-side trial status (prevents reinstall bypass)
 * Now also checks device_id to prevent trial abuse across accounts
 */
async function getServerTrialStatus(userId, deviceId = null) {
  // Get user's trial record from database
  const { data: trialRecord, error } = await supabase
    .from('user_trials')
    .select('*')
    .eq('user_id', userId)
    .single();

  const now = new Date();

  // If device ID provided, check if this device has already used a trial
  if (deviceId) {
    const { data: deviceTrial } = await supabase
      .from('device_trials')
      .select('*')
      .eq('device_id', deviceId)
      .single();

    if (deviceTrial && deviceTrial.trial_used) {
      // Device already used trial - check if it's expired
      const deviceTrialEnd = new Date(deviceTrial.trial_end);
      if (now > deviceTrialEnd) {
        logger.info('Device trial already used and expired', { deviceId, userId });
        return {
          isInTrial: false,
          daysRemaining: 0,
          expiresAt: deviceTrial.trial_end,
          trialExpired: true,
          deviceTrialUsed: true
        };
      }
    }
  }

  if (!trialRecord || error) {
    // No trial record — new user with no subscription and no trial
    // Trial is only granted when the user explicitly starts one via Apple/Google purchase
    // (server /sync endpoint is called with isTrial: true after StoreKit purchase)
    if (FREE_TIER_LIMITS.trialDays === 0) {
      return {
        isInTrial: false,
        daysRemaining: 0,
        expiresAt: null,
        trialExpired: false
      };
    }

    // Legacy path: auto-create trial (only if trialDays > 0)
    const trialStart = now;
    const trialEnd = new Date(now.getTime() + FREE_TIER_LIMITS.trialDays * 24 * 60 * 60 * 1000);

    await supabase
      .from('user_trials')
      .upsert({
        user_id: userId,
        trial_start: trialStart.toISOString(),
        trial_end: trialEnd.toISOString(),
        device_id: deviceId,
        created_at: now.toISOString()
      }, { onConflict: 'user_id' });

    if (deviceId) {
      await supabase
        .from('device_trials')
        .upsert({
          device_id: deviceId,
          first_user_id: userId,
          trial_start: trialStart.toISOString(),
          trial_end: trialEnd.toISOString(),
          trial_used: true,
          platform: 'ios',
          created_at: now.toISOString()
        }, { onConflict: 'device_id' });

      logger.info('New trial started with device tracking', { userId, deviceId });
    }

    await trackSubscriptionMetric(userId, deviceId, 'trial_started', 'ios', 'auto');

    return {
      isInTrial: true,
      daysRemaining: FREE_TIER_LIMITS.trialDays,
      expiresAt: trialEnd.toISOString(),
      trialExpired: false
    };
  }

  // Check if trial is still active
  const trialEnd = new Date(trialRecord.trial_end);
  const isInTrial = now < trialEnd;
  const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));

  return {
    isInTrial,
    daysRemaining,
    expiresAt: trialRecord.trial_end,
    trialExpired: !isInTrial
  };
}

/**
 * Track subscription funnel metrics
 */
async function trackSubscriptionMetric(userId, deviceId, eventType, platform = 'ios', source = null, metadata = {}) {
  try {
    await supabase
      .from('subscription_metrics')
      .insert({
        user_id: userId,
        device_id: deviceId,
        event_type: eventType,
        platform: platform,
        source: source,
        metadata: metadata,
        created_at: new Date().toISOString()
      });

    logger.debug('Subscription metric tracked', { userId, eventType, source });
  } catch (error) {
    // Don't fail on metrics errors
    logger.error('Failed to track subscription metric', { error: error.message, eventType });
  }
}

/**
 * Get user's monthly usage
 */
async function getMonthlyUsage(userId) {
  const now = new Date();
  const monthYear = now.toISOString().slice(0, 7); // "2024-01"

  const { data: usageRecords, error } = await supabase
    .from('usage_tracking')
    .select('feature_type')
    .eq('user_id', userId)
    .eq('month_year', monthYear);

  if (error || !usageRecords) {
    return {
      notes: 0,
      ai_generations: 0,
      podcasts: 0
    };
  }

  // Count by feature type
  const usage = {
    notes: 0,
    ai_generations: 0,
    podcasts: 0
  };

  usageRecords.forEach(record => {
    if (record.feature_type === 'note_created') usage.notes++;
    if (['summary', 'quiz', 'flashcards', 'chat', 'diagram'].includes(record.feature_type)) {
      usage.ai_generations++;
    }
    if (record.feature_type === 'podcast') usage.podcasts++;
  });

  return usage;
}

/**
 * Get limit for feature type
 */
function getFeatureLimit(featureType) {
  switch (featureType) {
    case 'notes':
    case 'note_created':
      return FREE_TIER_LIMITS.notesPerMonth;
    case 'podcast':
      return FREE_TIER_LIMITS.podcastsPerMonth;
    default:
      return FREE_TIER_LIMITS.aiGenerationsPerMonth;
  }
}

/** Back-compat name for the podcast gate. */
const requireSubscriptionForPodcast = requireProFeature('podcast');

module.exports = {
  requireSubscription,
  checkUsageLimits,
  recordUsage,
  requireSubscriptionForPodcast,
  hasPaidAccess,
  isProStatus,
  hasStandardAccess,
  requireProFeature,
  getSubscriptionStatus,
  getCreatorPremiumAccess,
  getServerTrialStatus,
  trackSubscriptionMetric,
  FREE_TIER_LIMITS
};
