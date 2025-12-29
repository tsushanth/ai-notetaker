/**
 * Trial Abuse Prevention Service
 * Prevents trial churn gaming, self-referral farms, and mass test account creation
 *
 * RULES ENFORCED:
 * 1. 1 trial per device
 * 2. 1 trial per payment method
 * 3. 1 trial per email/IP cluster where abuse signals exist
 *
 * BLOCKS:
 * - Self-referral farms
 * - Mass test account creation
 * - "Infinite free month" abuse
 */

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// Default configuration (used if no DB config exists)
const DEFAULT_CONFIG = {
  maxTrialsPerDevice: 1,
  maxTrialsPerPaymentMethod: 1,
  maxTrialsPerEmailBase: 2,
  maxTrialsPerIp: 3,
  maxTrialsPerSubnet: 5,
  deviceLookbackDays: 365,
  paymentLookbackDays: 365,
  emailLookbackDays: 365,
  ipLookbackDays: 90,
  subnetLookbackDays: 90,
  clusterFlagThreshold: 3,
  clusterBlockThreshold: 5,
  deviceMatchWeight: 1.0,
  paymentMatchWeight: 1.0,
  emailBaseMatchWeight: 0.9,
  ipMatchWeight: 0.7,
  subnetMatchWeight: 0.4,
};

/**
 * Hash sensitive data for storage/comparison
 */
function hashData(data) {
  if (!data) return null;
  return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
}

/**
 * Extract email base (before + and @) for alias detection
 */
function getEmailBase(email) {
  if (!email) return null;
  const [local, domain] = email.toLowerCase().split('@');
  if (!local || !domain) return null;
  const base = local.split('+')[0];
  return `${base}@${domain}`;
}

/**
 * Extract /24 subnet from IP address
 */
function getIPSubnet(ip) {
  if (!ip) return null;

  // Handle IPv4
  const ipv4Match = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (ipv4Match) return ipv4Match[1];

  // Handle IPv6-mapped IPv4
  const mappedMatch = ip.match(/::ffff:(\d+\.\d+\.\d+)\.\d+$/i);
  if (mappedMatch) return mappedMatch[1];

  // For pure IPv6, use first 4 groups
  const ipv6Parts = ip.split(':');
  if (ipv6Parts.length >= 4) {
    return ipv6Parts.slice(0, 4).join(':');
  }

  return ip;
}

/**
 * Create payment fingerprint from last4 and brand
 */
function createPaymentFingerprint(last4, brand) {
  if (!last4 || !brand) return null;
  return hashData(`${brand.toLowerCase()}-${last4}`);
}

/**
 * Get trial abuse configuration
 */
async function getConfig() {
  const { data: config } = await supabaseAdmin
    .from('trial_abuse_config')
    .select('*')
    .eq('is_active', true)
    .single();

  if (config) {
    return {
      maxTrialsPerDevice: config.max_trials_per_device,
      maxTrialsPerPaymentMethod: config.max_trials_per_payment_method,
      maxTrialsPerEmailBase: config.max_trials_per_email_base,
      maxTrialsPerIp: config.max_trials_per_ip,
      maxTrialsPerSubnet: config.max_trials_per_subnet,
      deviceLookbackDays: config.device_lookback_days,
      paymentLookbackDays: config.payment_lookback_days,
      emailLookbackDays: config.email_lookback_days,
      ipLookbackDays: config.ip_lookback_days,
      subnetLookbackDays: config.subnet_lookback_days,
      clusterFlagThreshold: config.cluster_flag_threshold,
      clusterBlockThreshold: config.cluster_block_threshold,
      deviceMatchWeight: parseFloat(config.device_match_weight),
      paymentMatchWeight: parseFloat(config.payment_match_weight),
      emailBaseMatchWeight: parseFloat(config.email_base_match_weight),
      ipMatchWeight: parseFloat(config.ip_match_weight),
      subnetMatchWeight: parseFloat(config.subnet_match_weight),
    };
  }

  return DEFAULT_CONFIG;
}

/**
 * Check if a user is eligible for a trial
 *
 * @param {Object} params - Check parameters
 * @param {string} params.userId - User ID
 * @param {string} params.email - User's email
 * @param {string} params.deviceFingerprint - Device fingerprint
 * @param {string} params.ipAddress - IP address
 * @param {Object} params.paymentMethod - { last4, brand }
 * @param {string} params.platform - Platform (ios, android, web)
 *
 * @returns {Object} { eligible: boolean, reason: string, abuseScore: number, signals: array }
 */
async function checkTrialEligibility({
  userId,
  email,
  deviceFingerprint,
  ipAddress,
  paymentMethod,
  platform = 'web',
}) {
  const signals = [];
  let abuseScore = 0;
  let blockReason = null;
  let isEligible = true;

  try {
    const config = await getConfig();

    // Hash all fingerprints
    const deviceHash = deviceFingerprint ? hashData(deviceFingerprint) : null;
    const paymentHash = paymentMethod?.last4 && paymentMethod?.brand
      ? createPaymentFingerprint(paymentMethod.last4, paymentMethod.brand)
      : null;
    const emailHash = email ? hashData(email) : null;
    const emailBase = email ? getEmailBase(email) : null;
    const emailBaseHash = emailBase ? hashData(emailBase) : null;
    const ipHash = ipAddress ? hashData(ipAddress) : null;
    const subnet = ipAddress ? getIPSubnet(ipAddress) : null;
    const subnetHash = subnet ? hashData(subnet) : null;

    // =========================================
    // CHECK 1: Device Fingerprint (1 trial per device)
    // =========================================
    if (deviceHash) {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - config.deviceLookbackDays);

      const { count: deviceCount } = await supabaseAdmin
        .from('trial_fingerprints')
        .select('*', { count: 'exact', head: true })
        .eq('device_fingerprint', deviceHash)
        .gte('created_at', lookbackDate.toISOString());

      if (deviceCount >= config.maxTrialsPerDevice) {
        abuseScore += config.deviceMatchWeight;
        signals.push({
          type: 'device_limit',
          count: deviceCount,
          max: config.maxTrialsPerDevice,
          severity: 'high',
        });
        isEligible = false;
        blockReason = blockReason || 'This device has already been used for a trial';
      }
    }

    // =========================================
    // CHECK 2: Payment Method (1 trial per card)
    // =========================================
    if (paymentHash) {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - config.paymentLookbackDays);

      const { count: paymentCount } = await supabaseAdmin
        .from('trial_fingerprints')
        .select('*', { count: 'exact', head: true })
        .eq('payment_fingerprint', paymentHash)
        .gte('created_at', lookbackDate.toISOString());

      if (paymentCount >= config.maxTrialsPerPaymentMethod) {
        abuseScore += config.paymentMatchWeight;
        signals.push({
          type: 'payment_limit',
          count: paymentCount,
          max: config.maxTrialsPerPaymentMethod,
          severity: 'high',
        });
        isEligible = false;
        blockReason = blockReason || 'This payment method has already been used for a trial';
      }
    }

    // =========================================
    // CHECK 3: Email Base (detect +alias abuse)
    // =========================================
    if (emailBaseHash) {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - config.emailLookbackDays);

      const { count: emailCount } = await supabaseAdmin
        .from('trial_fingerprints')
        .select('*', { count: 'exact', head: true })
        .eq('email_base_hash', emailBaseHash)
        .gte('created_at', lookbackDate.toISOString());

      if (emailCount >= config.maxTrialsPerEmailBase) {
        abuseScore += config.emailBaseMatchWeight;
        signals.push({
          type: 'email_alias_limit',
          count: emailCount,
          max: config.maxTrialsPerEmailBase,
          severity: 'high',
        });
        isEligible = false;
        blockReason = blockReason || 'This email has already been used for trials';
      }
    }

    // =========================================
    // CHECK 4: IP Address (more lenient)
    // =========================================
    if (ipHash) {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - config.ipLookbackDays);

      const { count: ipCount } = await supabaseAdmin
        .from('trial_fingerprints')
        .select('*', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', lookbackDate.toISOString());

      if (ipCount >= config.maxTrialsPerIp) {
        abuseScore += config.ipMatchWeight;
        signals.push({
          type: 'ip_limit',
          count: ipCount,
          max: config.maxTrialsPerIp,
          severity: 'medium',
        });
        // Don't block for IP alone, but add to score
      }
    }

    // =========================================
    // CHECK 5: Subnet/Household (even more lenient)
    // =========================================
    if (subnetHash) {
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - config.subnetLookbackDays);

      const { count: subnetCount } = await supabaseAdmin
        .from('trial_fingerprints')
        .select('*', { count: 'exact', head: true })
        .eq('ip_subnet_hash', subnetHash)
        .gte('created_at', lookbackDate.toISOString());

      if (subnetCount >= config.maxTrialsPerSubnet) {
        abuseScore += config.subnetMatchWeight;
        signals.push({
          type: 'subnet_limit',
          count: subnetCount,
          max: config.maxTrialsPerSubnet,
          severity: 'low',
        });
        // Don't block for subnet alone
      }
    }

    // =========================================
    // CHECK 6: Abuse Cluster Check
    // =========================================
    const clusterHashes = [deviceHash, paymentHash, emailBaseHash].filter(Boolean);

    for (const clusterHash of clusterHashes) {
      const { data: cluster } = await supabaseAdmin
        .from('trial_abuse_clusters')
        .select('*')
        .eq('cluster_hash', clusterHash)
        .eq('is_blocked', true)
        .single();

      if (cluster) {
        abuseScore = 1.0;
        signals.push({
          type: 'blocked_cluster',
          clusterId: cluster.id,
          clusterType: cluster.cluster_type,
          severity: 'critical',
        });
        isEligible = false;
        blockReason = 'Account associated with blocked abuse cluster';
        break;
      }
    }

    // Cap abuse score
    abuseScore = Math.min(abuseScore, 1.0);

    // Log the check
    logger.info('Trial eligibility check', {
      userId,
      isEligible,
      abuseScore,
      signalCount: signals.length,
      platform,
    });

    return {
      eligible: isEligible,
      reason: blockReason,
      abuseScore,
      signals,
    };
  } catch (error) {
    logger.error('Error checking trial eligibility', { error: error.message, userId });
    // On error, allow trial but flag for review
    return {
      eligible: true,
      reason: null,
      abuseScore: 0,
      signals: [{ type: 'check_error', error: error.message }],
    };
  }
}

/**
 * Record a trial start for fingerprint tracking
 */
async function recordTrialStart({
  userId,
  email,
  deviceFingerprint,
  ipAddress,
  paymentMethod,
  platform = 'web',
  promoCodeId = null,
  creatorId = null,
}) {
  try {
    const deviceHash = deviceFingerprint ? hashData(deviceFingerprint) : null;
    const paymentHash = paymentMethod?.last4 && paymentMethod?.brand
      ? createPaymentFingerprint(paymentMethod.last4, paymentMethod.brand)
      : null;
    const emailHash = email ? hashData(email) : null;
    const emailBase = email ? getEmailBase(email) : null;
    const emailBaseHash = emailBase ? hashData(emailBase) : null;
    const ipHash = ipAddress ? hashData(ipAddress) : null;
    const subnet = ipAddress ? getIPSubnet(ipAddress) : null;
    const subnetHash = subnet ? hashData(subnet) : null;

    // Insert fingerprint record
    const { data: fingerprint, error } = await supabaseAdmin
      .from('trial_fingerprints')
      .insert({
        user_id: userId,
        device_fingerprint: deviceHash,
        payment_fingerprint: paymentHash,
        email_hash: emailHash,
        email_base_hash: emailBaseHash,
        ip_hash: ipHash,
        ip_subnet_hash: subnetHash,
        platform,
        promo_code_id: promoCodeId,
        creator_id: creatorId,
        trial_started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Error recording trial fingerprint', { error, userId });
      return null;
    }

    // Update abuse clusters
    await updateAbuseClusters({
      deviceHash,
      paymentHash,
      emailBaseHash,
      userId,
      emailHash,
      fingerprintId: fingerprint.id,
    });

    // Log event
    await logAbuseEvent('trial_attempted', {
      userId,
      trialFingerprintId: fingerprint.id,
      signals: [],
      platform,
      ipAddressHash: ipHash,
      deviceFingerprintHash: deviceHash,
    });

    logger.info('Trial fingerprint recorded', {
      fingerprintId: fingerprint.id,
      userId,
      platform,
    });

    return fingerprint;
  } catch (error) {
    logger.error('Error recording trial start', { error: error.message, userId });
    return null;
  }
}

/**
 * Update or create abuse clusters based on fingerprints
 */
async function updateAbuseClusters({
  deviceHash,
  paymentHash,
  emailBaseHash,
  userId,
  emailHash,
  fingerprintId,
}) {
  const config = await getConfig();
  const clustersToUpdate = [];

  if (deviceHash) {
    clustersToUpdate.push({ type: 'device', hash: deviceHash });
  }
  if (paymentHash) {
    clustersToUpdate.push({ type: 'payment', hash: paymentHash });
  }
  if (emailBaseHash) {
    clustersToUpdate.push({ type: 'email_alias', hash: emailBaseHash });
  }

  for (const { type, hash } of clustersToUpdate) {
    // Try to upsert the cluster
    const { data: existing } = await supabaseAdmin
      .from('trial_abuse_clusters')
      .select('*')
      .eq('cluster_type', type)
      .eq('cluster_hash', hash)
      .single();

    if (existing) {
      // Update existing cluster
      const userIds = existing.user_ids || [];
      const emailHashes = existing.email_hashes || [];

      if (userId && !userIds.includes(userId)) {
        userIds.push(userId);
      }
      if (emailHash && !emailHashes.includes(emailHash)) {
        emailHashes.push(emailHash);
      }

      const newTrialCount = existing.trial_count + 1;
      const shouldFlag = newTrialCount >= config.clusterFlagThreshold;
      const shouldBlock = newTrialCount >= config.clusterBlockThreshold;

      await supabaseAdmin
        .from('trial_abuse_clusters')
        .update({
          trial_count: newTrialCount,
          user_ids: userIds,
          email_hashes: emailHashes,
          is_flagged: shouldFlag || existing.is_flagged,
          is_blocked: shouldBlock || existing.is_blocked,
          review_status: shouldBlock ? 'auto_blocked' : (shouldFlag ? 'pending' : existing.review_status),
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      // Log cluster events
      if (shouldBlock && !existing.is_blocked) {
        await logAbuseEvent('cluster_blocked', {
          clusterId: existing.id,
          trialFingerprintId: fingerprintId,
          signals: { trialCount: newTrialCount, type },
        });
      } else if (shouldFlag && !existing.is_flagged) {
        await logAbuseEvent('cluster_flagged', {
          clusterId: existing.id,
          trialFingerprintId: fingerprintId,
          signals: { trialCount: newTrialCount, type },
        });
      }
    } else {
      // Create new cluster
      await supabaseAdmin
        .from('trial_abuse_clusters')
        .insert({
          cluster_type: type,
          cluster_hash: hash,
          trial_count: 1,
          user_ids: userId ? [userId] : [],
          email_hashes: emailHash ? [emailHash] : [],
        });

      await logAbuseEvent('cluster_created', {
        trialFingerprintId: fingerprintId,
        signals: { type, hash: hash.substring(0, 16) + '...' },
      });
    }
  }
}

/**
 * Log an abuse event
 */
async function logAbuseEvent(eventType, {
  userId = null,
  trialFingerprintId = null,
  clusterId = null,
  signals = {},
  abuseScore = null,
  blockedReason = null,
  ipAddressHash = null,
  deviceFingerprintHash = null,
  platform = null,
}) {
  try {
    await supabaseAdmin
      .from('trial_abuse_events')
      .insert({
        event_type: eventType,
        user_id: userId,
        trial_fingerprint_id: trialFingerprintId,
        cluster_id: clusterId,
        signals,
        abuse_score: abuseScore,
        blocked_reason: blockedReason,
        ip_address_hash: ipAddressHash,
        device_fingerprint_hash: deviceFingerprintHash,
        platform,
      });
  } catch (error) {
    logger.error('Error logging abuse event', { error: error.message, eventType });
  }
}

/**
 * Mark a trial as converted (user subscribed)
 */
async function markTrialConverted(userId) {
  try {
    await supabaseAdmin
      .from('trial_fingerprints')
      .update({
        trial_converted: true,
        trial_ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .is('trial_ended_at', null);

    return true;
  } catch (error) {
    logger.error('Error marking trial converted', { error: error.message, userId });
    return false;
  }
}

/**
 * Mark a trial as ended (without conversion)
 */
async function markTrialEnded(userId) {
  try {
    await supabaseAdmin
      .from('trial_fingerprints')
      .update({
        trial_ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .is('trial_ended_at', null);

    return true;
  } catch (error) {
    logger.error('Error marking trial ended', { error: error.message, userId });
    return false;
  }
}

/**
 * Block a user for trial abuse
 */
async function blockUserForAbuse(userId, reason) {
  try {
    // Update trial fingerprints
    await supabaseAdmin
      .from('trial_fingerprints')
      .update({
        is_blocked: true,
        blocked_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Log event
    await logAbuseEvent('user_blocked', {
      userId,
      blockedReason: reason,
    });

    logger.warn('User blocked for trial abuse', { userId, reason });

    return true;
  } catch (error) {
    logger.error('Error blocking user for abuse', { error: error.message, userId });
    return false;
  }
}

/**
 * Get abuse summary for admin review
 */
async function getAbuseSummary({ flaggedOnly = true, limit = 50 } = {}) {
  let query = supabaseAdmin
    .from('trial_abuse_clusters')
    .select('*')
    .order('trial_count', { ascending: false })
    .limit(limit);

  if (flaggedOnly) {
    query = query.or('is_flagged.eq.true,is_blocked.eq.true');
  }

  const { data: clusters, error } = await query;

  if (error) {
    logger.error('Error fetching abuse summary', { error });
    return { clusters: [], stats: {} };
  }

  // Get stats
  const { count: totalClusters } = await supabaseAdmin
    .from('trial_abuse_clusters')
    .select('*', { count: 'exact', head: true });

  const { count: flaggedClusters } = await supabaseAdmin
    .from('trial_abuse_clusters')
    .select('*', { count: 'exact', head: true })
    .eq('is_flagged', true);

  const { count: blockedClusters } = await supabaseAdmin
    .from('trial_abuse_clusters')
    .select('*', { count: 'exact', head: true })
    .eq('is_blocked', true);

  const { count: recentTrials } = await supabaseAdmin
    .from('trial_fingerprints')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  return {
    clusters: clusters || [],
    stats: {
      totalClusters: totalClusters || 0,
      flaggedClusters: flaggedClusters || 0,
      blockedClusters: blockedClusters || 0,
      recentTrials: recentTrials || 0,
    },
  };
}

/**
 * Review and update a cluster's status
 */
async function reviewCluster(clusterId, { action, reviewedBy, notes }) {
  try {
    const updates = {
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      notes,
      updated_at: new Date().toISOString(),
    };

    switch (action) {
      case 'clear':
        updates.review_status = 'cleared';
        updates.is_flagged = false;
        updates.is_blocked = false;
        break;
      case 'confirm_abuse':
        updates.review_status = 'confirmed_abuse';
        updates.is_blocked = true;
        break;
      case 'block':
        updates.review_status = 'auto_blocked';
        updates.is_blocked = true;
        break;
      default:
        throw new Error('Invalid action');
    }

    await supabaseAdmin
      .from('trial_abuse_clusters')
      .update(updates)
      .eq('id', clusterId);

    await logAbuseEvent(action === 'clear' ? 'cluster_cleared' : 'abuse_confirmed', {
      clusterId,
      signals: { action, reviewedBy },
    });

    return true;
  } catch (error) {
    logger.error('Error reviewing cluster', { error: error.message, clusterId });
    return false;
  }
}

module.exports = {
  checkTrialEligibility,
  recordTrialStart,
  markTrialConverted,
  markTrialEnded,
  blockUserForAbuse,
  getAbuseSummary,
  reviewCluster,
  logAbuseEvent,
  hashData,
  getEmailBase,
  getIPSubnet,
  createPaymentFingerprint,
  getConfig,
  DEFAULT_CONFIG,
};
