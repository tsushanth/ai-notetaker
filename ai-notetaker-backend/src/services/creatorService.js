/**
 * Creator Service
 * Handles creator registration, promo codes, earnings, and payouts
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const fraudDetection = require('./fraudDetectionService');
const earningMaturityService = require('./earningMaturityService');
const trialAbuseService = require('./trialAbuseService');
const commissionCapService = require('./commissionCapService');

// Note: Discounts removed - iOS/Android app stores don't allow external discount codes
// Promo codes now only extend trial period

/**
 * Generate a unique promo code for a creator
 * Format: SCRIBEAI-<first 3 letters of username><number if clash>
 */
async function generatePromoCode(username) {
  const basePrefix = username.substring(0, 3).toUpperCase();
  let candidateCode = `SCRIBEAI-${basePrefix}`;
  let suffixNum = 1;

  // Check for existing codes and find unique one
  while (true) {
    const { data: existing } = await supabaseAdmin
      .from('promo_codes')
      .select('id')
      .eq('code', candidateCode)
      .single();

    if (!existing) {
      break;
    }

    suffixNum++;
    candidateCode = `SCRIBEAI-${basePrefix}${suffixNum}`;
  }

  return candidateCode;
}

/**
 * Register a new creator
 */
async function registerCreator({
  email,
  name,
  username,
  socialPlatform,
  socialUrl,
  socialFollowers,
  userId = null, // Optional: link to existing Scribe AI user
}) {
  try {
    // Normalize username (lowercase, alphanumeric only)
    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (normalizedUsername.length < 3) {
      throw new Error('Username must be at least 3 characters');
    }

    // Check if email or username already exists
    const { data: existingCreator } = await supabaseAdmin
      .from('creators')
      .select('id, email, username')
      .or(`email.eq.${email},username.eq.${normalizedUsername}`)
      .single();

    if (existingCreator) {
      if (existingCreator.email === email) {
        throw new Error('Email already registered as a creator');
      }
      if (existingCreator.username === normalizedUsername) {
        throw new Error('Username already taken');
      }
    }

    // Create creator record
    const { data: creator, error: createError } = await supabaseAdmin
      .from('creators')
      .insert({
        email,
        name,
        username: normalizedUsername,
        social_platform: socialPlatform,
        social_url: socialUrl,
        social_followers: socialFollowers,
        user_id: userId,
        status: 'active',
        has_premium_access: true,
        revenue_share_percent: 25.00,
        minimum_payout_amount: 50.00,
      })
      .select()
      .single();

    if (createError) {
      logger.error('Error creating creator', { error: createError });
      throw new Error('Failed to create creator account');
    }

    // Generate initial promo code
    const promoCode = await generatePromoCode(normalizedUsername);

    const { data: code, error: codeError } = await supabaseAdmin
      .from('promo_codes')
      .insert({
        creator_id: creator.id,
        code: promoCode,
        is_active: true,
        discount_type: 'none', // Discounts not supported on iOS/Android
        discount_value: 0,
        trial_extension_days: 7, // Extend trial from 7 to 14 days total
      })
      .select()
      .single();

    if (codeError) {
      logger.error('Error creating promo code', { error: codeError });
      // Don't fail registration if promo code fails
    }

    logger.info('Creator registered', {
      creatorId: creator.id,
      email,
      username: normalizedUsername,
      promoCode,
    });

    return {
      creator,
      promoCode: code,
    };
  } catch (error) {
    logger.error('Error in registerCreator', { error: error.message });
    throw error;
  }
}

/**
 * Get creator by user ID
 */
async function getCreatorByUserId(userId) {
  const { data: creator, error } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Error fetching creator by user ID', { error });
  }

  return creator;
}

/**
 * Get creator by email
 */
async function getCreatorByEmail(email) {
  const { data: creator, error } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('email', email)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Error fetching creator by email', { error });
  }

  return creator;
}

/**
 * Get creator by ID
 */
async function getCreatorById(creatorId) {
  const { data: creator, error } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();

  if (error) {
    logger.error('Error fetching creator by ID', { error });
    return null;
  }

  return creator;
}

/**
 * Check if user has already used a promo code
 * Users can only use one promo code
 */
async function hasUserUsedPromoCode(userId) {
  const { data: redemption, error } = await supabaseAdmin
    .from('promo_redemptions')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('Error checking user promo usage', { error, userId });
    return false;
  }

  return !!redemption;
}

/**
 * Validate a promo code
 * Promo codes extend trial period (no discounts - not allowed by iOS/Android stores)
 */
async function validatePromoCode(code, userId = null) {
  const normalizedCode = code.toUpperCase().trim();

  const { data: promoCode, error } = await supabaseAdmin
    .from('promo_codes')
    .select(`
      *,
      creators (
        id,
        name,
        username,
        status
      )
    `)
    .eq('code', normalizedCode)
    .single();

  if (error || !promoCode) {
    return {
      valid: false,
      error: 'Invalid promo code',
    };
  }

  // Check if code is active
  if (!promoCode.is_active) {
    return {
      valid: false,
      error: 'This promo code is no longer active',
    };
  }

  // Check if creator is active
  if (promoCode.creators?.status !== 'active') {
    return {
      valid: false,
      error: 'This promo code is no longer available',
    };
  }

  // Check validity dates
  const now = new Date();
  if (promoCode.valid_from && new Date(promoCode.valid_from) > now) {
    return {
      valid: false,
      error: 'This promo code is not yet active',
    };
  }

  if (promoCode.valid_until && new Date(promoCode.valid_until) < now) {
    return {
      valid: false,
      error: 'This promo code has expired',
    };
  }

  // Check max redemptions
  if (promoCode.max_redemptions && promoCode.current_redemptions >= promoCode.max_redemptions) {
    return {
      valid: false,
      error: 'This promo code has reached its usage limit',
    };
  }

  // Check if user has already used a promo code (if userId provided)
  if (userId) {
    const alreadyUsedPromo = await hasUserUsedPromoCode(userId);
    if (alreadyUsedPromo) {
      return {
        valid: false,
        error: 'You have already used a promo code',
      };
    }
  }

  return {
    valid: true,
    promoCode: {
      id: promoCode.id,
      code: promoCode.code,
      trialExtensionDays: promoCode.trial_extension_days,
    },
    creator: {
      id: promoCode.creators.id,
      name: promoCode.creators.name,
      username: promoCode.creators.username,
    },
  };
}

/**
 * Apply a promo code to a user
 *
 * TRIAL ABUSE PREVENTION:
 * Before allowing promo code application, we check if the user/device/payment
 * has been flagged for trial abuse. This prevents:
 * - Self-referral farms
 * - Mass test account creation
 * - "Infinite free month" abuse via device/card/email cycling
 */
async function applyPromoCode(userId, code, platform = 'web', fingerprints = {}) {
  // Validate code with userId to check discount eligibility
  const validation = await validatePromoCode(code, userId);

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Check if user already has a redemption
  const { data: existingRedemption } = await supabaseAdmin
    .from('promo_redemptions')
    .select('id')
    .eq('user_id', userId)
    .in('attribution_status', ['pending', 'attributed'])
    .single();

  if (existingRedemption) {
    throw new Error('You already have an active promo code');
  }

  // =========================================
  // TRIAL ABUSE CHECK
  // Check if this device/payment/email has been used for trial abuse
  // =========================================
  const { data: user } = await supabaseAdmin
    .from('auth.users')
    .select('email')
    .eq('id', userId)
    .single();

  const userEmail = user?.email || fingerprints.email;

  const trialCheck = await trialAbuseService.checkTrialEligibility({
    userId,
    email: userEmail,
    deviceFingerprint: fingerprints.deviceFingerprint,
    ipAddress: fingerprints.ipAddress,
    paymentMethod: fingerprints.paymentMethod,
    platform,
  });

  if (!trialCheck.eligible) {
    // Log the blocked attempt
    await trialAbuseService.logAbuseEvent('trial_blocked', {
      userId,
      signals: trialCheck.signals,
      abuseScore: trialCheck.abuseScore,
      blockedReason: trialCheck.reason,
      ipAddressHash: fingerprints.ipAddress ? fraudDetection.hashData(fingerprints.ipAddress) : null,
      deviceFingerprintHash: fingerprints.deviceFingerprint ? fraudDetection.hashData(fingerprints.deviceFingerprint) : null,
      platform,
    });

    logger.warn('Promo code application blocked for trial abuse', {
      userId,
      code,
      reason: trialCheck.reason,
      abuseScore: trialCheck.abuseScore,
      signals: trialCheck.signals.map(s => s.type),
    });

    throw new Error(trialCheck.reason || 'Unable to apply promo code. Please contact support.');
  }

  // If flagged but not blocked, log for review
  if (trialCheck.abuseScore > 0) {
    await trialAbuseService.logAbuseEvent('trial_flagged', {
      userId,
      signals: trialCheck.signals,
      abuseScore: trialCheck.abuseScore,
      platform,
    });
  }

  // Prepare fingerprint data for fraud detection
  const deviceFingerprint = fingerprints.deviceFingerprint
    ? fraudDetection.hashData(fingerprints.deviceFingerprint)
    : null;
  const ipAddress = fingerprints.ipAddress
    ? fraudDetection.hashData(fingerprints.ipAddress)
    : null;
  const ipSubnet = fingerprints.ipAddress
    ? fraudDetection.hashData(fraudDetection.getIPSubnet(fingerprints.ipAddress))
    : null;

  // Create redemption record with fingerprints
  // Note: No discount tracking - discounts not allowed by iOS/Android stores
  const { data: redemption, error } = await supabaseAdmin
    .from('promo_redemptions')
    .insert({
      promo_code_id: validation.promoCode.id,
      user_id: userId,
      creator_id: validation.creator.id,
      code_used: code.toUpperCase().trim(),
      platform,
      discount_type: 'none',
      discount_value: 0,
      discount_applied: false,
      attribution_status: 'pending',
      device_fingerprint: deviceFingerprint,
      ip_address: ipAddress,
      ip_subnet: ipSubnet,
      fraud_check_result: trialCheck.abuseScore > 0 ? 'flagged' : 'passed',
    })
    .select()
    .single();

  if (error) {
    logger.error('Error creating redemption', { error });
    throw new Error('Failed to apply promo code');
  }

  // =========================================
  // RECORD TRIAL FINGERPRINT
  // Track this trial for future abuse detection
  // =========================================
  await trialAbuseService.recordTrialStart({
    userId,
    email: userEmail,
    deviceFingerprint: fingerprints.deviceFingerprint,
    ipAddress: fingerprints.ipAddress,
    paymentMethod: fingerprints.paymentMethod,
    platform,
    promoCodeId: validation.promoCode.id,
    creatorId: validation.creator.id,
  });

  // Increment redemption count
  await supabaseAdmin.rpc('increment_promo_redemptions', {
    code_id: validation.promoCode.id,
  });

  // If increment RPC doesn't exist, do it manually
  await supabaseAdmin
    .from('promo_codes')
    .update({
      current_redemptions: supabaseAdmin.raw('current_redemptions + 1'),
    })
    .eq('id', validation.promoCode.id);

  logger.info('Promo code applied', {
    userId,
    code,
    creatorId: validation.creator.id,
    redemptionId: redemption.id,
    trialAbuseScore: trialCheck.abuseScore,
    trialExtensionDays: validation.promoCode.trialExtensionDays,
  });

  return {
    redemption,
    promoCode: validation.promoCode,
    creator: validation.creator,
  };
}

/**
 * Get user's active promo code redemption
 */
async function getUserActiveRedemption(userId) {
  const { data: redemption, error } = await supabaseAdmin
    .from('promo_redemptions')
    .select(`
      *,
      promo_codes (
        code,
        discount_type,
        discount_value,
        trial_extension_days
      ),
      creators (
        id,
        name,
        username
      )
    `)
    .eq('user_id', userId)
    .in('attribution_status', ['pending', 'attributed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Error fetching user redemption', { error });
  }

  return redemption;
}

/**
 * Attribute a subscription to a creator (called when user subscribes)
 *
 * =====================================================
 * COMMISSION CALCULATION RULES (Rule 8)
 * =====================================================
 *
 * Commission = 25% of NET REVENUE after:
 * 1. App Store/Play Store fees (15-30%)
 * 2. Discounts applied to the transaction
 * 3. Any refunds or chargebacks
 *
 * Commission is NOT calculated on:
 * - Gross/list price (what user sees)
 * - Pre-fee value
 * - Post-discount uplift
 *
 * This protects against:
 * - Deep discount stacking abuse
 * - Apple/Google fee shock
 * - Inflated commission claims
 *
 * =====================================================
 * IMPORTANT: No commission given for:
 * - Free trials
 * - $0 charges
 * - Failed or reversed payments
 * - Promo redemptions with no billing
 * =====================================================
 *
 * @param {string} userId - The user who subscribed
 * @param {string} subscriptionId - The subscription ID
 * @param {Object} subscriptionData - Subscription details
 * @param {number} subscriptionData.proceeds_amount - REQUIRED: Amount WE ACTUALLY RECEIVE after App Store fees and discounts. NOT the list price.
 * @param {number} subscriptionData.price_amount - Original list price (for display only, NOT used for commission)
 * @param {number} subscriptionData.discount_amount - Discount applied to this transaction (for tracking)
 * @param {number} subscriptionData.app_store_fee - App store fee amount (for tracking)
 * @param {string} subscriptionData.platform - 'ios', 'android', or 'web'
 * @param {string} subscriptionData.subscriberEmail - Subscriber's email (for fraud check)
 * @param {string} subscriptionData.deviceFingerprint - Device fingerprint (for fraud check)
 * @param {string} subscriptionData.ipAddress - IP address (for fraud check)
 * @param {Object} subscriptionData.paymentMethod - { last4, brand } (for fraud check)
 * @param {string} subscriptionData.billingStatus - 'settled', 'pending', 'failed', 'refunded' (default: 'settled')
 * @param {boolean} subscriptionData.isTrial - Whether this is a trial period (default: false)
 * @param {string} subscriptionData.transactionType - Type of transaction (default: 'subscription_new')
 */
async function attributeSubscription(userId, subscriptionId, subscriptionData) {
  const redemption = await getUserActiveRedemption(userId);

  if (!redemption || redemption.attribution_status !== 'pending') {
    return null; // No pending redemption to attribute
  }

  // =====================================================
  // RULE 8: Commission on NET REVENUE only
  // proceeds_amount = what we ACTUALLY receive after App Store fees and discounts
  // price_amount = list price (for display/tracking only, NOT for commission)
  // =====================================================
  const {
    proceeds_amount,
    price_amount,
    discount_amount = 0,
    app_store_fee = 0,
    platform,
    subscriberEmail,
    deviceFingerprint,
    ipAddress,
    paymentMethod,
    // Billing validation fields
    billingStatus = 'settled',
    isTrial = false,
    transactionType = 'subscription_new',
  } = subscriptionData;

  // =========================================
  // VALIDATION: proceeds_amount is REQUIRED
  // We must know the actual amount we received, not estimate it
  // =========================================
  if (proceeds_amount === undefined || proceeds_amount === null) {
    logger.error('proceeds_amount is required for commission calculation', {
      userId,
      subscriptionId,
      price_amount,
      platform,
    });

    // Don't calculate commission without actual proceeds - this prevents
    // accidental use of list price for commission
    return {
      redemption,
      earning: null,
      skipped: true,
      reason: 'missing_proceeds_amount',
      message: 'Cannot calculate commission without actual proceeds amount',
    };
  }

  // =========================================
  // EARLY EXIT: Skip attribution for trials
  // =========================================
  if (isTrial || transactionType === 'trial_start') {
    logger.info('Skipping attribution for trial subscription', {
      userId,
      subscriptionId,
      transactionType,
    });

    // Update redemption to track trial (but don't attribute yet)
    await supabaseAdmin
      .from('promo_redemptions')
      .update({
        attribution_status: 'pending_trial', // New status for trials
        trial_started_at: new Date().toISOString(),
      })
      .eq('id', redemption.id);

    return {
      redemption,
      earning: null,
      skipped: true,
      reason: 'trial_period',
      message: 'Attribution deferred until trial converts to paid',
    };
  }

  // =========================================
  // RULE 8: Use actual proceeds, not list price
  // proceeds_amount is the NET amount after:
  // - App Store/Play Store fees (15-30%)
  // - Any discounts applied
  // =========================================
  const grossAmount = proceeds_amount; // This is NET of app store fees

  // Log for audit trail - shows the full breakdown
  logger.info('Commission calculation breakdown', {
    userId,
    subscriptionId,
    listPrice: price_amount,
    discountApplied: discount_amount,
    appStoreFee: app_store_fee,
    proceedsReceived: proceeds_amount,
    platform,
  });

  // =========================================
  // EARLY EXIT: Skip attribution for $0 charges
  // =========================================
  if (grossAmount <= 0) {
    logger.info('Skipping attribution for $0 charge', {
      userId,
      subscriptionId,
      grossAmount,
    });

    return {
      redemption,
      earning: null,
      skipped: true,
      reason: 'zero_amount',
      message: 'No attribution for $0 charges',
    };
  }

  // =========================================
  // EARLY EXIT: Skip attribution for non-settled payments
  // =========================================
  const invalidBillingStatuses = ['failed', 'pending', 'refunded', 'reversed', 'disputed'];
  if (invalidBillingStatuses.includes(billingStatus)) {
    logger.info('Skipping attribution for non-settled payment', {
      userId,
      subscriptionId,
      billingStatus,
    });

    return {
      redemption,
      earning: null,
      skipped: true,
      reason: `billing_${billingStatus}`,
      message: `No attribution for ${billingStatus} payments`,
    };
  }

  // =========================================
  // FRAUD DETECTION - Check for self-referral
  // =========================================
  const fraudCheck = await fraudDetection.checkForFraud({
    creatorId: redemption.creator_id,
    subscriberUserId: userId,
    subscriberEmail,
    deviceFingerprint,
    ipAddress,
    paymentMethod,
    redemptionId: redemption.id,
  });

  // Update redemption status
  await supabaseAdmin
    .from('promo_redemptions')
    .update({
      attribution_status: 'attributed',
      attributed_at: new Date().toISOString(),
    })
    .eq('id', redemption.id);

  // Update subscription with creator attribution
  await supabaseAdmin
    .from('subscriptions')
    .update({
      promo_code_id: redemption.promo_code_id,
      creator_id: redemption.creator_id,
      discount_applied: redemption.discount_value || 0,
    })
    .eq('id', subscriptionId);

  // Calculate and record earnings
  // If fraud is detected, earning is $0 but still recorded for tracking
  const earning = await recordCreatorEarning({
    creatorId: redemption.creator_id,
    redemptionId: redemption.id,
    subscriptionId,
    userId,
    grossAmount: fraudCheck.blocked ? 0 : grossAmount, // $0 if fraud detected
    platform,
    transactionType,
    userPaidAmount: price_amount,
    fraudBlocked: fraudCheck.blocked,
    fraudReason: fraudCheck.reason,
    billingStatus,
    isTrial: false, // Already filtered out above
    isPromoOnly: false,
  });

  // Handle skipped earnings (shouldn't happen due to early exits, but be safe)
  if (earning?.skipped) {
    logger.info('Earning skipped during attribution', {
      userId,
      subscriptionId,
      reason: earning.reason,
    });
    return {
      redemption,
      earning: null,
      skipped: true,
      reason: earning.reason,
      message: earning.message,
    };
  }

  if (fraudCheck.blocked) {
    logger.warn('Creator earning blocked due to fraud detection', {
      userId,
      subscriptionId,
      creatorId: redemption.creator_id,
      reason: fraudCheck.reason,
      signals: fraudCheck.signals,
    });
  } else {
    logger.info('Subscription attributed to creator', {
      userId,
      subscriptionId,
      creatorId: redemption.creator_id,
      earningId: earning?.id,
    });
  }

  return {
    redemption,
    earning,
    fraudBlocked: fraudCheck.blocked,
    fraudReason: fraudCheck.reason,
  };
}

/**
 * Handle trial conversion to paid subscription
 * Called when a user's trial ends and they convert to a paying customer
 *
 * This function:
 * 1. Finds the pending_trial redemption
 * 2. Attributes the subscription now that billing has occurred
 * 3. Creates the earning record
 *
 * @param {string} userId - The user who converted
 * @param {string} subscriptionId - The subscription ID
 * @param {Object} conversionData - Conversion details
 */
async function handleTrialConversion(userId, subscriptionId, conversionData) {
  const {
    proceeds_amount,
    price_amount,
    platform,
    subscriberEmail,
    deviceFingerprint,
    ipAddress,
    paymentMethod,
  } = conversionData;

  // Find the pending_trial redemption for this user
  const { data: redemption, error: redemptionError } = await supabaseAdmin
    .from('promo_redemptions')
    .select(`
      *,
      promo_codes (
        code,
        discount_type,
        discount_value
      ),
      creators (
        id,
        name,
        username
      )
    `)
    .eq('user_id', userId)
    .eq('attribution_status', 'pending_trial')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (redemptionError || !redemption) {
    logger.info('No pending trial redemption found for conversion', {
      userId,
      subscriptionId,
    });
    return null;
  }

  logger.info('Processing trial conversion for creator attribution', {
    userId,
    subscriptionId,
    redemptionId: redemption.id,
    creatorId: redemption.creator_id,
  });

  // Now attribute the subscription (trial is over, payment happened)
  const result = await attributeSubscription(userId, subscriptionId, {
    proceeds_amount,
    price_amount,
    platform,
    subscriberEmail,
    deviceFingerprint,
    ipAddress,
    paymentMethod,
    billingStatus: 'settled',
    isTrial: false,
    transactionType: 'trial_conversion',
  });

  if (result?.skipped) {
    logger.info('Trial conversion attribution skipped', {
      userId,
      subscriptionId,
      reason: result.reason,
    });
  } else if (result?.earning) {
    logger.info('Trial conversion attributed successfully', {
      userId,
      subscriptionId,
      earningId: result.earning.id,
      creatorId: redemption.creator_id,
    });
  }

  return result;
}

/**
 * Record creator earning from a subscription
 *
 * =====================================================
 * RULE 8: COMMISSION ON NET REVENUE ONLY
 * =====================================================
 *
 * Commission = 25% of NET REVENUE
 *
 * NET REVENUE is calculated as:
 * - Amount we ACTUALLY receive (after app store fees and discounts)
 * - MINUS Scribe AI platform fee (15%)
 *
 * Commission is NEVER calculated on:
 * - List/gross price (what user sees in the app)
 * - Pre-fee value
 * - Post-discount uplift
 *
 * This protects against:
 * - Deep discount stacking abuse
 * - Apple/Google fee shock
 * - Inflated commission claims
 *
 * =====================================================
 * CALCULATION FLOW
 * =====================================================
 *
 * 1. User pays subscription price to App Store/Play Store
 * 2. App Store takes their cut (15-30%)
 * 3. grossAmount = what we receive AFTER app store fees and discounts
 * 4. Scribe AI platform fee (15%) is calculated on grossAmount
 * 5. Creator gets 25% of net revenue after platform fee
 *
 * =====================================================
 * EXAMPLE: $10/month with 10% creator discount on iOS
 * =====================================================
 *
 * 1. List price: $10.00
 * 2. Creator discount (10%): -$1.00
 * 3. User pays: $9.00
 * 4. App Store fee (30%): -$2.70
 * 5. We receive (grossAmount): $6.30  <-- THIS is what we use
 * 6. Scribe AI platform fee (15%): -$0.95
 * 7. Net revenue: $5.35
 * 8. Creator share (25% of net): $1.34
 *
 * WRONG calculations:
 * - 25% of $10.00 = $2.50 (WRONG - uses list price)
 * - 25% of $9.00 = $2.25 (WRONG - uses pre-fee amount)
 *
 * @param {number} grossAmount - Amount WE RECEIVE after App Store fees and discounts. NOT list price.
 */
async function recordCreatorEarning({
  creatorId,
  redemptionId,
  subscriptionId,
  userId,
  grossAmount, // CRITICAL: Amount WE RECEIVE after App Store fees, NOT list price
  platform,
  transactionType = 'subscription_new',
  discountAmount = 0, // For tracking/display only, NOT used in calculation
  userPaidAmount = null, // For tracking/display only, NOT used in calculation
  listPrice = null, // For tracking/display only, NOT used in calculation
  appStoreFee = null, // For tracking/display only, NOT used in calculation
  fraudBlocked = false, // Was this earning blocked due to fraud?
  fraudReason = null, // Reason for fraud block
  // Billing validation fields
  billingStatus = 'settled', // 'settled', 'pending', 'failed', 'refunded', 'trial'
  isTrial = false, // Is this a trial period?
  isPromoOnly = false, // Was this a 100% promo redemption with no billing?
}) {
  // =========================================
  // BILLING VALIDATION - No commission on:
  // 1. Free trials
  // 2. $0 charges
  // 3. Failed or reversed payments
  // 4. Promo redemptions with no billing
  // =========================================

  // Check 1: Free trials - no commission
  if (isTrial || transactionType === 'trial_start') {
    logger.info('Skipping commission for trial period', {
      creatorId,
      subscriptionId,
      transactionType,
    });
    return {
      skipped: true,
      reason: 'trial_period',
      message: 'No commission on free trials',
    };
  }

  // Check 2: $0 charges - no commission
  if (grossAmount <= 0 && !fraudBlocked) {
    logger.info('Skipping commission for $0 charge', {
      creatorId,
      subscriptionId,
      grossAmount,
    });
    return {
      skipped: true,
      reason: 'zero_amount',
      message: 'No commission on $0 charges',
    };
  }

  // Check 3: Failed or pending payments - no commission until settled
  const invalidBillingStatuses = ['failed', 'pending', 'refunded', 'reversed', 'disputed'];
  if (invalidBillingStatuses.includes(billingStatus)) {
    logger.info('Skipping commission for non-settled payment', {
      creatorId,
      subscriptionId,
      billingStatus,
    });
    return {
      skipped: true,
      reason: `billing_${billingStatus}`,
      message: `No commission on ${billingStatus} payments`,
    };
  }

  // Check 4: Promo-only redemptions with no actual billing
  if (isPromoOnly) {
    logger.info('Skipping commission for promo-only redemption', {
      creatorId,
      subscriptionId,
    });
    return {
      skipped: true,
      reason: 'promo_only',
      message: 'No commission on unbilled promo redemptions',
    };
  }

  // Get creator's revenue share percentage
  const creator = await getCreatorById(creatorId);
  if (!creator) {
    logger.error('Creator not found for earning', { creatorId });
    return null;
  }

  // If fraud blocked, all amounts are $0
  const effectiveGrossAmount = fraudBlocked ? 0 : grossAmount;

  // Scribe AI platform fee (15%) - applied to what we receive after App Store fees
  const platformFeePercent = 15;
  const platformFeeAmount = effectiveGrossAmount * (platformFeePercent / 100);
  const netRevenue = effectiveGrossAmount - platformFeeAmount;

  // Calculate creator earning based on net revenue after platform fee
  // Creator earnings are calculated on what's left after both:
  // 1. App Store took their cut (already reflected in grossAmount)
  // 2. Scribe AI platform fee (15%)
  const revenueSharePercent = parseFloat(creator.revenue_share_percent) || 25;

  // =====================================================
  // RULE 9: Apply commission caps
  // =====================================================
  // Calculate commission with caps applied (tiered rates and/or monthly max)
  const cappedResult = await commissionCapService.calculateCappedCommission(
    creatorId,
    netRevenue,
    revenueSharePercent
  );

  // Use the capped commission amount
  const creatorEarning = fraudBlocked ? 0 : cappedResult.finalCommission;

  // Log cap application for audit trail
  if (cappedResult.wasCapped && !fraudBlocked) {
    logger.info('Commission cap applied', {
      creatorId,
      subscriptionId,
      originalCommission: cappedResult.originalCommission,
      finalCommission: cappedResult.finalCommission,
      capType: cappedResult.capType,
      tierApplied: cappedResult.tierApplied,
      effectiveRate: cappedResult.effectiveRate,
      remainingMonthlyCap: cappedResult.remainingMonthlyCap,
    });
  }

  const { data: earning, error } = await supabaseAdmin
    .from('creator_earnings')
    .insert({
      creator_id: creatorId,
      redemption_id: redemptionId,
      subscription_id: subscriptionId,
      user_id: userId,
      transaction_type: transactionType,
      gross_amount: effectiveGrossAmount,
      platform_fee_percent: platformFeePercent,
      platform_fee_amount: platformFeeAmount,
      net_revenue: netRevenue,
      revenue_share_percent: revenueSharePercent,
      creator_earning: creatorEarning,
      currency: 'USD',
      status: fraudBlocked ? 'held' : 'pending', // Hold if fraud detected
      fraud_blocked: fraudBlocked,
      fraud_reason: fraudReason,
      // Rule 9: Commission cap fields
      original_commission: cappedResult.originalCommission,
      was_capped: cappedResult.wasCapped,
      cap_type_applied: cappedResult.capType,
      effective_rate_percent: cappedResult.effectiveRate,
      tier_applied: cappedResult.tierApplied,
      metadata: {
        // Full breakdown for audit trail (Rule 8 compliance)
        list_price: listPrice,
        discount_amount: discountAmount,
        user_paid_amount: userPaidAmount,
        app_store_fee: appStoreFee,
        proceeds_received: grossAmount, // What we actually received
        original_gross_amount: fraudBlocked ? grossAmount : null,
        // Calculation verification
        calculation_basis: 'net_revenue', // NOT list_price
        platform_fee_applied: platformFeePercent,
        // Rule 9: Commission cap tracking
        commission_cap: {
          original_commission: cappedResult.originalCommission,
          final_commission: cappedResult.finalCommission,
          was_capped: cappedResult.wasCapped,
          cap_type: cappedResult.capType,
          tier_applied: cappedResult.tierApplied,
          effective_rate: cappedResult.effectiveRate,
          remaining_monthly_cap: cappedResult.remainingMonthlyCap,
          cap_savings: cappedResult.capSavings,
          in_grace_period: cappedResult.inGracePeriod,
        },
      },
    })
    .select()
    .single();

  if (error) {
    logger.error('Error recording creator earning', { error });
    return null;
  }

  // =====================================================
  // RULE 9: Update monthly commission tracking
  // =====================================================
  // Update the monthly tracking record with this earning (only if not fraud blocked)
  if (!fraudBlocked && creatorEarning > 0) {
    await commissionCapService.updateMonthlyCommissionTracking(creatorId, {
      originalCommission: cappedResult.originalCommission,
      finalCommission: cappedResult.finalCommission,
      tierApplied: cappedResult.tierApplied,
      wasCapped: cappedResult.wasCapped,
      capType: cappedResult.capType,
    });
  }

  logger.info('Creator earning recorded', {
    creatorId,
    earningId: earning.id,
    grossAmount: effectiveGrossAmount,
    creatorEarning,
    originalCommission: cappedResult.originalCommission,
    wasCapped: cappedResult.wasCapped,
    capType: cappedResult.capType,
    tierApplied: cappedResult.tierApplied,
    fraudBlocked,
    fraudReason,
  });

  return earning;
}

/**
 * Get creator's promo codes
 */
async function getCreatorPromoCodes(creatorId) {
  const { data: codes, error } = await supabaseAdmin
    .from('promo_codes')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Error fetching creator promo codes', { error });
    return [];
  }

  return codes;
}

/**
 * Create a new promo code for a creator
 *
 * IMPORTANT: Discount rules:
 * - Maximum 10% discount allowed
 * - Discounts apply to first month only
 * - Fixed amount discounts are not supported
 * - Discount costs are absorbed by the creator (their earnings are calculated on discounted amount)
 */
async function createPromoCode(creatorId, {
  discountType = 'none',
  discountValue = 0,
  trialExtensionDays = 0,
  validUntil = null,
  maxRedemptions = null,
}) {
  // Validate discount rules
  if (discountType === 'fixed') {
    throw new Error('Fixed amount discounts are not supported. Use percentage discount (max 10%).');
  }

  if (discountType === 'percent' && (discountValue < 0 || discountValue > 10)) {
    throw new Error('Discount percentage must be between 0 and 10%.');
  }

  const creator = await getCreatorById(creatorId);
  if (!creator) {
    throw new Error('Creator not found');
  }

  const code = await generatePromoCode(creator.username);

  const { data: promoCode, error } = await supabaseAdmin
    .from('promo_codes')
    .insert({
      creator_id: creatorId,
      code,
      is_active: true,
      discount_type: discountType,
      discount_value: discountValue,
      trial_extension_days: trialExtensionDays,
      valid_until: validUntil,
      max_redemptions: maxRedemptions,
    })
    .select()
    .single();

  if (error) {
    logger.error('Error creating promo code', { error });
    throw new Error('Failed to create promo code');
  }

  return promoCode;
}

/**
 * Get creator dashboard stats
 * Now includes maturity-aware earnings breakdown
 */
async function getCreatorDashboard(creatorId) {
  // Get detailed earnings summary with maturity status
  const earningsSummary = await earningMaturityService.getCreatorEarningsSummary(creatorId);

  // Get all earnings for this month calculation
  const { data: earningsData } = await supabaseAdmin
    .from('creator_earnings')
    .select('creator_earning, status, created_at')
    .eq('creator_id', creatorId)
    .not('status', 'in', '(cancelled,clawback,rejected,held)');

  // This month's earnings (all statuses that count)
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const thisMonthEarnings = earningsData?.filter(e =>
    new Date(e.created_at) >= startOfMonth
  ).reduce((sum, e) => sum + parseFloat(e.creator_earning), 0) || 0;

  // Get promo code stats
  const { data: promoCodes } = await supabaseAdmin
    .from('promo_codes')
    .select('id, code, current_redemptions, is_active')
    .eq('creator_id', creatorId);

  const totalRedemptions = promoCodes?.reduce((sum, c) => sum + (c.current_redemptions || 0), 0) || 0;
  const activeCodesCount = promoCodes?.filter(c => c.is_active).length || 0;

  // Get conversion count
  const { count: conversions } = await supabaseAdmin
    .from('promo_redemptions')
    .select('id', { count: 'exact' })
    .eq('creator_id', creatorId)
    .eq('attribution_status', 'attributed');

  return {
    // Legacy fields for backwards compatibility
    totalEarnings: earningsSummary.totalEarned,
    pendingEarnings: earningsSummary.pendingMaturity, // Maturing earnings
    thisMonthEarnings,

    // New maturity-aware fields
    earnings: {
      maturing: earningsSummary.maturing,           // { count, total, nextMaturity }
      approved: earningsSummary.approved,           // { count, total } - ready for payout
      paid: earningsSummary.paid,                   // { count, total } - already paid out
      clawbacks: earningsSummary.clawbacks,         // { count, total } - clawed back
      availableForPayout: earningsSummary.availableForPayout, // Amount ready for next payout
      totalEarned: earningsSummary.totalEarned,     // Lifetime earnings
    },

    // Promo stats
    totalRedemptions,
    conversions: conversions || 0,
    conversionRate: totalRedemptions > 0 ? ((conversions || 0) / totalRedemptions * 100).toFixed(1) : 0,
    activeCodesCount,
    promoCodes: promoCodes || [],
  };
}

/**
 * Get creator earnings history
 */
async function getCreatorEarnings(creatorId, { limit = 50, offset = 0 } = {}) {
  const { data: earnings, error, count } = await supabaseAdmin
    .from('creator_earnings')
    .select('*', { count: 'exact' })
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Error fetching creator earnings', { error });
    return { earnings: [], total: 0 };
  }

  return { earnings, total: count };
}

/**
 * Get creator payouts history
 */
async function getCreatorPayouts(creatorId, { limit = 50, offset = 0 } = {}) {
  const { data: payouts, error, count } = await supabaseAdmin
    .from('creator_payouts')
    .select('*', { count: 'exact' })
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Error fetching creator payouts', { error });
    return { payouts: [], total: 0 };
  }

  return { payouts, total: count };
}

/**
 * Check if user has creator premium access
 */
async function hasCreatorPremiumAccess(userId) {
  const creator = await getCreatorByUserId(userId);
  return creator?.has_premium_access && creator?.status === 'active';
}

/**
 * Link existing Scribe AI user to creator account
 */
async function linkUserToCreator(creatorId, userId) {
  const { error } = await supabaseAdmin
    .from('creators')
    .update({ user_id: userId })
    .eq('id', creatorId);

  if (error) {
    logger.error('Error linking user to creator', { error });
    throw new Error('Failed to link user account');
  }

  return true;
}

/**
 * Update creator profile
 */
async function updateCreatorProfile(creatorId, updates) {
  const allowedFields = [
    'name',
    'social_platform',
    'social_url',
    'social_followers',
  ];

  const filteredUpdates = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field];
    }
  }

  const { data: creator, error } = await supabaseAdmin
    .from('creators')
    .update(filteredUpdates)
    .eq('id', creatorId)
    .select()
    .single();

  if (error) {
    logger.error('Error updating creator profile', { error });
    throw new Error('Failed to update profile');
  }

  return creator;
}

/**
 * Register creator's fingerprints for fraud detection
 * Delegates to fraudDetection service
 */
async function registerCreatorFingerprints(creatorId, fingerprints) {
  return fraudDetection.registerCreatorFingerprints(creatorId, fingerprints);
}

/**
 * =====================================================
 * RULE 8: Commission Calculation Helper
 * =====================================================
 *
 * Calculate the correct proceeds amount for commission calculation.
 * This helper ensures commission is ALWAYS based on net revenue,
 * never on list price or pre-fee amounts.
 *
 * Use this when you have raw subscription data and need to calculate
 * the proper proceeds_amount for attributeSubscription().
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.listPrice - Original list price (what user sees)
 * @param {number} params.discountPercent - Discount percentage applied (0-10)
 * @param {string} params.platform - 'ios', 'android', or 'web'
 * @param {number} params.customAppStoreFeePercent - Override default fee (optional)
 *
 * @returns {Object} {
 *   proceeds_amount: number,  // Use this for commission calculation
 *   breakdown: {
 *     listPrice: number,
 *     discountAmount: number,
 *     userPaidAmount: number,
 *     appStoreFeePercent: number,
 *     appStoreFee: number,
 *     proceedsReceived: number
 *   }
 * }
 */
function calculateProceedsAmount({
  listPrice,
  discountPercent = 0,
  platform,
  customAppStoreFeePercent = null,
}) {
  // Validate inputs
  if (!listPrice || listPrice <= 0) {
    return {
      proceeds_amount: 0,
      breakdown: {
        listPrice: 0,
        discountAmount: 0,
        userPaidAmount: 0,
        appStoreFeePercent: 0,
        appStoreFee: 0,
        proceedsReceived: 0,
      },
    };
  }

  // Default app store fees by platform
  // Apple: 30% (15% for Small Business Program)
  // Google: 15% (first $1M) or 30%
  // Web: 0% (Stripe ~3% but we handle that separately)
  const defaultFees = {
    ios: 30,
    android: 15, // Assuming Small Business rate
    web: 0,
  };

  const appStoreFeePercent = customAppStoreFeePercent ?? defaultFees[platform] ?? 30;

  // Calculate amounts
  const discountAmount = listPrice * (discountPercent / 100);
  const userPaidAmount = listPrice - discountAmount;
  const appStoreFee = userPaidAmount * (appStoreFeePercent / 100);
  const proceedsReceived = userPaidAmount - appStoreFee;

  return {
    proceeds_amount: proceedsReceived,
    breakdown: {
      listPrice,
      discountAmount,
      userPaidAmount,
      appStoreFeePercent,
      appStoreFee,
      proceedsReceived,
    },
  };
}

/**
 * Calculate creator commission preview
 *
 * Use this to show creators what they would earn from a subscription.
 * Useful for dashboard displays and commission estimates.
 *
 * @param {number} proceedsAmount - What we receive after app store fees
 * @param {number} revenueSharePercent - Creator's revenue share (default 25%)
 * @param {number} platformFeePercent - Scribe AI platform fee (default 15%)
 *
 * @returns {Object} {
 *   creatorEarning: number,
 *   netRevenue: number,
 *   platformFee: number
 * }
 */
function calculateCommissionPreview(
  proceedsAmount,
  revenueSharePercent = 25,
  platformFeePercent = 15
) {
  const platformFee = proceedsAmount * (platformFeePercent / 100);
  const netRevenue = proceedsAmount - platformFee;
  const creatorEarning = netRevenue * (revenueSharePercent / 100);

  return {
    creatorEarning: Math.round(creatorEarning * 100) / 100, // Round to cents
    netRevenue: Math.round(netRevenue * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
  };
}

/**
 * =====================================================
 * RULE 9: Commission Cap Status
 * =====================================================
 *
 * Get creator's current month commission cap status.
 * Useful for dashboard display and showing creators:
 * - How much they've earned this month
 * - How close they are to their monthly cap
 * - What tier they're currently in
 * - How many referrals until the next tier
 *
 * @param {string} creatorId - Creator's ID
 * @returns {Object} Commission cap status
 */
async function getCreatorCommissionCapStatus(creatorId) {
  return commissionCapService.getCreatorMonthlyStatus(creatorId);
}

module.exports = {
  generatePromoCode,
  registerCreator,
  getCreatorByUserId,
  getCreatorByEmail,
  getCreatorById,
  validatePromoCode,
  applyPromoCode,
  getUserActiveRedemption,
  attributeSubscription,
  handleTrialConversion,
  recordCreatorEarning,
  getCreatorPromoCodes,
  createPromoCode,
  getCreatorDashboard,
  getCreatorEarnings,
  getCreatorPayouts,
  hasCreatorPremiumAccess,
  linkUserToCreator,
  updateCreatorProfile,
  registerCreatorFingerprints,
  // Rule 8 helpers
  calculateProceedsAmount,
  calculateCommissionPreview,
  // Rule 9 helpers
  getCreatorCommissionCapStatus,
};
