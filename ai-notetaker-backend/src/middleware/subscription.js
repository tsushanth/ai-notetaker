const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Free tier limits
const FREE_TIER_LIMITS = {
  notesPerMonth: 3,           // Free users can create 3 notes per month
  aiGenerationsPerMonth: 5,   // Free users get 5 AI generations (summary, quiz, flashcards) per month
  podcastsPerMonth: 0,        // No podcasts for free tier
  trialDays: 7                // 7-day trial period
};

/**
 * Middleware to check if user has an active subscription or is in trial
 * Blocks access to premium features if not subscribed
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
    // On error, allow access but log it (fail open for better UX, but monitor)
    req.subscription = { hasAccess: true, reason: 'error_fallback' };
    next();
  }
};

/**
 * Middleware to check usage limits for free tier users
 * Allows limited access to AI features
 */
const checkUsageLimits = (featureType) => {
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
      next(); // Fail open
    }
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
 */
async function getSubscriptionStatus(userId) {
  // Check for active subscription first
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (subscription && !subError) {
    const now = new Date();
    const expirationDate = subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : null;

    const isActive = subscription.status === 'active' &&
      (!expirationDate || expirationDate > now);

    if (isActive) {
      return {
        hasAccess: true,
        isSubscribed: true,
        isInTrial: subscription.is_trial,
        reason: 'active_subscription',
        productId: subscription.product_id,
        expiresAt: subscription.current_period_end
      };
    }
  }

  // No active subscription - check trial status (server-side)
  const trialStatus = await getServerTrialStatus(userId);

  if (trialStatus.isInTrial) {
    return {
      hasAccess: true,
      isSubscribed: false,
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
    isInTrial: false,
    trialExpired: trialStatus.trialExpired,
    reason: trialStatus.trialExpired ? 'trial_expired' : 'no_subscription',
    trialDaysRemaining: 0
  };
}

/**
 * Get server-side trial status (prevents reinstall bypass)
 */
async function getServerTrialStatus(userId) {
  // Get user's trial record from database
  const { data: trialRecord, error } = await supabase
    .from('user_trials')
    .select('*')
    .eq('user_id', userId)
    .single();

  const now = new Date();

  if (!trialRecord || error) {
    // No trial record - create one (first time user)
    const trialStart = now;
    const trialEnd = new Date(now.getTime() + FREE_TIER_LIMITS.trialDays * 24 * 60 * 60 * 1000);

    await supabase
      .from('user_trials')
      .upsert({
        user_id: userId,
        trial_start: trialStart.toISOString(),
        trial_end: trialEnd.toISOString(),
        created_at: now.toISOString()
      }, { onConflict: 'user_id' });

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

/**
 * Middleware to block podcasts for free tier entirely
 */
const requireSubscriptionForPodcast = async (req, res, next) => {
  try {
    const userId = req.userId;
    const subscriptionStatus = await getSubscriptionStatus(userId);

    // Only subscribers and trial users can generate podcasts
    if (subscriptionStatus.isSubscribed || subscriptionStatus.isInTrial) {
      req.subscription = subscriptionStatus;
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'Podcast generation requires a premium subscription',
      code: 'SUBSCRIPTION_REQUIRED',
      details: {
        feature: 'podcast',
        upgradeRequired: true
      }
    });
  } catch (error) {
    logger.error('Podcast subscription check failed', { error: error.message });
    next();
  }
};

module.exports = {
  requireSubscription,
  checkUsageLimits,
  recordUsage,
  requireSubscriptionForPodcast,
  getSubscriptionStatus,
  FREE_TIER_LIMITS
};
