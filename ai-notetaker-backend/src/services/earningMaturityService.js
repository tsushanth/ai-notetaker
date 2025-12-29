/**
 * Earning Maturity Service
 * Handles the 30-60 day maturity period for creator earnings
 * to prevent refund/chargeback abuse
 *
 * MATURITY FLOW:
 * 1. New earning created → status = 'maturing', matures_at = created_at + 45 days
 * 2. Daily job runs → checks earnings where NOW() >= matures_at
 * 3. For each mature earning:
 *    a. Check if subscription is still active (not cancelled, not refunded)
 *    b. Check if payment succeeded (no chargeback)
 *    c. If all checks pass → status = 'approved', approved_at = NOW()
 *    d. If checks fail → status = 'cancelled' with reason
 * 4. Monthly payout job → only includes 'approved' earnings
 *
 * CLAWBACK HANDLING:
 * - If refund/chargeback occurs AFTER approval, create clawback
 * - Clawback reduces creator's available balance
 * - Clawback is recorded for audit trail
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

/**
 * Process all earnings that have reached maturity
 * Should be run daily via cron job
 */
async function processMaturedEarnings() {
  const now = new Date().toISOString();

  logger.info('Starting matured earnings processing', { timestamp: now });

  // Get all earnings ready for maturity check
  const { data: maturingEarnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .select(`
      *,
      subscriptions:subscription_id (
        id,
        status,
        cancelled_at,
        expires_at,
        refund_status,
        chargeback_status,
        payment_status,
        is_trial
      )
    `)
    .eq('status', 'maturing')
    .lte('matures_at', now);

  if (error) {
    logger.error('Error fetching maturing earnings', { error });
    return { processed: 0, approved: 0, cancelled: 0, errors: 1 };
  }

  if (!maturingEarnings || maturingEarnings.length === 0) {
    logger.info('No earnings ready for maturity processing');
    return { processed: 0, approved: 0, cancelled: 0, errors: 0 };
  }

  logger.info(`Found ${maturingEarnings.length} earnings ready for maturity check`);

  let approved = 0;
  let cancelled = 0;
  let errors = 0;

  for (const earning of maturingEarnings) {
    try {
      const result = await processEarningMaturity(earning);
      if (result.approved) {
        approved++;
      } else {
        cancelled++;
      }
    } catch (err) {
      logger.error('Error processing earning maturity', {
        earningId: earning.id,
        error: err.message
      });
      errors++;
    }
  }

  logger.info('Matured earnings processing complete', {
    processed: maturingEarnings.length,
    approved,
    cancelled,
    errors,
  });

  return {
    processed: maturingEarnings.length,
    approved,
    cancelled,
    errors,
  };
}

/**
 * Process a single earning for maturity approval
 *
 * APPROVAL CRITERIA:
 * 1. Subscription must exist
 * 2. Subscription must still be active (not cancelled)
 * 3. No refund processed
 * 4. No chargeback/dispute
 * 5. Payment must have succeeded (not failed/pending)
 * 6. Not a trial or $0 charge
 */
async function processEarningMaturity(earning) {
  const subscription = earning.subscriptions;

  // Check 1: Subscription must exist
  if (!subscription) {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'subscription_not_found',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'subscription_not_found' };
  }

  // Check 2: Subscription must still be active or have a future expiry
  const isActive = subscription.status === 'active' ||
    (subscription.expires_at && new Date(subscription.expires_at) > new Date());

  if (!isActive && subscription.status !== 'expired') {
    // Cancelled or inactive subscription
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'subscription_cancelled',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'subscription_cancelled' };
  }

  // Check 3: No refund processed
  if (subscription.refund_status === 'refunded' ||
      subscription.refund_status === 'partial_refund') {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'refund_processed',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'refund_processed' };
  }

  // Check 4: No chargeback
  if (subscription.chargeback_status === 'chargeback' ||
      subscription.chargeback_status === 'dispute_lost') {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'chargeback_occurred',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'chargeback_occurred' };
  }

  // Check 5: Payment must have succeeded (not failed or pending)
  const failedPaymentStatuses = ['failed', 'pending', 'past_due', 'incomplete'];
  if (failedPaymentStatuses.includes(subscription.payment_status)) {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: `payment_${subscription.payment_status}`,
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: `payment_${subscription.payment_status}` };
  }

  // Check 6: Verify earning amount is > $0 (shouldn't happen, but safety check)
  if (parseFloat(earning.creator_earning) <= 0) {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'zero_earning',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'zero_earning' };
  }

  // Check 7: Verify not a trial (shouldn't be in maturing status, but safety check)
  if (subscription.is_trial || subscription.status === 'trialing') {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'trial_subscription',
      subscription_active_at_maturity: false,
    });
    return { approved: false, reason: 'trial_subscription' };
  }

  // All checks passed - approve the earning
  await updateEarningStatus(earning.id, 'approved', {
    approved_at: new Date().toISOString(),
    subscription_active_at_maturity: true,
  });

  logger.info('Earning approved for payout', {
    earningId: earning.id,
    creatorId: earning.creator_id,
    amount: earning.creator_earning,
  });

  return { approved: true };
}

/**
 * Update earning status with additional fields
 */
async function updateEarningStatus(earningId, status, additionalFields = {}) {
  const updateData = {
    status,
    ...additionalFields,
  };

  const { error } = await supabaseAdmin
    .from('creator_earnings')
    .update(updateData)
    .eq('id', earningId);

  if (error) {
    logger.error('Error updating earning status', { earningId, status, error });
    throw error;
  }
}

/**
 * Process a refund and create clawback if needed
 * Called from webhook handlers when refund is processed
 *
 * @param {string} subscriptionId - The subscription that was refunded
 * @param {Object} refundData - Details about the refund
 */
async function processRefund(subscriptionId, refundData) {
  const {
    refundAmount,
    sourceEventId,
    sourcePlatform,
    notes = null,
    processedBy = 'system',
  } = refundData;

  logger.info('Processing refund for creator earnings', {
    subscriptionId,
    refundAmount,
    sourcePlatform,
  });

  // Get all earnings for this subscription
  const { data: earnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .in('status', ['maturing', 'approved', 'paid']);

  if (error) {
    logger.error('Error fetching earnings for refund', { error });
    throw error;
  }

  if (!earnings || earnings.length === 0) {
    logger.info('No earnings found for refunded subscription', { subscriptionId });
    return { clawbacks: [] };
  }

  const clawbacks = [];

  for (const earning of earnings) {
    const clawback = await createClawback({
      earning,
      reason: 'refund',
      clawbackAmount: parseFloat(earning.creator_earning),
      sourceEventId,
      sourcePlatform,
      notes,
      processedBy,
    });

    if (clawback) {
      clawbacks.push(clawback);
    }
  }

  logger.info('Refund processed for creator earnings', {
    subscriptionId,
    earningsAffected: earnings.length,
    clawbacksCreated: clawbacks.length,
  });

  return { clawbacks };
}

/**
 * Process a chargeback and create clawback
 * Called from webhook handlers when chargeback is received
 */
async function processChargeback(subscriptionId, chargebackData) {
  const {
    chargebackAmount,
    sourceEventId,
    sourcePlatform,
    notes = null,
    processedBy = 'system',
  } = chargebackData;

  logger.info('Processing chargeback for creator earnings', {
    subscriptionId,
    chargebackAmount,
    sourcePlatform,
  });

  // Get all earnings for this subscription (including paid ones)
  const { data: earnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .in('status', ['maturing', 'approved', 'paid']);

  if (error) {
    logger.error('Error fetching earnings for chargeback', { error });
    throw error;
  }

  if (!earnings || earnings.length === 0) {
    logger.info('No earnings found for chargebacked subscription', { subscriptionId });
    return { clawbacks: [] };
  }

  const clawbacks = [];

  for (const earning of earnings) {
    const clawback = await createClawback({
      earning,
      reason: 'chargeback',
      clawbackAmount: parseFloat(earning.creator_earning),
      sourceEventId,
      sourcePlatform,
      notes,
      processedBy,
    });

    if (clawback) {
      clawbacks.push(clawback);
    }
  }

  logger.info('Chargeback processed for creator earnings', {
    subscriptionId,
    earningsAffected: earnings.length,
    clawbacksCreated: clawbacks.length,
  });

  return { clawbacks };
}

/**
 * Process subscription cancellation before maturity
 * Called when user cancels subscription during the maturity period
 */
async function processSubscriptionCancellation(subscriptionId, cancellationData = {}) {
  const { notes = null, processedBy = 'system' } = cancellationData;

  logger.info('Processing subscription cancellation for creator earnings', {
    subscriptionId,
  });

  // Get all maturing earnings for this subscription
  const { data: earnings, error } = await supabaseAdmin
    .from('creator_earnings')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .eq('status', 'maturing');

  if (error) {
    logger.error('Error fetching earnings for cancellation', { error });
    throw error;
  }

  if (!earnings || earnings.length === 0) {
    logger.info('No maturing earnings found for cancelled subscription', { subscriptionId });
    return { cancelled: 0 };
  }

  // Cancel all maturing earnings
  for (const earning of earnings) {
    await updateEarningStatus(earning.id, 'cancelled', {
      clawback_reason: 'subscription_cancelled',
      subscription_active_at_maturity: false,
    });

    // Create clawback event for audit trail (even though no money to claw back)
    await supabaseAdmin
      .from('creator_clawback_events')
      .insert({
        earning_id: earning.id,
        creator_id: earning.creator_id,
        subscription_id: subscriptionId,
        user_id: earning.user_id,
        reason: 'subscription_cancelled',
        original_amount: parseFloat(earning.creator_earning),
        clawback_amount: 0, // No money was paid out yet
        notes,
        processed_by: processedBy,
      });
  }

  logger.info('Subscription cancellation processed for creator earnings', {
    subscriptionId,
    earningsCancelled: earnings.length,
  });

  return { cancelled: earnings.length };
}

/**
 * Create a clawback record and update earning status
 */
async function createClawback({
  earning,
  reason,
  clawbackAmount,
  sourceEventId = null,
  sourcePlatform = null,
  notes = null,
  processedBy = 'system',
}) {
  // Create clawback event
  const { data: clawbackEvent, error: clawbackError } = await supabaseAdmin
    .from('creator_clawback_events')
    .insert({
      earning_id: earning.id,
      creator_id: earning.creator_id,
      subscription_id: earning.subscription_id,
      user_id: earning.user_id,
      reason,
      original_amount: parseFloat(earning.creator_earning),
      clawback_amount: clawbackAmount,
      source_event_id: sourceEventId,
      source_platform: sourcePlatform,
      notes,
      processed_by: processedBy,
    })
    .select()
    .single();

  if (clawbackError) {
    logger.error('Error creating clawback event', { error: clawbackError });
    throw clawbackError;
  }

  // Update earning status
  await supabaseAdmin
    .from('creator_earnings')
    .update({
      status: 'clawback',
      clawback_reason: reason,
      clawback_at: new Date().toISOString(),
      original_earning_amount: earning.creator_earning,
      creator_earning: 0, // Zero out the earning
    })
    .eq('id', earning.id);

  logger.info('Clawback created for earning', {
    earningId: earning.id,
    creatorId: earning.creator_id,
    reason,
    clawbackAmount,
  });

  return clawbackEvent;
}

/**
 * Get approved earnings ready for payout
 * Used by the monthly payout job
 */
async function getApprovedEarningsForPayout(creatorId = null) {
  let query = supabaseAdmin
    .from('creator_earnings')
    .select(`
      *,
      creators:creator_id (
        id,
        name,
        email,
        stripe_connect_account_id,
        minimum_payout_amount
      )
    `)
    .eq('status', 'approved');

  if (creatorId) {
    query = query.eq('creator_id', creatorId);
  }

  const { data: earnings, error } = await query;

  if (error) {
    logger.error('Error fetching approved earnings', { error });
    return [];
  }

  return earnings || [];
}

/**
 * Get summary of creator's earnings by status
 * Useful for dashboard display
 */
async function getCreatorEarningsSummary(creatorId) {
  // Get maturing earnings (pending approval)
  const { data: maturingEarnings } = await supabaseAdmin
    .from('creator_earnings')
    .select('creator_earning, matures_at')
    .eq('creator_id', creatorId)
    .eq('status', 'maturing');

  const maturing = {
    count: maturingEarnings?.length || 0,
    total: maturingEarnings?.reduce((sum, e) => sum + parseFloat(e.creator_earning), 0) || 0,
    nextMaturity: maturingEarnings?.length > 0
      ? maturingEarnings.sort((a, b) => new Date(a.matures_at) - new Date(b.matures_at))[0].matures_at
      : null,
  };

  // Get approved earnings (ready for payout)
  const { data: approvedEarnings } = await supabaseAdmin
    .from('creator_earnings')
    .select('creator_earning')
    .eq('creator_id', creatorId)
    .eq('status', 'approved');

  const approved = {
    count: approvedEarnings?.length || 0,
    total: approvedEarnings?.reduce((sum, e) => sum + parseFloat(e.creator_earning), 0) || 0,
  };

  // Get paid earnings
  const { data: paidEarnings } = await supabaseAdmin
    .from('creator_earnings')
    .select('creator_earning')
    .eq('creator_id', creatorId)
    .eq('status', 'paid');

  const paid = {
    count: paidEarnings?.length || 0,
    total: paidEarnings?.reduce((sum, e) => sum + parseFloat(e.creator_earning), 0) || 0,
  };

  // Get clawbacks
  const { data: clawbacks } = await supabaseAdmin
    .from('creator_clawback_events')
    .select('clawback_amount')
    .eq('creator_id', creatorId);

  const clawbackTotal = {
    count: clawbacks?.length || 0,
    total: clawbacks?.reduce((sum, c) => sum + parseFloat(c.clawback_amount), 0) || 0,
  };

  return {
    maturing,
    approved,
    paid,
    clawbacks: clawbackTotal,
    availableForPayout: approved.total,
    pendingMaturity: maturing.total,
    totalEarned: paid.total + approved.total + maturing.total,
    totalClawedBack: clawbackTotal.total,
  };
}

/**
 * Mark earnings as paid (called after successful payout)
 */
async function markEarningsAsPaid(earningIds, payoutId) {
  const { error } = await supabaseAdmin
    .from('creator_earnings')
    .update({
      status: 'paid',
      payout_id: payoutId,
    })
    .in('id', earningIds);

  if (error) {
    logger.error('Error marking earnings as paid', { error, earningIds });
    throw error;
  }

  logger.info('Earnings marked as paid', {
    count: earningIds.length,
    payoutId,
  });
}

module.exports = {
  processMaturedEarnings,
  processEarningMaturity,
  processRefund,
  processChargeback,
  processSubscriptionCancellation,
  createClawback,
  getApprovedEarningsForPayout,
  getCreatorEarningsSummary,
  markEarningsAsPaid,
};
