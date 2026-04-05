const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');
const crypto = require('crypto');
const Stripe = require('stripe');
const { trackSubscriptionMetric, getServerTrialStatus } = require('../middleware/subscription');
const { getUserActiveRedemption } = require('../services/creatorService');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Price IDs — hardcoded fallbacks so deploys can't wipe them
const STRIPE_PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || 'price_1Ssq3iKFBTQTkmztweW9EgST',
  yearly: process.env.STRIPE_PRICE_YEARLY || 'price_1Sjv8UKFBTQTkmztT2AC3ae9'
};

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
      platform: status.platform || null,

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
        canExportNotes: status.isSubscribed || status.isInTrial,
        canShareNotes: true,  // Free: 3/month, premium: unlimited (enforced server-side)
        canUseIntegrations: status.isSubscribed || status.isInTrial,
        unlimitedAccess: status.isSubscribed || status.isInTrial
      }
    }
  });
}));

// ============================================
// Track subscription funnel metric (from client)
// ============================================
router.post('/track', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const { eventType, deviceId, platform, source, metadata } = req.body;

  logger.info('Subscription metric received', { userId, eventType, deviceId, source });

  // Validate event type
  const validEventTypes = [
    'app_install', 'onboarding_started', 'onboarding_completed',
    'paywall_viewed', 'trial_screen_viewed', 'trial_started', 'trial_skipped',
    'purchase_initiated', 'purchase_completed', 'purchase_failed', 'purchase_cancelled',
    'trial_reminder_sent', 'trial_expired', 'subscription_renewed', 'subscription_cancelled', 'churn'
  ];

  if (!validEventTypes.includes(eventType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid event type. Must be one of: ${validEventTypes.join(', ')}`
    });
  }

  await trackSubscriptionMetric(userId, deviceId, eventType, platform || 'ios', source, metadata || {});

  res.json({ success: true });
}));

// ============================================
// Get trial status with device tracking
// ============================================
router.post('/trial/check', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const { deviceId } = req.body;

  logger.info('Trial check with device ID', { userId, deviceId: deviceId ? 'provided' : 'not provided' });

  const trialStatus = await getServerTrialStatus(userId, deviceId);

  res.json({
    success: true,
    data: trialStatus
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
// Reconcile iOS subscription with client-reported status
// Called when iOS app detects subscription status from StoreKit
// ============================================
router.post('/reconcile', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const {
    productId,
    originalTransactionId,
    transactionId,
    expirationDate,
    purchaseDate,
    isSubscribed,
    offerType, // 'introductory', 'promotional', 'code', or null
    autoRenewEnabled,
    priceAmount,
    priceCurrency
  } = req.body;

  logger.info('Subscription reconciliation request', {
    userId,
    productId,
    originalTransactionId,
    isSubscribed,
    offerType
  });

  if (!originalTransactionId) {
    return res.status(400).json({
      success: false,
      error: 'Missing originalTransactionId'
    });
  }

  try {
    // Find existing subscription
    const { data: existingSubscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const now = new Date();
    const expDate = expirationDate ? new Date(expirationDate) : null;
    const isActive = isSubscribed && expDate && expDate > now;
    const isInTrial = offerType === 'introductory';

    // Determine if this is a trial conversion
    // If we had is_trial=true and now offerType is not introductory, trial converted
    const wasInTrial = existingSubscription?.is_trial === true;
    const trialConverted = wasInTrial && !isInTrial && isActive;

    if (trialConverted) {
      logger.info('Reconciliation detected trial conversion', {
        userId,
        productId,
        originalTransactionId
      });

      // Log the trial_converted event
      await logSubscriptionEvent(userId, existingSubscription?.id, {
        eventType: 'trial_converted',
        platform: 'ios',
        productId,
        transactionId,
        originalTransactionId,
        priceAmount,
        priceCurrency,
        environment: 'production',
        metadata: { source: 'client_reconciliation' }
      });
    }

    // Update subscription record
    const subscriptionData = {
      user_id: userId,
      product_id: productId,
      platform: 'ios',
      status: isActive ? 'active' : (isSubscribed ? 'grace_period' : 'expired'),
      original_transaction_id: originalTransactionId,
      current_period_start: purchaseDate ? new Date(purchaseDate).toISOString() : null,
      current_period_end: expDate ? expDate.toISOString() : null,
      is_trial: isInTrial,
      trial_end: isInTrial && expDate ? expDate.toISOString() : existingSubscription?.trial_end,
      auto_renew_enabled: autoRenewEnabled !== false,
      price_amount: priceAmount || existingSubscription?.price_amount,
      price_currency: priceCurrency || existingSubscription?.price_currency || 'USD',
      updated_at: now.toISOString()
    };

    let subscription;
    if (existingSubscription) {
      const { data, error } = await supabase
        .from('subscriptions')
        .update(subscriptionData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      subscription = data;
    } else {
      subscriptionData.created_at = now.toISOString();
      const { data, error } = await supabase
        .from('subscriptions')
        .insert(subscriptionData)
        .select()
        .single();

      if (error) throw error;
      subscription = data;
    }

    logger.info('Subscription reconciled', {
      userId,
      subscriptionId: subscription.id,
      status: subscription.status,
      trialConverted
    });

    res.json({
      success: true,
      data: {
        subscriptionId: subscription.id,
        status: subscription.status,
        isActive,
        trialConverted
      }
    });
  } catch (error) {
    logger.error('Subscription reconciliation failed', { error: error.message, userId });
    throw error;
  }
}));

// ============================================
// Stripe Checkout - Create checkout session
// ============================================

// Stripe coupon ID for 10% off promo code discount
// This needs to be created once in Stripe Dashboard or via API
const PROMO_CODE_STRIPE_COUPON_ID = process.env.STRIPE_PROMO_COUPON_ID || 'PROMO10';

// Helper to get or create the 10% promo coupon in Stripe
async function getOrCreatePromoCoupon() {
  try {
    // Try to retrieve existing coupon
    const coupon = await stripe.coupons.retrieve(PROMO_CODE_STRIPE_COUPON_ID);
    return coupon.id;
  } catch (error) {
    if (error.code === 'resource_missing') {
      // Create the coupon if it doesn't exist
      logger.info('Creating Stripe promo coupon', { couponId: PROMO_CODE_STRIPE_COUPON_ID });
      const coupon = await stripe.coupons.create({
        id: PROMO_CODE_STRIPE_COUPON_ID,
        percent_off: 10,
        duration: 'once', // Only applies to first payment
        name: 'Creator Promo Code - 10% Off First Subscription',
        metadata: {
          type: 'creator_promo',
          description: 'One-time 10% discount for users who applied a creator promo code'
        }
      });
      logger.info('Created Stripe promo coupon', { couponId: coupon.id });
      return coupon.id;
    }
    throw error;
  }
}

router.post('/stripe/checkout', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const { priceId, plan } = req.body;

  logger.info('Creating Stripe checkout session', { userId, plan, priceId });

  try {
    // Get user email from auth middleware (already authenticated)
    const userEmail = req.userEmail || req.user?.email;
    const userName = req.user?.user_metadata?.name || req.user?.user_metadata?.full_name;

    if (!userEmail) {
      logger.error('User email not found for checkout', { userId, hasUser: !!req.user });
      return res.status(400).json({
        success: false,
        error: 'User email not found'
      });
    }

    logger.info('Found user for checkout', { userId, email: userEmail, name: userName });

    // Check if user already has a Stripe customer ID
    let { data: existingSubscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = existingSubscription?.stripe_customer_id;
    logger.info('Existing subscription check', { userId, hasExistingCustomerId: !!customerId });

    // Create or get Stripe customer
    if (!customerId) {
      logger.info('Creating new Stripe customer', { userId, email: userEmail });
      const customer = await stripe.customers.create({
        email: userEmail,
        name: userName || undefined,
        metadata: { userId }
      });
      customerId = customer.id;
      logger.info('Created Stripe customer', { userId, customerId });
    }

    // Determine price ID
    const selectedPriceId = priceId || (plan === 'yearly' ? STRIPE_PRICES.yearly : STRIPE_PRICES.monthly);
    logger.info('Selected price ID', { userId, selectedPriceId, plan });

    // Check if user has an active promo code with discount eligibility
    let discountCouponId = null;
    try {
      const redemption = await getUserActiveRedemption(userId);
      if (redemption && redemption.discount_applied) {
        // User has a promo code that grants them 10% off
        discountCouponId = await getOrCreatePromoCoupon();
        logger.info('Applying promo code discount to checkout', {
          userId,
          redemptionId: redemption.id,
          couponId: discountCouponId,
          promoCode: redemption.code_used
        });
      }
    } catch (promoError) {
      // Don't fail checkout if promo check fails - just log and continue
      logger.warn('Error checking promo code for checkout', {
        userId,
        error: promoError.message
      });
    }

    // Build checkout session config
    const sessionConfig = {
      customer: customerId,
      mode: 'subscription',
      line_items: [{
        price: selectedPriceId,
        quantity: 1,
      }],
      success_url: `${process.env.WEB_APP_URL || 'https://scribeai.online'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.WEB_APP_URL || 'https://scribeai.online'}/subscription?cancelled=true`,
      subscription_data: {
        metadata: { userId, platform: 'web' },
        trial_period_days: 7, // 7-day trial
      },
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
    };

    // Apply promo discount coupon if user has one
    if (discountCouponId) {
      sessionConfig.discounts = [{
        coupon: discountCouponId,
      }];
      // Don't allow additional promotion codes if we're already applying one
      sessionConfig.allow_promotion_codes = false;
    } else {
      // Allow users without our promo code to enter Stripe promotion codes
      sessionConfig.allow_promotion_codes = true;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig);

    logger.info('Stripe checkout session created', {
      userId,
      sessionId: session.id,
      hasPromoCoupon: !!discountCouponId
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
        discountApplied: !!discountCouponId
      }
    });
  } catch (error) {
    logger.error('Stripe checkout error', {
      userId,
      error: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      stack: error.stack
    });
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to create checkout session'
    });
  }
}));

// ============================================
// Stripe Checkout - Get available plans/prices
// ============================================
router.get('/stripe/prices', asyncHandler(async (req, res) => {
  try {
    // Fetch active prices from Stripe
    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product'],
      limit: 20
    });

    // Filter for only Scribe AI Premium prices
    const scribeAiPriceIds = [
      process.env.STRIPE_PRICE_MONTHLY,
      process.env.STRIPE_PRICE_YEARLY
    ].filter(Boolean);

    const plans = prices.data
      .filter(price => {
        // Filter by price ID if configured, otherwise by product name
        if (scribeAiPriceIds.length > 0) {
          return scribeAiPriceIds.includes(price.id);
        }
        // Fallback: filter by product name containing "Scribe"
        return price.product && !price.product.deleted &&
               price.product.name && price.product.name.toLowerCase().includes('scribe');
      })
      .map(price => ({
        id: price.id,
        name: price.product.name,
        description: price.product.description,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval,
        intervalCount: price.recurring?.interval_count,
        trialDays: price.recurring?.trial_period_days || 7
      }))
      .sort((a, b) => a.amount - b.amount);

    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    logger.error('Failed to fetch Stripe prices', { error: error.message });
    res.json({
      success: true,
      data: [] // Return empty if Stripe prices not configured yet
    });
  }
}));

// ============================================
// Stripe Customer Portal - Manage subscription
// ============================================
router.post('/stripe/portal', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;

  // Get user's Stripe customer ID
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single();

  if (!subscription?.stripe_customer_id) {
    return res.status(400).json({
      success: false,
      error: 'No subscription found'
    });
  }

  // Create portal session
  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${process.env.WEB_APP_URL || 'https://scribeai-web-app-917362189743.us-central1.run.app'}/settings`,
  });

  res.json({
    success: true,
    data: { url: session.url }
  });
}));

// ============================================
// Manual Stripe Sync - Pull subscription from Stripe
// Use this when webhooks fail
// ============================================
router.post('/stripe/sync', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const userEmail = req.userEmail || req.user?.email;

  logger.info('Manual Stripe sync requested', { userId, email: userEmail });

  try {
    // Find customer by email in Stripe
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1
    });

    if (customers.data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No Stripe customer found for this email'
      });
    }

    const customer = customers.data[0];
    logger.info('Found Stripe customer', { customerId: customer.id });

    // Get active subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No subscription found for this customer'
      });
    }

    const stripeSubscription = subscriptions.data[0];
    logger.info('Found Stripe subscription', {
      subscriptionId: stripeSubscription.id,
      status: stripeSubscription.status
    });

    // Update our database
    const currentPeriodEnd = stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
      : null;

    const subscriptionData = {
      user_id: userId,
      stripe_subscription_id: stripeSubscription.id,
      stripe_customer_id: customer.id,
      product_id: stripeSubscription.items?.data?.[0]?.price?.id || 'stripe_subscription',
      platform: 'web',
      status: stripeSubscription.status === 'active' || stripeSubscription.status === 'trialing' ? 'active' : stripeSubscription.status,
      current_period_start: stripeSubscription.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: currentPeriodEnd,
      is_trial: stripeSubscription.status === 'trialing',
      trial_end: stripeSubscription.trial_end
        ? new Date(stripeSubscription.trial_end * 1000).toISOString()
        : null,
      auto_renew_enabled: !stripeSubscription.cancel_at_period_end,
      updated_at: new Date().toISOString()
    };

    // Upsert subscription
    const { data, error } = await supabase
      .from('subscriptions')
      .upsert(subscriptionData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      logger.error('Failed to upsert subscription', { error: error.message });
      throw error;
    }

    logger.info('Subscription synced successfully', { userId, subscriptionId: data.id });

    res.json({
      success: true,
      message: 'Subscription synced from Stripe',
      data: {
        status: subscriptionData.status,
        expiresAt: subscriptionData.current_period_end,
        isTrial: subscriptionData.is_trial,
        productId: subscriptionData.product_id
      }
    });
  } catch (error) {
    logger.error('Stripe sync error', { error: error.message, userId });
    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to sync subscription'
    });
  }
}));

// ============================================
// Stripe Webhook - Handle subscription events
// ============================================
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // For testing without webhook signature verification
      event = JSON.parse(req.body.toString());
      logger.warn('Stripe webhook signature verification skipped - no webhook secret configured');
    }
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logger.info('Stripe webhook received', { type: event.type, id: event.id });

  const subscription = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      // New subscription created via checkout
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
        await handleStripeSubscriptionUpdate(stripeSubscription, 'checkout_completed');
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleStripeSubscriptionUpdate(subscription, event.type);
      break;

    case 'customer.subscription.deleted':
      await handleStripeSubscriptionDeleted(subscription);
      break;

    case 'invoice.payment_succeeded':
      // Renewal successful
      if (subscription.subscription) {
        const sub = await stripe.subscriptions.retrieve(subscription.subscription);
        await handleStripeSubscriptionUpdate(sub, 'invoice_paid');
      }
      break;

    case 'invoice.payment_failed':
      // Payment failed - subscription may go to past_due
      logger.info('Stripe payment failed', {
        customerId: subscription.customer,
        subscriptionId: subscription.subscription
      });
      break;
  }

  res.json({ received: true });
}));

// Helper: Handle Stripe subscription updates
async function handleStripeSubscriptionUpdate(subscription, eventType) {
  const userId = subscription.metadata?.userId;
  const customerId = subscription.customer;

  if (!userId) {
    // Try to find user by customer ID
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!existingSub) {
      logger.warn('Stripe subscription update: No user found', { customerId, subscriptionId: subscription.id });
      return;
    }
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const subscriptionData = {
    user_id: userId || undefined,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    product_id: subscription.items?.data?.[0]?.price?.id || 'stripe_subscription',
    platform: 'web',
    status: subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status,
    current_period_start: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null,
    current_period_end: currentPeriodEnd,
    is_trial: subscription.status === 'trialing',
    trial_end: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null,
    auto_renew_enabled: !subscription.cancel_at_period_end,
    updated_at: new Date().toISOString()
  };

  // Upsert subscription
  const { error } = await supabase
    .from('subscriptions')
    .upsert(subscriptionData, {
      onConflict: userId ? 'user_id' : 'stripe_subscription_id'
    });

  if (error) {
    logger.error('Failed to update subscription from Stripe webhook', { error: error.message });
  } else {
    logger.info('Subscription updated from Stripe', {
      userId,
      status: subscriptionData.status,
      eventType
    });
  }
}

// Helper: Handle Stripe subscription deletion
async function handleStripeSubscriptionDeleted(subscription) {
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      cancellation_date: new Date().toISOString(),
      cancellation_reason: 'stripe_deleted',
      updated_at: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    logger.error('Failed to mark subscription as cancelled', { error: error.message });
  } else {
    logger.info('Subscription marked as cancelled', { subscriptionId: subscription.id });
  }
}

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

    // Log full transaction info for debugging
    logger.info('Apple webhook transaction info', {
      originalTransactionId: transactionInfo.originalTransactionId,
      transactionId: transactionInfo.transactionId,
      productId: transactionInfo.productId,
      expiresDate: transactionInfo.expiresDate,
      offerType: transactionInfo.offerType
    });

    // Find user by original transaction ID
    let subscription = null;

    // First try exact match on original_transaction_id
    if (transactionInfo.originalTransactionId && transactionInfo.originalTransactionId !== '0') {
      const { data } = await supabase
        .from('subscriptions')
        .select('*, user_id')
        .eq('original_transaction_id', transactionInfo.originalTransactionId)
        .single();
      subscription = data;
    }

    // Fallback: try to find by product_id for iOS platform (for sandbox testing where txn_id = 0)
    if (!subscription && transactionInfo.productId) {
      const { data } = await supabase
        .from('subscriptions')
        .select('*, user_id')
        .eq('platform', 'ios')
        .eq('product_id', transactionInfo.productId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        subscription = data;
        logger.info('Apple webhook: Found subscription via product_id fallback', {
          subscriptionId: data.id,
          userId: data.user_id
        });

        // Update the subscription with the real transaction ID for future webhooks
        if (transactionInfo.originalTransactionId && transactionInfo.originalTransactionId !== '0') {
          await supabase
            .from('subscriptions')
            .update({
              original_transaction_id: transactionInfo.originalTransactionId,
              updated_at: new Date().toISOString()
            })
            .eq('id', data.id);
          logger.info('Apple webhook: Updated subscription with original_transaction_id', {
            subscriptionId: data.id,
            originalTransactionId: transactionInfo.originalTransactionId
          });
        }
      }
    }

    if (!subscription) {
      logger.warn('Apple webhook: No subscription found for transaction', {
        originalTransactionId: transactionInfo.originalTransactionId,
        productId: transactionInfo.productId,
        notificationType: payload.notificationType
      });
      return res.json({ success: true }); // Acknowledge receipt
    }

    const userId = subscription.user_id;

    // Map Apple notification types to our event types
    // Note: DID_RENEW can mean trial converted (first payment) or regular renewal
    // We determine this by checking if subscription was previously in trial
    let eventType;
    const baseEventMapping = {
      'SUBSCRIBED': 'subscription_started',
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

    // Special handling for DID_RENEW - check if this is trial conversion or regular renewal
    if (payload.notificationType === 'DID_RENEW') {
      // If subscription was in trial, this is the first payment (trial converted)
      if (subscription.is_trial) {
        eventType = 'trial_converted';
        logger.info('Apple webhook: Trial converted to paid subscription', {
          userId,
          subscriptionId: subscription.id,
          productId: transactionInfo.productId
        });
      } else {
        eventType = 'subscription_renewed';
      }
    } else {
      eventType = baseEventMapping[payload.notificationType];
    }

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
      // For trial_converted events, include price info for revenue tracking
      const eventData = {
        eventType,
        platform: 'ios',
        productId: transactionInfo.productId,
        transactionId: transactionInfo.transactionId,
        originalTransactionId: transactionInfo.originalTransactionId,
        environment: payload.data?.environment || 'production',
        rawNotification: payload
      };

      // Add price from subscription record for revenue events
      if (eventType === 'trial_converted' || eventType === 'subscription_renewed') {
        eventData.priceAmount = subscription.price_amount;
        eventData.priceCurrency = subscription.price_currency || 'USD';
      }

      await logSubscriptionEvent(userId, subscription.id, eventData);
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
// Fix Stale Trials (Scheduled Job Endpoint)
// Called by Cloud Scheduler to auto-fix stale trials
// ============================================
router.post('/fix-stale-trials', asyncHandler(async (req, res) => {
  // Verify this is called by Cloud Scheduler or has admin auth
  const authHeader = req.headers.authorization;
  const schedulerHeader = req.headers['x-cloudscheduler'] || req.headers['x-appengine-cron'];

  // Allow if it's from Cloud Scheduler OR has valid auth token
  if (!schedulerHeader && !authHeader) {
    logger.warn('Fix stale trials: Unauthorized request');
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const now = new Date();
  const nowISO = now.toISOString();

  logger.info('Starting stale trials fix job');

  try {
    // Find stale trials: is_trial=true, trial_end passed, status=active
    const { data: staleTrials, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('is_trial', true)
      .eq('status', 'active')
      .lt('trial_end', nowISO);

    if (fetchError) throw fetchError;

    if (!staleTrials || staleTrials.length === 0) {
      logger.info('No stale trials found');
      return res.json({ success: true, data: { fixed: 0, message: 'No stale trials found' } });
    }

    logger.info(`Found ${staleTrials.length} stale trials to fix`);

    let fixed = 0;
    let errors = 0;
    const results = [];

    for (const subscription of staleTrials) {
      try {
        // Update subscription
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({
            is_trial: false,
            updated_at: nowISO
          })
          .eq('id', subscription.id);

        if (updateError) throw updateError;

        // Log trial_converted event
        await logSubscriptionEvent(subscription.user_id, subscription.id, {
          eventType: 'trial_converted',
          platform: subscription.platform,
          productId: subscription.product_id,
          priceAmount: subscription.price_amount,
          priceCurrency: subscription.price_currency || 'USD',
          environment: 'production',
          metadata: {
            source: 'scheduled_stale_trial_fix',
            trial_end: subscription.trial_end,
            fixed_at: nowISO
          }
        });

        fixed++;
        results.push({
          userId: subscription.user_id,
          subscriptionId: subscription.id,
          status: 'fixed'
        });

        logger.info('Fixed stale trial', {
          userId: subscription.user_id,
          subscriptionId: subscription.id,
          platform: subscription.platform
        });
      } catch (err) {
        errors++;
        results.push({
          userId: subscription.user_id,
          subscriptionId: subscription.id,
          status: 'error',
          error: err.message
        });
        logger.error('Failed to fix stale trial', {
          subscriptionId: subscription.id,
          error: err.message
        });
      }
    }

    logger.info('Stale trials fix job completed', { fixed, errors, total: staleTrials.length });

    res.json({
      success: true,
      data: {
        total: staleTrials.length,
        fixed,
        errors,
        results
      }
    });
  } catch (error) {
    logger.error('Stale trials fix job failed', { error: error.message });
    throw error;
  }
}));

// ============================================
// Request Apple Notification History (Admin endpoint)
// Use this to recover missed webhook notifications
// ============================================
router.post('/apple/request-history', authenticate, asyncHandler(async (req, res) => {
  const { startDate, endDate, notificationType } = req.body;

  logger.info('Requesting Apple notification history', {
    startDate,
    endDate,
    notificationType
  });

  // This requires App Store Server API credentials
  // You need to set up these environment variables:
  // - APPLE_ISSUER_ID: From App Store Connect > Users and Access > Keys
  // - APPLE_KEY_ID: The key ID from the .p8 file
  // - APPLE_PRIVATE_KEY: The contents of the .p8 file (base64 encoded)
  // - APPLE_BUNDLE_ID: Your app's bundle ID

  const requiredEnvVars = ['APPLE_ISSUER_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_BUNDLE_ID'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required environment variables: ${missingVars.join(', ')}`,
      setup: {
        instructions: 'To use the App Store Server API:',
        steps: [
          '1. Go to App Store Connect > Users and Access > Keys > In-App Purchase',
          '2. Generate a new key and download the .p8 file',
          '3. Set APPLE_ISSUER_ID, APPLE_KEY_ID (from key), APPLE_PRIVATE_KEY (base64 of .p8 contents)',
          '4. Set APPLE_BUNDLE_ID to your app bundle ID (e.g., com.kreativekoala.scribeai)'
        ]
      }
    });
  }

  try {
    const jwt = require('jsonwebtoken');

    // Generate JWT token for Apple
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.APPLE_ISSUER_ID,
      iat: now,
      exp: now + 3600, // 1 hour
      aud: 'appstoreconnect-v1',
      bid: process.env.APPLE_BUNDLE_ID
    };

    const privateKey = Buffer.from(process.env.APPLE_PRIVATE_KEY, 'base64').toString('utf8');
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: process.env.APPLE_KEY_ID,
        typ: 'JWT'
      }
    });

    // Request notification history from Apple
    const fetch = require('node-fetch');
    const requestBody = {
      startDate: startDate ? new Date(startDate).getTime() : Date.now() - 90 * 24 * 60 * 60 * 1000, // Default: 90 days ago
      endDate: endDate ? new Date(endDate).getTime() : Date.now()
    };

    if (notificationType) {
      requestBody.notificationType = notificationType;
    }

    const response = await fetch(
      `https://api.storekit.itunes.apple.com/inApps/v1/notifications/history`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Apple API error', { status: response.status, error: errorText });
      return res.status(response.status).json({
        success: false,
        error: `Apple API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    logger.info('Apple notification history received', {
      paginationToken: data.paginationToken,
      notificationCount: data.notificationHistory?.length || 0
    });

    // Process each notification
    const results = [];
    if (data.notificationHistory) {
      for (const signedNotification of data.notificationHistory) {
        try {
          const notification = decodeAppleJWS(signedNotification.signedPayload);
          results.push({
            notificationType: notification.notificationType,
            subtype: notification.subtype,
            environment: notification.data?.environment
          });
        } catch (e) {
          logger.warn('Failed to decode notification', { error: e.message });
        }
      }
    }

    res.json({
      success: true,
      data: {
        paginationToken: data.paginationToken,
        notificationCount: results.length,
        notifications: results
      }
    });
  } catch (error) {
    logger.error('Failed to request Apple notification history', { error: error.message });
    throw error;
  }
}));

// ============================================
// Get transaction history for a user (Admin endpoint)
// Pulls directly from Apple for reconciliation
// ============================================
router.post('/apple/transaction-history', authenticate, asyncHandler(async (req, res) => {
  const { originalTransactionId } = req.body;

  if (!originalTransactionId) {
    return res.status(400).json({
      success: false,
      error: 'Missing originalTransactionId'
    });
  }

  logger.info('Getting Apple transaction history', { originalTransactionId });

  const requiredEnvVars = ['APPLE_ISSUER_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_BUNDLE_ID'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required environment variables: ${missingVars.join(', ')}`
    });
  }

  try {
    const jwt = require('jsonwebtoken');

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: process.env.APPLE_ISSUER_ID,
      iat: now,
      exp: now + 3600,
      aud: 'appstoreconnect-v1',
      bid: process.env.APPLE_BUNDLE_ID
    };

    const privateKey = Buffer.from(process.env.APPLE_PRIVATE_KEY, 'base64').toString('utf8');
    const token = jwt.sign(payload, privateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: process.env.APPLE_KEY_ID,
        typ: 'JWT'
      }
    });

    const fetch = require('node-fetch');
    const response = await fetch(
      `https://api.storekit.itunes.apple.com/inApps/v1/history/${originalTransactionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        success: false,
        error: `Apple API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();

    // Decode transactions
    const transactions = [];
    if (data.signedTransactions) {
      for (const signedTransaction of data.signedTransactions) {
        try {
          const transaction = decodeAppleJWS(signedTransaction);
          transactions.push({
            transactionId: transaction.transactionId,
            originalTransactionId: transaction.originalTransactionId,
            productId: transaction.productId,
            purchaseDate: transaction.purchaseDate ? new Date(transaction.purchaseDate).toISOString() : null,
            expiresDate: transaction.expiresDate ? new Date(transaction.expiresDate).toISOString() : null,
            offerType: transaction.offerType,
            environment: transaction.environment
          });
        } catch (e) {
          logger.warn('Failed to decode transaction', { error: e.message });
        }
      }
    }

    res.json({
      success: true,
      data: {
        bundleId: data.bundleId,
        environment: data.environment,
        transactionCount: transactions.length,
        transactions
      }
    });
  } catch (error) {
    logger.error('Failed to get Apple transaction history', { error: error.message });
    throw error;
  }
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

/**
 * Handle Stripe webhook events - called from app.js
 * This is exported separately because the webhook route needs to be
 * defined before the JSON parser middleware in app.js
 */
async function handleStripeWebhook(event, stripeClient) {
  const subscription = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      // New subscription created via checkout
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const stripeSubscription = await stripeClient.subscriptions.retrieve(session.subscription);
        await handleStripeSubscriptionUpdate(stripeSubscription, 'checkout_completed');
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleStripeSubscriptionUpdate(subscription, event.type);
      break;

    case 'customer.subscription.deleted':
      await handleStripeSubscriptionDeleted(subscription);
      break;

    case 'invoice.payment_succeeded':
      // Renewal successful
      if (subscription.subscription) {
        const sub = await stripeClient.subscriptions.retrieve(subscription.subscription);
        await handleStripeSubscriptionUpdate(sub, 'invoice_paid');
      }
      break;

    case 'invoice.payment_failed':
      // Payment failed - subscription may go to past_due
      logger.info('Stripe payment failed', {
        customerId: subscription.customer,
        subscriptionId: subscription.subscription
      });
      break;
  }
}

// ============================================
// RevenueCat Webhook - Handle subscription events
// ============================================
router.post('/webhook/revenuecat', express.json(), asyncHandler(async (req, res) => {
  const authHeader = req.headers['authorization'];
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;

  if (webhookSecret && authHeader !== webhookSecret) {
    logger.warn('RevenueCat webhook: invalid authorization header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { event } = req.body;
  if (!event) {
    return res.status(400).json({ error: 'Missing event' });
  }

  const {
    type,
    app_user_id,
    product_id,
    period_type,
    expiration_at_ms,
    store,
    price,
    currency
  } = event;

  logger.info('RevenueCat webhook received', { type, app_user_id, product_id });

  // Map RC event types to internal status
  const RC_EVENT_MAP = {
    INITIAL_PURCHASE:     { status: 'active',       is_trial: false },
    RENEWAL:              { status: 'active',       is_trial: false },
    UNCANCELLATION:       { status: 'active',       is_trial: false },
    TRIAL_STARTED:        { status: 'active',       is_trial: true  },
    TRIAL_CONVERTED:      { status: 'active',       is_trial: false },
    TRIAL_CANCELLED:      { status: 'cancelled',    is_trial: true  },
    CANCELLATION:         { status: 'cancelled',    is_trial: false },
    EXPIRATION:           { status: 'expired',      is_trial: false },
    BILLING_ISSUE:        { status: 'grace_period', is_trial: false },
    SUBSCRIPTION_PAUSED:  { status: 'paused',       is_trial: false },
  };

  const statusUpdate = RC_EVENT_MAP[type];
  if (!statusUpdate) {
    logger.info('RevenueCat webhook: unhandled event type', { type });
    return res.status(200).json({ received: true });
  }

  // For INITIAL_PURCHASE, check if it's actually a trial
  if (type === 'INITIAL_PURCHASE' && period_type === 'TRIAL') {
    statusUpdate.status = 'active';
    statusUpdate.is_trial = true;
  }

  const platform = store === 'PLAY_STORE' ? 'android' : 'ios';
  const expirationDate = expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null;

  try {
    // Look up user by RC app_user_id (stored as user ID)
    const { data: subscription, error: fetchErr } = await supabase
      .from('subscriptions')
      .select('id, user_id')
      .eq('user_id', app_user_id)
      .single();

    if (fetchErr || !subscription) {
      logger.warn('RevenueCat webhook: no subscription found for user', { app_user_id });
      return res.status(200).json({ received: true });
    }

    const updateData = {
      ...statusUpdate,
      product_id: product_id || subscription.product_id,
      platform,
      updated_at: new Date().toISOString(),
      ...(expirationDate && { expiration_date: expirationDate }),
      ...(type === 'TRIAL_CONVERTED' && { trial_end: new Date().toISOString() }),
    };

    const { error: updateErr } = await supabase
      .from('subscriptions')
      .update(updateData)
      .eq('user_id', app_user_id);

    if (updateErr) {
      logger.error('RevenueCat webhook: failed to update subscription', { error: updateErr.message, app_user_id });
      return res.status(500).json({ error: 'Failed to update subscription' });
    }

    // Track the event in metrics
    await trackSubscriptionMetric(
      app_user_id,
      null,
      type.toLowerCase(),
      platform,
      'revenuecat_webhook',
      { product_id, price, currency, period_type }
    ).catch(err => logger.warn('RC webhook metric tracking failed', { err: err.message }));

    logger.info('RevenueCat webhook processed', { type, app_user_id, status: statusUpdate.status });
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error('RevenueCat webhook error', { error: err.message });
    res.status(500).json({ error: 'Internal error' });
  }
}));

// Export both router and webhook handler
module.exports = router;
module.exports.handleStripeWebhook = handleStripeWebhook;
