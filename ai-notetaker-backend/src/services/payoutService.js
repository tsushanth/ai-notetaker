/**
 * Payout Service
 * Handles monthly creator payouts via Stripe Connect
 *
 * PAYOUT RULES:
 * - Only 'approved' earnings are eligible for payout
 * - Minimum payout amount: $50 (configurable per creator)
 * - Payouts run monthly (1st of each month)
 * - Creators must have completed Stripe Connect onboarding
 * - Clawbacks are deducted from available balance
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const earningMaturityService = require('./earningMaturityService');

// Stripe will be initialized when needed
let stripe = null;
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/**
 * Process monthly payouts for all eligible creators
 * Should be run on the 1st of each month via cron job
 */
async function processMonthlyPayouts() {
  const now = new Date();
  logger.info('Starting monthly payout processing', { timestamp: now.toISOString() });

  // Get all creators with approved earnings
  const { data: creatorsWithEarnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .select(`
      creator_id,
      creators:creator_id (
        id,
        name,
        email,
        stripe_connect_account_id,
        stripe_account_status,
        minimum_payout_amount,
        status
      )
    `)
    .eq('status', 'approved')
    .not('creators', 'is', null);

  if (error) {
    logger.error('Error fetching creators with approved earnings', { error });
    return { processed: 0, successful: 0, failed: 0, skipped: 0 };
  }

  // Group by creator and dedupe
  const creatorMap = new Map();
  for (const record of creatorsWithEarnings || []) {
    if (record.creators && !creatorMap.has(record.creator_id)) {
      creatorMap.set(record.creator_id, record.creators);
    }
  }

  logger.info(`Found ${creatorMap.size} creators with approved earnings`);

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const [creatorId, creator] of creatorMap) {
    try {
      const result = await processCreatorPayout(creatorId, creator);
      if (result.success) {
        successful++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
      }
    } catch (err) {
      logger.error('Error processing creator payout', {
        creatorId,
        error: err.message,
      });
      failed++;
    }
  }

  logger.info('Monthly payout processing complete', {
    processed: creatorMap.size,
    successful,
    failed,
    skipped,
  });

  return {
    processed: creatorMap.size,
    successful,
    failed,
    skipped,
  };
}

/**
 * Process payout for a single creator
 */
async function processCreatorPayout(creatorId, creator) {
  // Check creator status
  if (creator.status !== 'active') {
    logger.info('Skipping payout for inactive creator', { creatorId });
    return { success: false, skipped: true, reason: 'creator_inactive' };
  }

  // Check Stripe Connect account
  if (!creator.stripe_connect_account_id) {
    logger.info('Skipping payout - no Stripe Connect account', { creatorId });
    return { success: false, skipped: true, reason: 'no_stripe_account' };
  }

  if (creator.stripe_account_status !== 'complete') {
    logger.info('Skipping payout - Stripe onboarding incomplete', { creatorId });
    return { success: false, skipped: true, reason: 'stripe_incomplete' };
  }

  // Get earnings summary including any pending clawbacks
  const summary = await earningMaturityService.getCreatorEarningsSummary(creatorId);

  // Calculate available amount (approved earnings minus any pending clawbacks)
  const availableAmount = summary.availableForPayout;

  // Check minimum payout amount
  const minimumPayout = parseFloat(creator.minimum_payout_amount) || 50;
  if (availableAmount < minimumPayout) {
    logger.info('Skipping payout - below minimum threshold', {
      creatorId,
      availableAmount,
      minimumPayout,
    });
    return { success: false, skipped: true, reason: 'below_minimum' };
  }

  // Get the actual approved earnings
  const approvedEarnings = await earningMaturityService.getApprovedEarningsForPayout(creatorId);

  if (approvedEarnings.length === 0) {
    return { success: false, skipped: true, reason: 'no_approved_earnings' };
  }

  // Create payout record
  const { data: payout, error: payoutError } = await supabaseAdmin
    .from('creator_payouts')
    .insert({
      creator_id: creatorId,
      amount: availableAmount,
      currency: 'USD',
      status: 'pending',
      earnings_count: approvedEarnings.length,
      initiated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (payoutError) {
    logger.error('Error creating payout record', { error: payoutError });
    throw payoutError;
  }

  try {
    // Process Stripe transfer
    const stripeResult = await createStripeTransfer(
      creator.stripe_connect_account_id,
      Math.round(availableAmount * 100), // Convert to cents
      payout.id
    );

    // Update payout with Stripe details
    await supabaseAdmin
      .from('creator_payouts')
      .update({
        status: 'completed',
        stripe_transfer_id: stripeResult.id,
        completed_at: new Date().toISOString(),
      })
      .eq('id', payout.id);

    // Mark all earnings as paid
    const earningIds = approvedEarnings.map(e => e.id);
    await earningMaturityService.markEarningsAsPaid(earningIds, payout.id);

    logger.info('Payout completed successfully', {
      creatorId,
      payoutId: payout.id,
      amount: availableAmount,
      earningsCount: approvedEarnings.length,
      stripeTransferId: stripeResult.id,
    });

    return { success: true, payoutId: payout.id, amount: availableAmount };
  } catch (stripeError) {
    // Update payout as failed
    await supabaseAdmin
      .from('creator_payouts')
      .update({
        status: 'failed',
        failure_reason: stripeError.message,
      })
      .eq('id', payout.id);

    logger.error('Stripe transfer failed', {
      creatorId,
      payoutId: payout.id,
      error: stripeError.message,
    });

    return { success: false, skipped: false, reason: 'stripe_transfer_failed' };
  }
}

/**
 * Create Stripe transfer to connected account
 */
async function createStripeTransfer(stripeAccountId, amountCents, payoutId) {
  const stripeClient = getStripe();

  if (!stripeClient) {
    throw new Error('Stripe not configured');
  }

  try {
    const transfer = await stripeClient.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: stripeAccountId,
      metadata: {
        payout_id: payoutId,
        source: 'scribeai_creator_payout',
      },
    });

    return transfer;
  } catch (error) {
    logger.error('Stripe transfer error', {
      stripeAccountId,
      amountCents,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get payout history for a creator
 */
async function getCreatorPayoutHistory(creatorId, { limit = 20, offset = 0 } = {}) {
  const { data: payouts, error, count } = await supabaseAdmin
    .from('creator_payouts')
    .select('*', { count: 'exact' })
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Error fetching payout history', { error });
    return { payouts: [], total: 0 };
  }

  return { payouts: payouts || [], total: count || 0 };
}

/**
 * Get next payout estimate for a creator
 */
async function getNextPayoutEstimate(creatorId) {
  const summary = await earningMaturityService.getCreatorEarningsSummary(creatorId);

  // Get creator's minimum payout
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('minimum_payout_amount, stripe_account_status')
    .eq('id', creatorId)
    .single();

  const minimumPayout = parseFloat(creator?.minimum_payout_amount) || 50;
  const stripeReady = creator?.stripe_account_status === 'complete';

  // Calculate when maturing earnings will become available
  const { data: nextMaturing } = await supabaseAdmin
    .from('creator_earnings')
    .select('matures_at, creator_earning')
    .eq('creator_id', creatorId)
    .eq('status', 'maturing')
    .order('matures_at', { ascending: true })
    .limit(1)
    .single();

  // Next payout date is 1st of next month
  const now = new Date();
  const nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    availableNow: summary.availableForPayout,
    pendingMaturity: summary.pendingMaturity,
    totalEarned: summary.totalEarned,
    minimumPayout,
    meetsMinimum: summary.availableForPayout >= minimumPayout,
    stripeReady,
    nextPayoutDate: nextPayoutDate.toISOString(),
    nextMaturityDate: nextMaturing?.matures_at || null,
    estimatedNextPayout: summary.availableForPayout >= minimumPayout && stripeReady
      ? summary.availableForPayout
      : 0,
  };
}

/**
 * Request manual payout (if above minimum and approved)
 */
async function requestManualPayout(creatorId) {
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();

  if (!creator) {
    throw new Error('Creator not found');
  }

  const result = await processCreatorPayout(creatorId, creator);

  if (result.skipped) {
    throw new Error(`Payout not available: ${result.reason}`);
  }

  if (!result.success) {
    throw new Error(`Payout failed: ${result.reason}`);
  }

  return result;
}

module.exports = {
  processMonthlyPayouts,
  processCreatorPayout,
  getCreatorPayoutHistory,
  getNextPayoutEstimate,
  requestManualPayout,
};
