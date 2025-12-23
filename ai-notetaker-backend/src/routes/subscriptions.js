const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// Subscription Sync Endpoint (from iOS/Android client)
// ============================================
router.post('/sync', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const {
    productId,
    platform,
    status,
    originalTransactionId,
    transactionId,
    expirationDate,
    purchaseDate,
    isTrial,
    trialEndDate,
    autoRenewEnabled,
    priceAmount,
    priceCurrency
  } = req.body;

  logger.info('Subscription sync received', { userId, productId, status, platform });

  // Validate required fields
  if (!productId || !platform || !status) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: productId, platform, status'
    });
  }

  try {
    // Check if subscription exists for this user
    const { data: existingSubscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    const subscriptionData = {
      user_id: userId,
      product_id: productId,
      platform: platform,
      status: status,
      original_transaction_id: originalTransactionId || transactionId,
      current_period_start: purchaseDate ? new Date(purchaseDate).toISOString() : new Date().toISOString(),
      current_period_end: expirationDate ? new Date(expirationDate).toISOString() : null,
      is_trial: isTrial || false,
      trial_end: trialEndDate ? new Date(trialEndDate).toISOString() : null,
      auto_renew_enabled: autoRenewEnabled !== false,
      price_amount: priceAmount || null,
      price_currency: priceCurrency || 'USD',
      updated_at: new Date().toISOString()
    };

    let subscription;
    if (existingSubscription && !fetchError) {
      // Update existing subscription
      const { data, error } = await supabase
        .from('subscriptions')
        .update(subscriptionData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      subscription = data;
      logger.info('Subscription updated', { userId, subscriptionId: subscription.id });
    } else {
      // Insert new subscription
      subscriptionData.created_at = new Date().toISOString();
      const { data, error } = await supabase
        .from('subscriptions')
        .insert(subscriptionData)
        .select()
        .single();

      if (error) throw error;
      subscription = data;
      logger.info('Subscription created', { userId, subscriptionId: subscription.id });
    }

    // Log subscription event
    await logSubscriptionEvent(userId, subscription.id, {
      eventType: isTrial ? 'trial_started' : 'subscription_started',
      platform,
      productId,
      transactionId,
      originalTransactionId: originalTransactionId || transactionId,
      priceAmount,
      priceCurrency,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox'
    });

    res.json({
      success: true,
      data: {
        subscriptionId: subscription.id,
        status: subscription.status,
        expiresAt: subscription.current_period_end
      }
    });
  } catch (error) {
    logger.error('Subscription sync failed', { error: error.message, userId });
    throw error;
  }
}));

// ============================================
// Get current subscription status
// ============================================
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;

  const { data: subscription, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    throw error;
  }

  if (!subscription) {
    return res.json({
      success: true,
      data: {
        isSubscribed: false,
        status: 'none'
      }
    });
  }

  // Check if subscription is still valid
  const now = new Date();
  const expirationDate = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  const isActive = subscription.status === 'active' && (!expirationDate || expirationDate > now);

  res.json({
    success: true,
    data: {
      isSubscribed: isActive,
      status: subscription.status,
      productId: subscription.product_id,
      platform: subscription.platform,
      expiresAt: subscription.current_period_end,
      isTrial: subscription.is_trial,
      trialEndsAt: subscription.trial_end,
      autoRenewEnabled: subscription.auto_renew_enabled
    }
  });
}));

// ============================================
// Get full access status (subscription + trial + usage)
// This is the main endpoint clients should use to check access
// ============================================
router.get('/access', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const { getSubscriptionStatus, FREE_TIER_LIMITS } = require('../middleware/subscription');

  // Get comprehensive subscription status
  const status = await getSubscriptionStatus(userId);

  // Get usage for current month
  const now = new Date();
  const monthYear = now.toISOString().slice(0, 7);

  const { data: usageRecords } = await supabase
    .from('usage_tracking')
    .select('feature_type')
    .eq('user_id', userId)
    .eq('month_year', monthYear);

  // Calculate usage counts
  const usage = {
    notes: 0,
    aiGenerations: 0,
    podcasts: 0
  };

  if (usageRecords) {
    usageRecords.forEach(record => {
      if (record.feature_type === 'note_created') usage.notes++;
      if (['summary', 'quiz', 'flashcards', 'chat', 'diagram'].includes(record.feature_type)) {
        usage.aiGenerations++;
      }
      if (record.feature_type === 'podcast') usage.podcasts++;
    });
  }

  // Calculate remaining usage for free tier
  const limits = {
    notesPerMonth: FREE_TIER_LIMITS.notesPerMonth,
    aiGenerationsPerMonth: FREE_TIER_LIMITS.aiGenerationsPerMonth,
    podcastsPerMonth: FREE_TIER_LIMITS.podcastsPerMonth
  };

  const remaining = {
    notes: Math.max(0, limits.notesPerMonth - usage.notes),
    aiGenerations: Math.max(0, limits.aiGenerationsPerMonth - usage.aiGenerations),
    podcasts: Math.max(0, limits.podcastsPerMonth - usage.podcasts)
  };

  res.json({
    success: true,
    data: {
      // Access status
      hasAccess: status.hasAccess,
      isSubscribed: status.isSubscribed,
      isInTrial: status.isInTrial,
      reason: status.reason,

      // Trial info
      trialDaysRemaining: status.trialDaysRemaining || 0,
      trialExpiresAt: status.trialExpiresAt || null,
      trialExpired: status.trialExpired || false,

      // Subscription info (if subscribed)
      productId: status.productId || null,
      expiresAt: status.expiresAt || null,

      // Usage (for free tier)
      usage: {
        current: usage,
        limits: limits,
        remaining: remaining
      },

      // Feature access
      features: {
        canCreateNotes: status.hasAccess || remaining.notes > 0,
        canUseAI: status.hasAccess || remaining.aiGenerations > 0,
        canGeneratePodcasts: status.isSubscribed || status.isInTrial,
        unlimitedAccess: status.isSubscribed || status.isInTrial
      }
    }
  });
}));

// ============================================
// Record subscription event (from client)
// ============================================
router.post('/event', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const {
    eventType,
    platform,
    productId,
    transactionId,
    originalTransactionId,
    priceAmount,
    priceCurrency,
    reason,
    metadata
  } = req.body;

  logger.info('Subscription event received', { userId, eventType, productId });

  // Validate event type
  const validEventTypes = [
    'trial_started', 'trial_converted', 'trial_cancelled', 'trial_expired',
    'subscription_started', 'subscription_renewed', 'subscription_cancelled',
    'subscription_expired', 'subscription_grace_period', 'subscription_reactivated',
    'refund_issued', 'billing_issue', 'price_change'
  ];

  if (!validEventTypes.includes(eventType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid event type. Must be one of: ${validEventTypes.join(', ')}`
    });
  }

  // Get subscription ID if exists
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .single();

  await logSubscriptionEvent(userId, subscription?.id, {
    eventType,
    platform: platform || 'ios',
    productId,
    transactionId,
    originalTransactionId,
    priceAmount,
    priceCurrency,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
    metadata: { ...metadata, reason }
  });

  // Update subscription status based on event type
  if (subscription) {
    let statusUpdate = null;
    switch (eventType) {
      case 'trial_cancelled':
      case 'subscription_cancelled':
        statusUpdate = {
          status: 'cancelled',
          cancellation_date: new Date().toISOString(),
          cancellation_reason: reason || 'user_cancelled'
        };
        break;
      case 'trial_expired':
      case 'subscription_expired':
        statusUpdate = { status: 'expired' };
        break;
      case 'subscription_grace_period':
        statusUpdate = { status: 'grace_period' };
        break;
      case 'subscription_reactivated':
      case 'trial_converted':
        statusUpdate = { status: 'active', is_trial: false };
        break;
    }

    if (statusUpdate) {
      await supabase
        .from('subscriptions')
        .update({ ...statusUpdate, updated_at: new Date().toISOString() })
        .eq('id', subscription.id);
    }
  }

  res.json({ success: true });
}));

// ============================================
// Apple App Store Server Notifications v2
// ============================================
router.post('/webhook/apple', asyncHandler(async (req, res) => {
  const { signedPayload } = req.body;

  if (!signedPayload) {
    logger.warn('Apple webhook: Missing signedPayload');
    return res.status(400).json({ success: false, error: 'Missing signedPayload' });
  }

  try {
    // Decode and verify the JWS (JSON Web Signature)
    // In production, you should verify the signature using Apple's public key
    const payload = decodeAppleJWS(signedPayload);

    logger.info('Apple webhook received', {
      notificationType: payload.notificationType,
      subtype: payload.subtype
    });

    // Decode the transaction info
    const transactionInfo = payload.data?.signedTransactionInfo
      ? decodeAppleJWS(payload.data.signedTransactionInfo)
      : null;

    const renewalInfo = payload.data?.signedRenewalInfo
      ? decodeAppleJWS(payload.data.signedRenewalInfo)
      : null;

    if (!transactionInfo) {
      logger.warn('Apple webhook: No transaction info found');
      return res.json({ success: true }); // Acknowledge receipt
    }

    // Find user by original transaction ID
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*, user_id')
      .eq('original_transaction_id', transactionInfo.originalTransactionId)
      .single();

    if (!subscription) {
      logger.warn('Apple webhook: No subscription found for transaction', {
        originalTransactionId: transactionInfo.originalTransactionId
      });
      return res.json({ success: true }); // Acknowledge receipt
    }

    const userId = subscription.user_id;

    // Map Apple notification types to our event types
    const eventMapping = {
      'SUBSCRIBED': 'subscription_started',
      'DID_RENEW': 'subscription_renewed',
      'DID_FAIL_TO_RENEW': 'billing_issue',
      'EXPIRED': 'subscription_expired',
      'GRACE_PERIOD_EXPIRED': 'subscription_expired',
      'OFFER_REDEEMED': 'subscription_started',
      'REFUND': 'refund_issued',
      'REFUND_DECLINED': null, // No action needed
      'RENEWAL_EXTENDED': 'subscription_renewed',
      'REVOKE': 'subscription_cancelled',
      'DID_CHANGE_RENEWAL_PREF': 'price_change',
      'DID_CHANGE_RENEWAL_STATUS': null, // Handle separately
    };

    const eventType = eventMapping[payload.notificationType];

    // Handle subscription status changes
    let statusUpdate = {};
    switch (payload.notificationType) {
      case 'SUBSCRIBED':
        statusUpdate = {
          status: 'active',
          current_period_end: transactionInfo.expiresDate
            ? new Date(transactionInfo.expiresDate).toISOString()
            : null
        };
        break;

      case 'DID_RENEW':
        statusUpdate = {
          status: 'active',
          is_trial: false,
          current_period_end: transactionInfo.expiresDate
            ? new Date(transactionInfo.expiresDate).toISOString()
            : null
        };
        break;

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
        statusUpdate = { status: 'expired' };
        break;

      case 'DID_FAIL_TO_RENEW':
        statusUpdate = { status: 'grace_period' };
        break;

      case 'REVOKE':
      case 'REFUND':
        statusUpdate = {
          status: 'cancelled',
          cancellation_date: new Date().toISOString(),
          cancellation_reason: payload.notificationType.toLowerCase()
        };
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        // User turned auto-renew on or off
        statusUpdate = {
          auto_renew_enabled: renewalInfo?.autoRenewStatus === 1
        };
        break;
    }

    // Update subscription
    if (Object.keys(statusUpdate).length > 0) {
      await supabase
        .from('subscriptions')
        .update({ ...statusUpdate, updated_at: new Date().toISOString() })
        .eq('id', subscription.id);

      logger.info('Subscription updated via Apple webhook', {
        subscriptionId: subscription.id,
        notificationType: payload.notificationType,
        statusUpdate
      });
    }

    // Log event
    if (eventType) {
      await logSubscriptionEvent(userId, subscription.id, {
        eventType,
        platform: 'ios',
        productId: transactionInfo.productId,
        transactionId: transactionInfo.transactionId,
        originalTransactionId: transactionInfo.originalTransactionId,
        environment: payload.data?.environment || 'production',
        rawNotification: payload
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Apple webhook processing error', { error: error.message });
    // Still return 200 to acknowledge receipt
    res.json({ success: true });
  }
}));

// ============================================
// Get subscription metrics (admin endpoint)
// ============================================
router.get('/metrics', authenticate, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get subscription events for funnel metrics
  const { data: events, error } = await supabase
    .from('subscription_events')
    .select('event_type, user_id, created_at, price_amount, price_currency')
    .gte('created_at', startDate.toISOString());

  if (error) throw error;

  // Get current subscription status distribution
  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select('status, product_id, is_trial, platform');

  if (subError) throw subError;

  // Calculate metrics
  const metrics = {
    period: { days, startDate: startDate.toISOString(), endDate: new Date().toISOString() },
    funnel: calculateFunnelMetrics(events),
    currentStatus: calculateStatusDistribution(subscriptions),
    revenue: calculateRevenueMetrics(events),
    platformBreakdown: calculatePlatformBreakdown(subscriptions)
  };

  res.json({ success: true, data: metrics });
}));

// ============================================
// Helper Functions
// ============================================

async function logSubscriptionEvent(userId, subscriptionId, eventData) {
  try {
    await supabase
      .from('subscription_events')
      .insert({
        user_id: userId,
        subscription_id: subscriptionId,
        event_type: eventData.eventType,
        platform: eventData.platform || 'ios',
        product_id: eventData.productId,
        transaction_id: eventData.transactionId,
        original_transaction_id: eventData.originalTransactionId,
        price_amount: eventData.priceAmount,
        price_currency: eventData.priceCurrency,
        environment: eventData.environment,
        raw_notification: eventData.rawNotification,
        metadata: eventData.metadata || {},
        created_at: new Date().toISOString()
      });
  } catch (error) {
    logger.error('Failed to log subscription event', { error: error.message, userId, eventType: eventData.eventType });
  }
}

function decodeAppleJWS(jws) {
  // JWS format: header.payload.signature
  // For now, we just decode the payload (base64url)
  // In production, you should verify the signature
  const parts = jws.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWS format');
  }

  const payload = parts[1];
  // Base64url decode
  const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(decoded);
}

function calculateFunnelMetrics(events) {
  const uniqueUsers = new Set();
  const trialStarted = new Set();
  const trialCancelled = new Set();
  const trialConverted = new Set();
  const subscriptionStarted = new Set();
  const subscriptionCancelled = new Set();
  const subscriptionRenewed = new Set();

  events.forEach(e => {
    uniqueUsers.add(e.user_id);

    switch (e.event_type) {
      case 'trial_started':
        trialStarted.add(e.user_id);
        break;
      case 'trial_cancelled':
        trialCancelled.add(e.user_id);
        break;
      case 'trial_converted':
        trialConverted.add(e.user_id);
        break;
      case 'subscription_started':
        subscriptionStarted.add(e.user_id);
        break;
      case 'subscription_cancelled':
        subscriptionCancelled.add(e.user_id);
        break;
      case 'subscription_renewed':
        subscriptionRenewed.add(e.user_id);
        break;
    }
  });

  const trialCount = trialStarted.size;
  const paidCount = subscriptionStarted.size + trialConverted.size;

  return {
    totalUsers: uniqueUsers.size,
    trialStarted: trialStarted.size,
    trialCancelled: trialCancelled.size,
    trialCancelRate: trialCount ? ((trialCancelled.size / trialCount) * 100).toFixed(1) + '%' : '0%',
    trialConverted: trialConverted.size,
    trialConversionRate: trialCount ? ((trialConverted.size / trialCount) * 100).toFixed(1) + '%' : '0%',
    subscriptionStarted: subscriptionStarted.size,
    subscriptionCancelled: subscriptionCancelled.size,
    churnRate: paidCount ? ((subscriptionCancelled.size / paidCount) * 100).toFixed(1) + '%' : '0%',
    subscriptionRenewed: subscriptionRenewed.size
  };
}

function calculateStatusDistribution(subscriptions) {
  const distribution = {
    active: 0,
    cancelled: 0,
    expired: 0,
    grace_period: 0,
    pending: 0,
    trial: 0
  };

  subscriptions.forEach(s => {
    if (s.is_trial && s.status === 'active') {
      distribution.trial++;
    } else {
      distribution[s.status] = (distribution[s.status] || 0) + 1;
    }
  });

  return distribution;
}

function calculateRevenueMetrics(events) {
  let totalRevenue = 0;
  let transactionCount = 0;

  events.forEach(e => {
    if (['subscription_started', 'subscription_renewed', 'trial_converted'].includes(e.event_type)) {
      if (e.price_amount) {
        totalRevenue += parseFloat(e.price_amount);
        transactionCount++;
      }
    }
  });

  return {
    totalRevenue: totalRevenue.toFixed(2),
    transactionCount,
    averageRevenue: transactionCount ? (totalRevenue / transactionCount).toFixed(2) : '0.00'
  };
}

function calculatePlatformBreakdown(subscriptions) {
  const breakdown = { ios: 0, android: 0, web: 0 };

  subscriptions.forEach(s => {
    if (s.status === 'active') {
      breakdown[s.platform] = (breakdown[s.platform] || 0) + 1;
    }
  });

  return breakdown;
}

module.exports = router;
