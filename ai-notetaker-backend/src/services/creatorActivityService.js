/**
 * Creator Activity Service
 * Tracks creator activity and handles automatic downgrades
 *
 * ACTIVITY REQUIREMENTS (ANY of these keeps creator status):
 * - 1+ paid referral in 60-90 days, OR
 * - 2+ content submissions in 60-90 days, OR
 * - 10+ referred signups (trial or paid) in 60-90 days
 *
 * DOWNGRADE PROCESS:
 * 1. First warning email at day 0 of inactivity
 * 2. Final warning email 7 days before downgrade
 * 3. Automatic downgrade after grace period
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// Default activity requirements
const DEFAULT_CONFIG = {
  activityWindowDays: 90,
  minPaidReferrals: 1,
  minContentSubmissions: 2,
  minTotalSignups: 10,
  warningPeriodDays: 14,
  finalWarningDays: 7,
  gracePeriodDays: 7,
};

/**
 * Get activity configuration
 */
async function getActivityConfig() {
  const { data: config } = await supabaseAdmin
    .from('creator_activity_config')
    .select('*')
    .eq('is_active', true)
    .single();

  if (config) {
    return {
      activityWindowDays: config.activity_window_days,
      minPaidReferrals: config.min_paid_referrals,
      minContentSubmissions: config.min_content_submissions,
      minTotalSignups: config.min_total_signups,
      warningPeriodDays: config.warning_period_days,
      finalWarningDays: config.final_warning_days,
      gracePeriodDays: config.grace_period_days,
    };
  }

  return DEFAULT_CONFIG;
}

/**
 * Get activity stats for a creator
 */
async function getCreatorActivityStats(creatorId) {
  const config = await getActivityConfig();
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - config.activityWindowDays);

  // Get paid referrals in window
  const { count: paidReferralsInWindow } = await supabaseAdmin
    .from('creator_earnings')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', windowStart.toISOString())
    .not('status', 'in', '(cancelled,clawback,held,rejected)')
    .gt('creator_earning', 0);

  // Get content submissions in window
  const { count: contentSubmissionsInWindow } = await supabaseAdmin
    .from('creator_content_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', windowStart.toISOString());

  // Get total signups in window
  const { count: totalSignupsInWindow } = await supabaseAdmin
    .from('promo_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', windowStart.toISOString());

  // Get all-time totals
  const { count: totalPaidReferrals } = await supabaseAdmin
    .from('creator_earnings')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .not('status', 'in', '(cancelled,clawback,held,rejected)')
    .gt('creator_earning', 0);

  const { count: totalContentSubmissions } = await supabaseAdmin
    .from('creator_content_submissions')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId);

  const { count: totalSignups } = await supabaseAdmin
    .from('promo_redemptions')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId);

  // Get last activity dates
  const { data: lastEarning } = await supabaseAdmin
    .from('creator_earnings')
    .select('created_at')
    .eq('creator_id', creatorId)
    .not('status', 'in', '(cancelled,clawback,held,rejected)')
    .gt('creator_earning', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastContent } = await supabaseAdmin
    .from('creator_content_submissions')
    .select('created_at')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { data: lastSignup } = await supabaseAdmin
    .from('promo_redemptions')
    .select('created_at')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Check if meets ANY requirement
  const meetsRequirements =
    (paidReferralsInWindow || 0) >= config.minPaidReferrals ||
    (contentSubmissionsInWindow || 0) >= config.minContentSubmissions ||
    (totalSignupsInWindow || 0) >= config.minTotalSignups;

  return {
    inWindow: {
      paidReferrals: paidReferralsInWindow || 0,
      contentSubmissions: contentSubmissionsInWindow || 0,
      totalSignups: totalSignupsInWindow || 0,
    },
    allTime: {
      paidReferrals: totalPaidReferrals || 0,
      contentSubmissions: totalContentSubmissions || 0,
      totalSignups: totalSignups || 0,
    },
    lastActivity: {
      paidReferral: lastEarning?.created_at || null,
      contentSubmission: lastContent?.created_at || null,
      signup: lastSignup?.created_at || null,
    },
    requirements: {
      paidReferrals: config.minPaidReferrals,
      contentSubmissions: config.minContentSubmissions,
      totalSignups: config.minTotalSignups,
      windowDays: config.activityWindowDays,
    },
    meetsRequirements,
  };
}

/**
 * Check if a creator is active (meets activity requirements)
 */
async function isCreatorActive(creatorId) {
  // First check if creator is exempt
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('is_activity_exempt, activity_status')
    .eq('id', creatorId)
    .single();

  if (creator?.is_activity_exempt || creator?.activity_status === 'exempt') {
    return { isActive: true, reason: 'exempt' };
  }

  const stats = await getCreatorActivityStats(creatorId);

  if (stats.meetsRequirements) {
    return {
      isActive: true,
      reason: 'meets_requirements',
      stats,
    };
  }

  return {
    isActive: false,
    reason: 'inactive',
    stats,
  };
}

/**
 * Process activity check for all creators
 * Run daily via cron job
 */
async function processActivityChecks() {
  const config = await getActivityConfig();
  const now = new Date();

  logger.info('Starting creator activity checks', { timestamp: now.toISOString() });

  // Get all active creators with premium access
  const { data: creators, error } = await supabaseAdmin
    .from('creators')
    .select('*')
    .eq('has_premium_access', true)
    .eq('status', 'active')
    .not('activity_status', 'eq', 'exempt');

  if (error) {
    logger.error('Error fetching creators for activity check', { error });
    return { processed: 0, warnings: 0, finalWarnings: 0, downgrades: 0, errors: 1 };
  }

  let warnings = 0;
  let finalWarnings = 0;
  let downgrades = 0;
  let reactivations = 0;
  let errors = 0;

  for (const creator of creators || []) {
    try {
      const result = await processCreatorActivity(creator, config);

      if (result.action === 'warning') warnings++;
      if (result.action === 'final_warning') finalWarnings++;
      if (result.action === 'downgrade') downgrades++;
      if (result.action === 'reactivate') reactivations++;
    } catch (err) {
      logger.error('Error processing creator activity', {
        creatorId: creator.id,
        error: err.message,
      });
      errors++;
    }
  }

  logger.info('Creator activity checks complete', {
    processed: creators?.length || 0,
    warnings,
    finalWarnings,
    downgrades,
    reactivations,
    errors,
  });

  return {
    processed: creators?.length || 0,
    warnings,
    finalWarnings,
    downgrades,
    reactivations,
    errors,
  };
}

/**
 * Process activity for a single creator
 */
async function processCreatorActivity(creator, config) {
  const activityCheck = await isCreatorActive(creator.id);
  const now = new Date();

  // Record the activity check
  await recordActivityEvent(creator.id, 'activity_check', {
    isActive: activityCheck.isActive,
    reason: activityCheck.reason,
    stats: activityCheck.stats,
  });

  // Update last activity check
  await supabaseAdmin
    .from('creators')
    .update({ last_activity_check_at: now.toISOString() })
    .eq('id', creator.id);

  // If creator is active and was in warning state, reactivate them
  if (activityCheck.isActive) {
    if (creator.activity_status === 'warning' || creator.activity_status === 'final_warning') {
      await reactivateCreator(creator.id, 'activity_resumed');
      return { action: 'reactivate', creatorId: creator.id };
    }
    return { action: 'none', creatorId: creator.id };
  }

  // Creator is inactive - check what action to take
  const activityStatus = creator.activity_status || 'active';

  // If already in warning state, check if we should escalate
  if (activityStatus === 'warning') {
    const warningSentAt = new Date(creator.downgrade_warning_sent_at);
    const daysSinceWarning = Math.floor((now - warningSentAt) / (1000 * 60 * 60 * 24));

    // Time for final warning?
    if (daysSinceWarning >= config.warningPeriodDays - config.finalWarningDays) {
      await sendFinalWarning(creator);
      return { action: 'final_warning', creatorId: creator.id };
    }

    return { action: 'none', creatorId: creator.id };
  }

  // If in final warning state, check if we should downgrade
  if (activityStatus === 'final_warning') {
    const finalWarningSentAt = new Date(creator.final_warning_sent_at);
    const daysSinceFinalWarning = Math.floor((now - finalWarningSentAt) / (1000 * 60 * 60 * 24));

    // Time to downgrade?
    if (daysSinceFinalWarning >= config.gracePeriodDays) {
      await downgradeCreator(creator.id, 'inactivity');
      return { action: 'downgrade', creatorId: creator.id };
    }

    return { action: 'none', creatorId: creator.id };
  }

  // Creator just became inactive - send first warning
  await sendFirstWarning(creator);
  return { action: 'warning', creatorId: creator.id };
}

/**
 * Send first warning email to creator
 */
async function sendFirstWarning(creator) {
  const config = await getActivityConfig();
  const stats = await getCreatorActivityStats(creator.id);

  // Update creator status
  await supabaseAdmin
    .from('creators')
    .update({
      activity_status: 'warning',
      downgrade_warning_sent_at: new Date().toISOString(),
    })
    .eq('id', creator.id);

  // Record event
  await recordActivityEvent(creator.id, 'warning_sent', {
    stats,
    daysUntilFinalWarning: config.warningPeriodDays - config.finalWarningDays,
    daysUntilDowngrade: config.warningPeriodDays,
  });

  // TODO: Send actual email via email service
  // For now, just log it
  logger.warn('Creator activity warning sent', {
    creatorId: creator.id,
    email: creator.email,
    stats: stats.inWindow,
    requirements: stats.requirements,
  });

  // Return email data for external email service integration
  return {
    type: 'first_warning',
    recipient: creator.email,
    creatorName: creator.name,
    stats: stats.inWindow,
    requirements: stats.requirements,
    daysUntilDowngrade: config.warningPeriodDays,
  };
}

/**
 * Send final warning email to creator
 */
async function sendFinalWarning(creator) {
  const config = await getActivityConfig();
  const stats = await getCreatorActivityStats(creator.id);

  // Update creator status
  await supabaseAdmin
    .from('creators')
    .update({
      activity_status: 'final_warning',
      final_warning_sent_at: new Date().toISOString(),
    })
    .eq('id', creator.id);

  // Record event
  await recordActivityEvent(creator.id, 'final_warning_sent', {
    stats,
    daysUntilDowngrade: config.gracePeriodDays,
  });

  logger.warn('Creator final warning sent', {
    creatorId: creator.id,
    email: creator.email,
    daysUntilDowngrade: config.gracePeriodDays,
  });

  return {
    type: 'final_warning',
    recipient: creator.email,
    creatorName: creator.name,
    stats: stats.inWindow,
    requirements: stats.requirements,
    daysUntilDowngrade: config.gracePeriodDays,
  };
}

/**
 * Downgrade a creator (remove premium access)
 */
async function downgradeCreator(creatorId, reason) {
  const stats = await getCreatorActivityStats(creatorId);

  // Update creator
  await supabaseAdmin
    .from('creators')
    .update({
      has_premium_access: false,
      activity_status: 'downgraded',
      downgraded_at: new Date().toISOString(),
      downgrade_reason: reason,
    })
    .eq('id', creatorId);

  // Record event
  await recordActivityEvent(creatorId, 'downgraded', {
    reason,
    stats,
  });

  // Get creator for logging
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('email, name')
    .eq('id', creatorId)
    .single();

  logger.warn('Creator downgraded', {
    creatorId,
    email: creator?.email,
    reason,
    stats: stats.inWindow,
  });

  return {
    type: 'downgrade_notification',
    recipient: creator?.email,
    creatorName: creator?.name,
    reason,
    stats: stats.inWindow,
  };
}

/**
 * Reactivate a creator (restore premium access)
 */
async function reactivateCreator(creatorId, reason) {
  // Get current reactivation count
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('reactivation_count, email, name')
    .eq('id', creatorId)
    .single();

  // Update creator
  await supabaseAdmin
    .from('creators')
    .update({
      has_premium_access: true,
      activity_status: 'active',
      downgrade_warning_sent_at: null,
      final_warning_sent_at: null,
      downgraded_at: null,
      downgrade_reason: null,
      reactivation_count: (creator?.reactivation_count || 0) + 1,
      premium_granted_at: new Date().toISOString(),
    })
    .eq('id', creatorId);

  // Record event
  await recordActivityEvent(creatorId, 'reactivated', { reason });

  logger.info('Creator reactivated', {
    creatorId,
    email: creator?.email,
    reason,
  });

  return true;
}

/**
 * Make a creator exempt from activity requirements
 */
async function setCreatorExempt(creatorId, exempt, reason = null) {
  await supabaseAdmin
    .from('creators')
    .update({
      is_activity_exempt: exempt,
      activity_status: exempt ? 'exempt' : 'active',
    })
    .eq('id', creatorId);

  await recordActivityEvent(
    creatorId,
    exempt ? 'exempt_granted' : 'exempt_revoked',
    { reason }
  );

  logger.info(`Creator ${exempt ? 'exempted' : 'un-exempted'}`, {
    creatorId,
    reason,
  });

  return true;
}

/**
 * Submit content for a creator
 */
async function submitContent(creatorId, contentData) {
  const { contentType, contentUrl, title, description, platform } = contentData;

  const { data: submission, error } = await supabaseAdmin
    .from('creator_content_submissions')
    .insert({
      creator_id: creatorId,
      content_type: contentType,
      content_url: contentUrl,
      title,
      description,
      platform,
    })
    .select()
    .single();

  if (error) {
    logger.error('Error submitting content', { error, creatorId });
    throw new Error('Failed to submit content');
  }

  // Update content count on creator
  await supabaseAdmin.rpc('increment_content_submissions', { p_creator_id: creatorId });

  // Record event
  await recordActivityEvent(creatorId, 'content_submitted', {
    contentType,
    contentUrl,
    platform,
  });

  // Check if this brings creator back to active
  const activityCheck = await isCreatorActive(creatorId);
  if (activityCheck.isActive) {
    const { data: creator } = await supabaseAdmin
      .from('creators')
      .select('activity_status')
      .eq('id', creatorId)
      .single();

    if (creator?.activity_status === 'warning' || creator?.activity_status === 'final_warning') {
      await reactivateCreator(creatorId, 'content_submission');
    }
  }

  logger.info('Creator content submitted', {
    creatorId,
    contentType,
    submissionId: submission.id,
  });

  return submission;
}

/**
 * Get content submissions for a creator
 */
async function getCreatorContentSubmissions(creatorId, { limit = 20, offset = 0 } = {}) {
  const { data: submissions, error, count } = await supabaseAdmin
    .from('creator_content_submissions')
    .select('*', { count: 'exact' })
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    logger.error('Error fetching content submissions', { error });
    return { submissions: [], total: 0 };
  }

  return { submissions: submissions || [], total: count || 0 };
}

/**
 * Record an activity event for audit
 */
async function recordActivityEvent(creatorId, eventType, details = {}) {
  const stats = details.stats || (await getCreatorActivityStats(creatorId));

  const { error } = await supabaseAdmin
    .from('creator_activity_history')
    .insert({
      creator_id: creatorId,
      event_type: eventType,
      details,
      paid_referrals_count: stats.inWindow?.paidReferrals || stats.allTime?.paidReferrals || 0,
      content_submissions_count: stats.inWindow?.contentSubmissions || stats.allTime?.contentSubmissions || 0,
      total_signups_count: stats.inWindow?.totalSignups || stats.allTime?.totalSignups || 0,
    });

  if (error) {
    logger.error('Error recording activity event', { error, creatorId, eventType });
  }
}

/**
 * Get activity dashboard for a creator
 */
async function getActivityDashboard(creatorId) {
  const stats = await getCreatorActivityStats(creatorId);
  const config = await getActivityConfig();

  // Get creator status
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select(`
      activity_status,
      is_activity_exempt,
      has_premium_access,
      downgrade_warning_sent_at,
      final_warning_sent_at,
      premium_granted_at
    `)
    .eq('id', creatorId)
    .single();

  // Calculate days until downgrade (if in warning state)
  let daysUntilDowngrade = null;
  if (creator?.activity_status === 'warning' && creator?.downgrade_warning_sent_at) {
    const warningSent = new Date(creator.downgrade_warning_sent_at);
    const downgradeDate = new Date(warningSent);
    downgradeDate.setDate(downgradeDate.getDate() + config.warningPeriodDays);
    daysUntilDowngrade = Math.ceil((downgradeDate - new Date()) / (1000 * 60 * 60 * 24));
  } else if (creator?.activity_status === 'final_warning' && creator?.final_warning_sent_at) {
    const finalWarningSent = new Date(creator.final_warning_sent_at);
    const downgradeDate = new Date(finalWarningSent);
    downgradeDate.setDate(downgradeDate.getDate() + config.gracePeriodDays);
    daysUntilDowngrade = Math.ceil((downgradeDate - new Date()) / (1000 * 60 * 60 * 24));
  }

  return {
    status: {
      activityStatus: creator?.activity_status || 'active',
      isExempt: creator?.is_activity_exempt || false,
      hasPremiumAccess: creator?.has_premium_access || false,
      meetsRequirements: stats.meetsRequirements,
      daysUntilDowngrade,
    },
    activity: {
      inWindow: stats.inWindow,
      allTime: stats.allTime,
      lastActivity: stats.lastActivity,
    },
    requirements: stats.requirements,
    progress: {
      paidReferrals: {
        current: stats.inWindow.paidReferrals,
        required: stats.requirements.paidReferrals,
        percentComplete: Math.min(100, Math.round((stats.inWindow.paidReferrals / stats.requirements.paidReferrals) * 100)),
      },
      contentSubmissions: {
        current: stats.inWindow.contentSubmissions,
        required: stats.requirements.contentSubmissions,
        percentComplete: Math.min(100, Math.round((stats.inWindow.contentSubmissions / stats.requirements.contentSubmissions) * 100)),
      },
      totalSignups: {
        current: stats.inWindow.totalSignups,
        required: stats.requirements.totalSignups,
        percentComplete: Math.min(100, Math.round((stats.inWindow.totalSignups / stats.requirements.totalSignups) * 100)),
      },
    },
  };
}

module.exports = {
  getActivityConfig,
  getCreatorActivityStats,
  isCreatorActive,
  processActivityChecks,
  processCreatorActivity,
  sendFirstWarning,
  sendFinalWarning,
  downgradeCreator,
  reactivateCreator,
  setCreatorExempt,
  submitContent,
  getCreatorContentSubmissions,
  recordActivityEvent,
  getActivityDashboard,
  DEFAULT_CONFIG,
};
