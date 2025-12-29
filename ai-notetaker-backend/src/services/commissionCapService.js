/**
 * Commission Cap Service
 * Implements Rule 9: Cap exposure per creator
 *
 * TWO CAP OPTIONS:
 * 1. Monthly Max: Hard cap on total commissions per month ($500 default)
 * 2. Tiered Rates: Reduce commission rate after volume thresholds
 *    - Tier 1: First 20 referrals at 25%
 *    - Tier 2: Next 30 referrals (21-50) at 15%
 *    - Tier 3: 51+ referrals at 10%
 *
 * Both options can be used together ('both' cap_method)
 *
 * GRACE PERIOD:
 * New creators have 30 days before caps apply (configurable)
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

/**
 * Default cap configuration
 * Used if no config exists in database
 */
const DEFAULT_CAP_CONFIG = {
  maxMonthlyCommission: 500.00,     // $500/month max
  tier1ReferralLimit: 20,           // First 20 referrals
  tier1RatePercent: 25.00,          // at 25%
  tier2ReferralLimit: 30,           // Next 30 referrals (21-50)
  tier2RatePercent: 15.00,          // at 15%
  tier3RatePercent: 10.00,          // 51+ at 10%
  capMethod: 'both',                // Apply both caps
  newCreatorGraceDays: 30,          // 30 day grace period
};

/**
 * Get the current year-month string for tracking
 * @returns {string} e.g., '2025-01'
 */
function getCurrentYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Get commission cap configuration for a creator
 *
 * @param {string} creatorId - Creator's ID
 * @returns {Object} Cap configuration
 */
async function getCreatorCapConfig(creatorId) {
  try {
    // First, get creator details to check exemption and creation date
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('creators')
      .select('id, created_at, is_cap_exempt, has_custom_cap')
      .eq('id', creatorId)
      .single();

    if (creatorError || !creator) {
      logger.error('Failed to fetch creator for cap config', { creatorId, error: creatorError });
      return {
        ...DEFAULT_CAP_CONFIG,
        isExempt: false,
        inGracePeriod: false,
      };
    }

    // Check if creator is exempt from caps
    if (creator.is_cap_exempt) {
      return {
        maxMonthlyCommission: 999999.99,
        tier1ReferralLimit: 999999,
        tier1RatePercent: 25.00,
        tier2ReferralLimit: 999999,
        tier2RatePercent: 25.00,
        tier3RatePercent: 25.00,
        capMethod: 'none',
        newCreatorGraceDays: 0,
        isExempt: true,
        inGracePeriod: false,
      };
    }

    // Get cap config (creator-specific or default)
    const { data: capConfig, error: configError } = await supabaseAdmin
      .from('creator_commission_caps')
      .select('*')
      .or(`creator_id.eq.${creatorId},is_default.eq.true`)
      .eq('is_active', true)
      .order('creator_id', { ascending: false, nullsFirst: false }) // Prefer creator-specific
      .limit(1)
      .single();

    const config = capConfig || DEFAULT_CAP_CONFIG;

    // Calculate grace period
    const creatorCreatedAt = new Date(creator.created_at);
    const graceDays = config.new_creator_grace_days || config.newCreatorGraceDays || 30;
    const graceEndDate = new Date(creatorCreatedAt.getTime() + (graceDays * 24 * 60 * 60 * 1000));
    const inGracePeriod = new Date() < graceEndDate;

    return {
      maxMonthlyCommission: parseFloat(config.max_monthly_commission || config.maxMonthlyCommission || 500),
      tier1ReferralLimit: config.tier1_referral_limit || config.tier1ReferralLimit || 20,
      tier1RatePercent: parseFloat(config.tier1_rate_percent || config.tier1RatePercent || 25),
      tier2ReferralLimit: config.tier2_referral_limit || config.tier2ReferralLimit || 30,
      tier2RatePercent: parseFloat(config.tier2_rate_percent || config.tier2RatePercent || 15),
      tier3RatePercent: parseFloat(config.tier3_rate_percent || config.tier3RatePercent || 10),
      capMethod: config.cap_method || config.capMethod || 'both',
      newCreatorGraceDays: graceDays,
      isExempt: false,
      inGracePeriod,
      graceEndDate: inGracePeriod ? graceEndDate.toISOString() : null,
    };
  } catch (error) {
    logger.error('Error getting creator cap config', { creatorId, error: error.message });
    return {
      ...DEFAULT_CAP_CONFIG,
      isExempt: false,
      inGracePeriod: false,
    };
  }
}

/**
 * Get or create monthly commission tracking record
 *
 * @param {string} creatorId - Creator's ID
 * @param {string} yearMonth - Year-month string (e.g., '2025-01')
 * @returns {Object} Monthly commission record
 */
async function getOrCreateMonthlyRecord(creatorId, yearMonth = null) {
  const targetMonth = yearMonth || getCurrentYearMonth();

  try {
    // Try to get existing record
    let { data: monthlyRecord, error } = await supabaseAdmin
      .from('creator_monthly_commissions')
      .select('*')
      .eq('creator_id', creatorId)
      .eq('year_month', targetMonth)
      .single();

    if (error && error.code === 'PGRST116') {
      // Record doesn't exist, create it
      const { data: newRecord, error: createError } = await supabaseAdmin
        .from('creator_monthly_commissions')
        .insert({
          creator_id: creatorId,
          year_month: targetMonth,
          total_referrals: 0,
          paid_referrals: 0,
          gross_commission: 0,
          capped_commission: 0,
          cap_savings: 0,
          tier1_referrals: 0,
          tier1_commission: 0,
          tier2_referrals: 0,
          tier2_commission: 0,
          tier3_referrals: 0,
          tier3_commission: 0,
          monthly_cap_hit: false,
        })
        .select()
        .single();

      if (createError) {
        // Might have been created by another process, try to get it again
        const { data: retryRecord } = await supabaseAdmin
          .from('creator_monthly_commissions')
          .select('*')
          .eq('creator_id', creatorId)
          .eq('year_month', targetMonth)
          .single();

        if (retryRecord) {
          return retryRecord;
        }

        logger.error('Failed to create monthly record', { creatorId, targetMonth, error: createError });
        return null;
      }

      return newRecord;
    }

    if (error) {
      logger.error('Error fetching monthly record', { creatorId, targetMonth, error });
      return null;
    }

    return monthlyRecord;
  } catch (error) {
    logger.error('Error in getOrCreateMonthlyRecord', { creatorId, targetMonth, error: error.message });
    return null;
  }
}

/**
 * Calculate commission with caps applied
 *
 * This is the main function for Rule 9 implementation.
 * It calculates the final commission after applying:
 * 1. Tiered rate reduction (if enabled)
 * 2. Monthly cap limit (if enabled)
 *
 * @param {string} creatorId - Creator's ID
 * @param {number} netRevenue - Net revenue to calculate commission on (after platform fee)
 * @param {number} baseRatePercent - Base commission rate (default 25%)
 *
 * @returns {Object} {
 *   finalCommission: number,     // Commission to pay after caps
 *   originalCommission: number,  // Commission before caps
 *   effectiveRate: number,       // Actual rate used (may be reduced from tiering)
 *   tierApplied: number,         // Which tier (1, 2, or 3)
 *   wasCapped: boolean,          // Was the commission reduced by any cap?
 *   capType: string,             // 'none', 'monthly_max', 'tiered', or 'both'
 *   remainingMonthlyCap: number, // How much room left in monthly cap
 *   capSavings: number,          // How much we saved from this transaction
 * }
 */
async function calculateCappedCommission(creatorId, netRevenue, baseRatePercent = 25) {
  const capConfig = await getCreatorCapConfig(creatorId);

  // If exempt or in grace period, no caps apply
  if (capConfig.isExempt || capConfig.inGracePeriod) {
    const commission = netRevenue * (baseRatePercent / 100);
    return {
      finalCommission: commission,
      originalCommission: commission,
      effectiveRate: baseRatePercent,
      tierApplied: 1,
      wasCapped: false,
      capType: 'none',
      remainingMonthlyCap: capConfig.maxMonthlyCommission,
      capSavings: 0,
      inGracePeriod: capConfig.inGracePeriod,
      graceEndDate: capConfig.graceEndDate,
    };
  }

  // Get current monthly stats
  const monthlyRecord = await getOrCreateMonthlyRecord(creatorId);

  if (!monthlyRecord) {
    // If we can't get monthly record, use base rate without caps
    logger.warn('Could not get monthly record, using base rate without caps', { creatorId });
    const commission = netRevenue * (baseRatePercent / 100);
    return {
      finalCommission: commission,
      originalCommission: commission,
      effectiveRate: baseRatePercent,
      tierApplied: 1,
      wasCapped: false,
      capType: 'none',
      remainingMonthlyCap: capConfig.maxMonthlyCommission,
      capSavings: 0,
      error: 'monthly_record_unavailable',
    };
  }

  const currentReferrals = monthlyRecord.paid_referrals || 0;
  const currentCommission = parseFloat(monthlyRecord.capped_commission) || 0;

  // Calculate base commission (before any caps)
  const baseCommission = netRevenue * (baseRatePercent / 100);
  let effectiveRate = baseRatePercent;
  let tier = 1;
  let tieredCommission = baseCommission;
  let wasCapped = false;
  let capType = 'none';

  // =====================================================
  // OPTION 2: Apply tiered rates if enabled
  // =====================================================
  if (capConfig.capMethod === 'tiered' || capConfig.capMethod === 'both') {
    if (currentReferrals < capConfig.tier1ReferralLimit) {
      // Tier 1: Full rate
      tier = 1;
      effectiveRate = capConfig.tier1RatePercent;
    } else if (currentReferrals < (capConfig.tier1ReferralLimit + capConfig.tier2ReferralLimit)) {
      // Tier 2: Reduced rate
      tier = 2;
      effectiveRate = capConfig.tier2RatePercent;
    } else {
      // Tier 3: Lowest rate
      tier = 3;
      effectiveRate = capConfig.tier3RatePercent;
    }

    tieredCommission = netRevenue * (effectiveRate / 100);

    if (tieredCommission < baseCommission) {
      wasCapped = true;
      capType = 'tiered';
    }
  }

  let finalCommission = tieredCommission;

  // =====================================================
  // OPTION 1: Apply monthly cap if enabled
  // =====================================================
  let remainingMonthlyCap = capConfig.maxMonthlyCommission - currentCommission;

  if (capConfig.capMethod === 'monthly_max' || capConfig.capMethod === 'both') {
    if (remainingMonthlyCap <= 0) {
      // Already hit cap this month - no commission
      finalCommission = 0;
      wasCapped = true;
      capType = 'monthly_max';
      remainingMonthlyCap = 0;
    } else if (finalCommission > remainingMonthlyCap) {
      // This commission would exceed cap - reduce to remaining
      finalCommission = remainingMonthlyCap;
      wasCapped = true;
      capType = capType === 'tiered' ? 'both' : 'monthly_max';
    }
  }

  // Round to 2 decimal places
  finalCommission = Math.round(finalCommission * 100) / 100;
  const capSavings = Math.round((baseCommission - finalCommission) * 100) / 100;

  return {
    finalCommission,
    originalCommission: Math.round(baseCommission * 100) / 100,
    effectiveRate,
    tierApplied: tier,
    wasCapped,
    capType,
    remainingMonthlyCap: Math.max(0, Math.round(remainingMonthlyCap * 100) / 100),
    capSavings,
  };
}

/**
 * Update monthly commission tracking after recording an earning
 *
 * Call this AFTER successfully recording a creator earning.
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} earningDetails - Details of the earning
 * @param {number} earningDetails.originalCommission - Commission before caps
 * @param {number} earningDetails.finalCommission - Commission after caps
 * @param {number} earningDetails.tierApplied - Which tier was applied (1, 2, or 3)
 * @param {boolean} earningDetails.wasCapped - Was the earning capped?
 * @param {string} earningDetails.capType - Type of cap applied
 *
 * @returns {Object} Updated monthly record
 */
async function updateMonthlyCommissionTracking(creatorId, earningDetails) {
  const yearMonth = getCurrentYearMonth();
  const monthlyRecord = await getOrCreateMonthlyRecord(creatorId, yearMonth);

  if (!monthlyRecord) {
    logger.error('Could not update monthly tracking - no record', { creatorId, yearMonth });
    return null;
  }

  const {
    originalCommission,
    finalCommission,
    tierApplied,
    wasCapped,
  } = earningDetails;

  // Build update object
  const updates = {
    total_referrals: (monthlyRecord.total_referrals || 0) + 1,
    paid_referrals: (monthlyRecord.paid_referrals || 0) + 1,
    gross_commission: parseFloat(monthlyRecord.gross_commission || 0) + originalCommission,
    capped_commission: parseFloat(monthlyRecord.capped_commission || 0) + finalCommission,
    cap_savings: parseFloat(monthlyRecord.cap_savings || 0) + (originalCommission - finalCommission),
    updated_at: new Date().toISOString(),
  };

  // Update tier-specific counts
  if (tierApplied === 1) {
    updates.tier1_referrals = (monthlyRecord.tier1_referrals || 0) + 1;
    updates.tier1_commission = parseFloat(monthlyRecord.tier1_commission || 0) + finalCommission;
  } else if (tierApplied === 2) {
    updates.tier2_referrals = (monthlyRecord.tier2_referrals || 0) + 1;
    updates.tier2_commission = parseFloat(monthlyRecord.tier2_commission || 0) + finalCommission;
  } else if (tierApplied === 3) {
    updates.tier3_referrals = (monthlyRecord.tier3_referrals || 0) + 1;
    updates.tier3_commission = parseFloat(monthlyRecord.tier3_commission || 0) + finalCommission;
  }

  // Check if monthly cap was just hit
  const capConfig = await getCreatorCapConfig(creatorId);
  if (!monthlyRecord.monthly_cap_hit && updates.capped_commission >= capConfig.maxMonthlyCommission) {
    updates.monthly_cap_hit = true;
    updates.monthly_cap_hit_at = new Date().toISOString();

    logger.info('Creator hit monthly commission cap', {
      creatorId,
      yearMonth,
      cappedCommission: updates.capped_commission,
      maxCap: capConfig.maxMonthlyCommission,
    });
  }

  // Update the record
  const { data: updatedRecord, error } = await supabaseAdmin
    .from('creator_monthly_commissions')
    .update(updates)
    .eq('id', monthlyRecord.id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update monthly commission tracking', { creatorId, yearMonth, error });
    return null;
  }

  // Also update cached values on creator record
  await supabaseAdmin
    .from('creators')
    .update({
      current_month_commission: updates.capped_commission,
      current_month_referrals: updates.paid_referrals,
      commission_month_reset_at: new Date(yearMonth + '-01').toISOString(),
    })
    .eq('id', creatorId);

  return updatedRecord;
}

/**
 * Get creator's current month commission status
 *
 * Useful for dashboard display and showing creators how close they are to caps.
 *
 * @param {string} creatorId - Creator's ID
 * @returns {Object} Current month status
 */
async function getCreatorMonthlyStatus(creatorId) {
  const yearMonth = getCurrentYearMonth();
  const capConfig = await getCreatorCapConfig(creatorId);
  const monthlyRecord = await getOrCreateMonthlyRecord(creatorId, yearMonth);

  if (!monthlyRecord) {
    return {
      yearMonth,
      capConfig,
      monthlyStats: null,
      error: 'Could not retrieve monthly stats',
    };
  }

  const cappedCommission = parseFloat(monthlyRecord.capped_commission) || 0;
  const remainingCap = Math.max(0, capConfig.maxMonthlyCommission - cappedCommission);
  const capPercentUsed = capConfig.maxMonthlyCommission > 0
    ? (cappedCommission / capConfig.maxMonthlyCommission) * 100
    : 0;

  // Determine current tier
  const paidReferrals = monthlyRecord.paid_referrals || 0;
  let currentTier = 1;
  let referralsUntilNextTier = capConfig.tier1ReferralLimit - paidReferrals;

  if (paidReferrals >= capConfig.tier1ReferralLimit) {
    currentTier = 2;
    referralsUntilNextTier = (capConfig.tier1ReferralLimit + capConfig.tier2ReferralLimit) - paidReferrals;
  }
  if (paidReferrals >= (capConfig.tier1ReferralLimit + capConfig.tier2ReferralLimit)) {
    currentTier = 3;
    referralsUntilNextTier = 0; // Already at lowest tier
  }

  // Get current effective rate
  let currentRate = capConfig.tier1RatePercent;
  if (currentTier === 2) currentRate = capConfig.tier2RatePercent;
  if (currentTier === 3) currentRate = capConfig.tier3RatePercent;

  return {
    yearMonth,
    capConfig: {
      maxMonthlyCommission: capConfig.maxMonthlyCommission,
      capMethod: capConfig.capMethod,
      isExempt: capConfig.isExempt,
      inGracePeriod: capConfig.inGracePeriod,
      graceEndDate: capConfig.graceEndDate,
    },
    monthlyStats: {
      totalReferrals: monthlyRecord.total_referrals,
      paidReferrals: monthlyRecord.paid_referrals,
      grossCommission: parseFloat(monthlyRecord.gross_commission),
      cappedCommission: cappedCommission,
      capSavings: parseFloat(monthlyRecord.cap_savings),
      monthlyCapHit: monthlyRecord.monthly_cap_hit,
      monthlyCapHitAt: monthlyRecord.monthly_cap_hit_at,
    },
    tierStatus: {
      currentTier,
      currentRate,
      referralsUntilNextTier: Math.max(0, referralsUntilNextTier),
      tier1Referrals: monthlyRecord.tier1_referrals,
      tier2Referrals: monthlyRecord.tier2_referrals,
      tier3Referrals: monthlyRecord.tier3_referrals,
    },
    capStatus: {
      remainingCap,
      capPercentUsed: Math.round(capPercentUsed * 10) / 10,
      isNearCap: capPercentUsed >= 80,
      isAtCap: monthlyRecord.monthly_cap_hit,
    },
  };
}

/**
 * Reset monthly commission tracking (for month start)
 *
 * This should be called by a scheduled job at the start of each month
 * to reset the cached values on creator records.
 */
async function resetMonthlyTracking() {
  const previousMonth = new Date();
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousYearMonth = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;

  logger.info('Resetting monthly commission tracking', { previousMonth: previousYearMonth });

  try {
    // Reset cached values on all creators
    const { error } = await supabaseAdmin
      .from('creators')
      .update({
        current_month_commission: 0,
        current_month_referrals: 0,
        commission_month_reset_at: new Date().toISOString(),
      })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all

    if (error) {
      logger.error('Error resetting monthly tracking', { error });
      return { success: false, error: error.message };
    }

    logger.info('Monthly commission tracking reset complete');
    return { success: true, previousMonth: previousYearMonth };
  } catch (error) {
    logger.error('Exception resetting monthly tracking', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Set custom commission cap for a creator
 *
 * Used for special partners or creators who need different limits.
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} customCap - Custom cap configuration
 */
async function setCreatorCustomCap(creatorId, customCap) {
  const {
    maxMonthlyCommission,
    tier1ReferralLimit,
    tier1RatePercent,
    tier2ReferralLimit,
    tier2RatePercent,
    tier3RatePercent,
    capMethod,
    newCreatorGraceDays,
  } = customCap;

  try {
    // Deactivate any existing custom cap for this creator
    await supabaseAdmin
      .from('creator_commission_caps')
      .update({ is_active: false })
      .eq('creator_id', creatorId);

    // Create new custom cap
    const { data: newCap, error } = await supabaseAdmin
      .from('creator_commission_caps')
      .insert({
        creator_id: creatorId,
        is_default: false,
        max_monthly_commission: maxMonthlyCommission,
        tier1_referral_limit: tier1ReferralLimit,
        tier1_rate_percent: tier1RatePercent,
        tier2_referral_limit: tier2ReferralLimit,
        tier2_rate_percent: tier2RatePercent,
        tier3_rate_percent: tier3RatePercent,
        cap_method: capMethod,
        new_creator_grace_days: newCreatorGraceDays,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to set custom cap', { creatorId, error });
      throw new Error('Failed to set custom cap');
    }

    // Mark creator as having custom cap
    await supabaseAdmin
      .from('creators')
      .update({ has_custom_cap: true })
      .eq('id', creatorId);

    logger.info('Custom commission cap set', { creatorId, capId: newCap.id });
    return newCap;
  } catch (error) {
    logger.error('Error setting custom cap', { creatorId, error: error.message });
    throw error;
  }
}

/**
 * Exempt creator from commission caps
 *
 * For special partners who should have no caps.
 *
 * @param {string} creatorId - Creator's ID
 * @param {boolean} exempt - Whether to exempt (true) or un-exempt (false)
 */
async function setCreatorCapExemption(creatorId, exempt = true) {
  try {
    const { error } = await supabaseAdmin
      .from('creators')
      .update({ is_cap_exempt: exempt })
      .eq('id', creatorId);

    if (error) {
      logger.error('Failed to set cap exemption', { creatorId, error });
      throw new Error('Failed to set cap exemption');
    }

    logger.info('Creator cap exemption updated', { creatorId, exempt });
    return { success: true, exempt };
  } catch (error) {
    logger.error('Error setting cap exemption', { creatorId, error: error.message });
    throw error;
  }
}

module.exports = {
  // Core functions
  getCreatorCapConfig,
  calculateCappedCommission,
  updateMonthlyCommissionTracking,
  getCreatorMonthlyStatus,

  // Admin functions
  resetMonthlyTracking,
  setCreatorCustomCap,
  setCreatorCapExemption,

  // Helpers
  getOrCreateMonthlyRecord,
  getCurrentYearMonth,

  // Constants
  DEFAULT_CAP_CONFIG,
};
