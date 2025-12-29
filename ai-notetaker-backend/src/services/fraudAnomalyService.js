/**
 * Fraud Anomaly Detection Service
 * Implements Rule 10: Automatic fraud & anomaly flagging
 *
 * AUTO-FLAG CREATORS WHEN:
 * 1. 40-50% of referred users refund or chargeback
 * 2. Multiple signups share device IPs or fingerprints
 * 3. 10+ paid signups happen within same 1-2 hours (velocity spike)
 * 4. Signups all share same BIN (virtual card farm behavior)
 * 5. Highly suspicious geos unrelated to creator audience
 *
 * ACTIONS:
 * - Freeze commission
 * - Require manual review
 * - Optional creator suspension
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

/**
 * Default anomaly detection configuration
 */
const DEFAULT_CONFIG = {
  // Refund thresholds
  refundRateThreshold: 40.00,      // 40%
  minReferralsForRefundCheck: 5,
  refundLookbackDays: 90,

  // Device/IP clustering
  maxSignupsPerDevice: 2,
  maxSignupsPerIp: 3,
  maxSignupsPerSubnet: 5,
  deviceIpLookbackDays: 30,

  // Velocity
  maxSignupsPerVelocityWindow: 10,
  velocityWindowHours: 2,

  // BIN clustering
  maxSignupsPerBin: 3,
  binLookbackDays: 30,

  // Geo anomaly
  geoAnomalyThreshold: 80.00,      // 80%
  minSignupsForGeoCheck: 10,

  // Auto-actions
  autoFreezeOnFlag: true,
  autoSuspendOnSevere: false,
  severeFraudThreshold: 0.90,
};

/**
 * Flag types and their base severity scores
 */
const FLAG_TYPES = {
  HIGH_REFUND_RATE: { type: 'high_refund_rate', baseSeverity: 0.80 },
  DEVICE_CLUSTERING: { type: 'device_clustering', baseSeverity: 0.85 },
  IP_CLUSTERING: { type: 'ip_clustering', baseSeverity: 0.70 },
  SUBNET_CLUSTERING: { type: 'subnet_clustering', baseSeverity: 0.50 },
  VELOCITY_SPIKE: { type: 'velocity_spike', baseSeverity: 0.75 },
  BIN_CLUSTERING: { type: 'bin_clustering', baseSeverity: 0.90 },
  GEO_ANOMALY: { type: 'geo_anomaly', baseSeverity: 0.60 },
  SELF_REFERRAL: { type: 'self_referral', baseSeverity: 1.00 },
  SYNTHETIC_IDENTITY: { type: 'synthetic_identity', baseSeverity: 0.95 },
  MANUAL_FLAG: { type: 'manual_flag', baseSeverity: 0.50 },
};

/**
 * Get fraud anomaly configuration
 */
async function getConfig() {
  try {
    const { data: config, error } = await supabaseAdmin
      .from('creator_fraud_anomaly_config')
      .select('*')
      .eq('is_active', true)
      .single();

    if (error || !config) {
      return DEFAULT_CONFIG;
    }

    return {
      refundRateThreshold: parseFloat(config.refund_rate_threshold_percent),
      minReferralsForRefundCheck: config.min_referrals_for_refund_check,
      refundLookbackDays: config.refund_lookback_days,
      maxSignupsPerDevice: config.max_signups_per_device,
      maxSignupsPerIp: config.max_signups_per_ip,
      maxSignupsPerSubnet: config.max_signups_per_subnet,
      deviceIpLookbackDays: config.device_ip_lookback_days,
      maxSignupsPerVelocityWindow: config.max_signups_per_velocity_window,
      velocityWindowHours: config.velocity_window_hours,
      maxSignupsPerBin: config.max_signups_per_bin,
      binLookbackDays: config.bin_lookback_days,
      geoAnomalyThreshold: parseFloat(config.geo_anomaly_threshold_percent),
      minSignupsForGeoCheck: config.min_signups_for_geo_check,
      autoFreezeOnFlag: config.auto_freeze_on_flag,
      autoSuspendOnSevere: config.auto_suspend_on_severe,
      severeFraudThreshold: parseFloat(config.severe_fraud_threshold),
    };
  } catch (error) {
    logger.error('Error fetching fraud config', { error: error.message });
    return DEFAULT_CONFIG;
  }
}

/**
 * Check for high refund/chargeback rate
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} config - Configuration
 * @returns {Object|null} Anomaly if detected
 */
async function checkRefundRate(creatorId, config) {
  try {
    const { data: stats, error } = await supabaseAdmin.rpc('get_creator_refund_rate', {
      p_creator_id: creatorId,
      p_lookback_days: config.refundLookbackDays,
    });

    if (error || !stats || stats.length === 0) {
      return null;
    }

    const result = stats[0];

    // Skip if not enough referrals
    if (result.total_earnings < config.minReferralsForRefundCheck) {
      return null;
    }

    // Check if refund rate exceeds threshold
    if (result.combined_rate >= config.refundRateThreshold) {
      const severity = Math.min(1.0,
        FLAG_TYPES.HIGH_REFUND_RATE.baseSeverity +
        ((result.combined_rate - config.refundRateThreshold) / 100) * 0.2
      );

      return {
        type: FLAG_TYPES.HIGH_REFUND_RATE.type,
        severity,
        evidence: {
          totalEarnings: result.total_earnings,
          refundedEarnings: result.refunded_earnings,
          chargebackEarnings: result.chargeback_earnings,
          refundRate: parseFloat(result.refund_rate),
          chargebackRate: parseFloat(result.chargeback_rate),
          combinedRate: parseFloat(result.combined_rate),
          threshold: config.refundRateThreshold,
          lookbackDays: config.refundLookbackDays,
        },
      };
    }

    return null;
  } catch (error) {
    logger.error('Error checking refund rate', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Check for device/IP clustering
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} config - Configuration
 * @returns {Array} Anomalies if detected
 */
async function checkDeviceIpClustering(creatorId, config) {
  const anomalies = [];

  try {
    // Get redemptions with fingerprints
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - config.deviceIpLookbackDays);

    const { data: redemptions, error } = await supabaseAdmin
      .from('promo_redemptions')
      .select('id, device_fingerprint, ip_address, ip_subnet, user_id')
      .eq('creator_id', creatorId)
      .gte('created_at', lookbackStart.toISOString())
      .not('device_fingerprint', 'is', null);

    if (error || !redemptions || redemptions.length === 0) {
      return anomalies;
    }

    // Count by device fingerprint
    const deviceCounts = {};
    const ipCounts = {};
    const subnetCounts = {};

    for (const r of redemptions) {
      if (r.device_fingerprint) {
        deviceCounts[r.device_fingerprint] = (deviceCounts[r.device_fingerprint] || []);
        deviceCounts[r.device_fingerprint].push(r.id);
      }
      if (r.ip_address) {
        ipCounts[r.ip_address] = (ipCounts[r.ip_address] || []);
        ipCounts[r.ip_address].push(r.id);
      }
      if (r.ip_subnet) {
        subnetCounts[r.ip_subnet] = (subnetCounts[r.ip_subnet] || []);
        subnetCounts[r.ip_subnet].push(r.id);
      }
    }

    // Check device clustering
    for (const [fingerprint, redemptionIds] of Object.entries(deviceCounts)) {
      if (redemptionIds.length > config.maxSignupsPerDevice) {
        const severity = Math.min(1.0,
          FLAG_TYPES.DEVICE_CLUSTERING.baseSeverity +
          ((redemptionIds.length - config.maxSignupsPerDevice) * 0.05)
        );

        anomalies.push({
          type: FLAG_TYPES.DEVICE_CLUSTERING.type,
          severity,
          evidence: {
            deviceFingerprint: fingerprint.substring(0, 16) + '...',
            signupCount: redemptionIds.length,
            threshold: config.maxSignupsPerDevice,
            redemptionIds,
          },
        });
      }
    }

    // Check IP clustering
    for (const [ip, redemptionIds] of Object.entries(ipCounts)) {
      if (redemptionIds.length > config.maxSignupsPerIp) {
        const severity = Math.min(1.0,
          FLAG_TYPES.IP_CLUSTERING.baseSeverity +
          ((redemptionIds.length - config.maxSignupsPerIp) * 0.05)
        );

        anomalies.push({
          type: FLAG_TYPES.IP_CLUSTERING.type,
          severity,
          evidence: {
            ipHash: ip.substring(0, 16) + '...',
            signupCount: redemptionIds.length,
            threshold: config.maxSignupsPerIp,
            redemptionIds,
          },
        });
      }
    }

    // Check subnet clustering
    for (const [subnet, redemptionIds] of Object.entries(subnetCounts)) {
      if (redemptionIds.length > config.maxSignupsPerSubnet) {
        const severity = Math.min(1.0,
          FLAG_TYPES.SUBNET_CLUSTERING.baseSeverity +
          ((redemptionIds.length - config.maxSignupsPerSubnet) * 0.03)
        );

        anomalies.push({
          type: FLAG_TYPES.SUBNET_CLUSTERING.type,
          severity,
          evidence: {
            subnetHash: subnet.substring(0, 16) + '...',
            signupCount: redemptionIds.length,
            threshold: config.maxSignupsPerSubnet,
            redemptionIds,
          },
        });
      }
    }

    return anomalies;
  } catch (error) {
    logger.error('Error checking device/IP clustering', { creatorId, error: error.message });
    return anomalies;
  }
}

/**
 * Check for velocity spikes (too many signups too fast)
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} config - Configuration
 * @returns {Object|null} Anomaly if detected
 */
async function checkVelocitySpike(creatorId, config) {
  try {
    // Get signups in the last 7 days grouped by hour
    const { data: redemptions, error } = await supabaseAdmin
      .from('promo_redemptions')
      .select('id, created_at')
      .eq('creator_id', creatorId)
      .eq('attribution_status', 'attributed')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    if (error || !redemptions || redemptions.length === 0) {
      return null;
    }

    // Check for velocity spikes using sliding window
    const windowMs = config.velocityWindowHours * 60 * 60 * 1000;
    let maxInWindow = 0;
    let spikeStart = null;
    let spikeEnd = null;
    let spikeRedemptionIds = [];

    for (let i = 0; i < redemptions.length; i++) {
      const windowStart = new Date(redemptions[i].created_at);
      const windowEnd = new Date(windowStart.getTime() + windowMs);

      const inWindow = redemptions.filter(r => {
        const t = new Date(r.created_at);
        return t >= windowStart && t <= windowEnd;
      });

      if (inWindow.length > maxInWindow) {
        maxInWindow = inWindow.length;
        spikeStart = windowStart;
        spikeEnd = windowEnd;
        spikeRedemptionIds = inWindow.map(r => r.id);
      }
    }

    if (maxInWindow > config.maxSignupsPerVelocityWindow) {
      const severity = Math.min(1.0,
        FLAG_TYPES.VELOCITY_SPIKE.baseSeverity +
        ((maxInWindow - config.maxSignupsPerVelocityWindow) * 0.02)
      );

      return {
        type: FLAG_TYPES.VELOCITY_SPIKE.type,
        severity,
        evidence: {
          signupCount: maxInWindow,
          threshold: config.maxSignupsPerVelocityWindow,
          windowHours: config.velocityWindowHours,
          spikeWindowStart: spikeStart?.toISOString(),
          spikeWindowEnd: spikeEnd?.toISOString(),
          redemptionIds: spikeRedemptionIds,
        },
      };
    }

    return null;
  } catch (error) {
    logger.error('Error checking velocity spike', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Check for BIN clustering (virtual card farm detection)
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} config - Configuration
 * @returns {Object|null} Anomaly if detected
 */
async function checkBinClustering(creatorId, config) {
  try {
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - config.binLookbackDays);

    const { data: redemptions, error } = await supabaseAdmin
      .from('promo_redemptions')
      .select('id, card_bin_hash')
      .eq('creator_id', creatorId)
      .gte('created_at', lookbackStart.toISOString())
      .not('card_bin_hash', 'is', null);

    if (error || !redemptions || redemptions.length === 0) {
      return null;
    }

    // Count by BIN
    const binCounts = {};
    for (const r of redemptions) {
      binCounts[r.card_bin_hash] = (binCounts[r.card_bin_hash] || []);
      binCounts[r.card_bin_hash].push(r.id);
    }

    // Find the BIN with highest count
    let maxBin = null;
    let maxCount = 0;
    let maxRedemptionIds = [];

    for (const [bin, redemptionIds] of Object.entries(binCounts)) {
      if (redemptionIds.length > maxCount) {
        maxCount = redemptionIds.length;
        maxBin = bin;
        maxRedemptionIds = redemptionIds;
      }
    }

    if (maxCount > config.maxSignupsPerBin) {
      // BIN clustering is highly suspicious - likely virtual card farm
      const severity = Math.min(1.0,
        FLAG_TYPES.BIN_CLUSTERING.baseSeverity +
        ((maxCount - config.maxSignupsPerBin) * 0.03)
      );

      return {
        type: FLAG_TYPES.BIN_CLUSTERING.type,
        severity,
        evidence: {
          binHash: maxBin.substring(0, 8) + '...',
          signupCount: maxCount,
          threshold: config.maxSignupsPerBin,
          totalUniqueBins: Object.keys(binCounts).length,
          redemptionIds: maxRedemptionIds,
        },
      };
    }

    return null;
  } catch (error) {
    logger.error('Error checking BIN clustering', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Check for geographic anomalies
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} config - Configuration
 * @returns {Object|null} Anomaly if detected
 */
async function checkGeoAnomaly(creatorId, config) {
  try {
    const { data: redemptions, error } = await supabaseAdmin
      .from('promo_redemptions')
      .select('id, geo_country, geo_region')
      .eq('creator_id', creatorId)
      .not('geo_country', 'is', null);

    if (error || !redemptions || redemptions.length < config.minSignupsForGeoCheck) {
      return null;
    }

    // Get creator's expected geography (from their social profile)
    const { data: creator } = await supabaseAdmin
      .from('creators')
      .select('social_platform, social_url')
      .eq('id', creatorId)
      .single();

    // Count signups by country
    const countryCounts = {};
    for (const r of redemptions) {
      countryCounts[r.geo_country] = (countryCounts[r.geo_country] || 0) + 1;
    }

    // Find the dominant country (expected audience)
    let dominantCountry = null;
    let dominantCount = 0;
    for (const [country, count] of Object.entries(countryCounts)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantCountry = country;
      }
    }

    // Check if there's a suspicious concentration from unexpected geos
    // This is a simplified check - in production, you'd compare against expected audience
    const suspiciousGeos = ['RU', 'CN', 'IN', 'PK', 'BD', 'NG', 'VN']; // High fraud regions
    let suspiciousCount = 0;
    let suspiciousCountries = [];

    for (const [country, count] of Object.entries(countryCounts)) {
      if (suspiciousGeos.includes(country)) {
        suspiciousCount += count;
        suspiciousCountries.push({ country, count });
      }
    }

    const suspiciousPercent = (suspiciousCount / redemptions.length) * 100;

    if (suspiciousPercent >= config.geoAnomalyThreshold) {
      const severity = Math.min(1.0,
        FLAG_TYPES.GEO_ANOMALY.baseSeverity +
        ((suspiciousPercent - config.geoAnomalyThreshold) / 100) * 0.3
      );

      return {
        type: FLAG_TYPES.GEO_ANOMALY.type,
        severity,
        evidence: {
          totalSignups: redemptions.length,
          suspiciousCount,
          suspiciousPercent: Math.round(suspiciousPercent * 100) / 100,
          threshold: config.geoAnomalyThreshold,
          suspiciousCountries,
          dominantCountry,
          dominantPercent: Math.round((dominantCount / redemptions.length) * 100),
        },
      };
    }

    return null;
  } catch (error) {
    logger.error('Error checking geo anomaly', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Create a fraud flag for a creator
 *
 * @param {string} creatorId - Creator's ID
 * @param {Object} anomaly - Detected anomaly
 * @param {Object} config - Configuration
 * @returns {Object} Created flag
 */
async function createFraudFlag(creatorId, anomaly, config) {
  try {
    // Check if similar active flag already exists
    const { data: existingFlag } = await supabaseAdmin
      .from('creator_fraud_flags')
      .select('id')
      .eq('creator_id', creatorId)
      .eq('flag_type', anomaly.type)
      .eq('status', 'active')
      .single();

    if (existingFlag) {
      // Update existing flag with new evidence
      const { data: updatedFlag, error } = await supabaseAdmin
        .from('creator_fraud_flags')
        .update({
          severity_score: Math.max(anomaly.severity, 0),
          evidence: anomaly.evidence,
          affected_redemption_ids: anomaly.evidence.redemptionIds || [],
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingFlag.id)
        .select()
        .single();

      if (error) {
        logger.error('Error updating fraud flag', { error });
        return null;
      }

      return updatedFlag;
    }

    // Create new flag
    const { data: flag, error } = await supabaseAdmin
      .from('creator_fraud_flags')
      .insert({
        creator_id: creatorId,
        flag_type: anomaly.type,
        severity_score: anomaly.severity,
        evidence: anomaly.evidence,
        status: 'active',
        affected_redemption_ids: anomaly.evidence.redemptionIds || [],
        commission_frozen: config.autoFreezeOnFlag,
        commission_frozen_at: config.autoFreezeOnFlag ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating fraud flag', { error });
      return null;
    }

    logger.warn('Fraud flag created', {
      creatorId,
      flagId: flag.id,
      flagType: anomaly.type,
      severity: anomaly.severity,
    });

    return flag;
  } catch (error) {
    logger.error('Error in createFraudFlag', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Apply fraud actions to creator (freeze, suspend, etc.)
 *
 * @param {string} creatorId - Creator's ID
 * @param {Array} anomalies - Detected anomalies
 * @param {Object} config - Configuration
 */
async function applyFraudActions(creatorId, anomalies, config) {
  if (anomalies.length === 0) return;

  const maxSeverity = Math.max(...anomalies.map(a => a.severity));
  const flagTypes = anomalies.map(a => a.type);

  const updates = {
    fraud_risk_score: maxSeverity,
    active_fraud_flags: anomalies.length,
    requires_fraud_review: true,
    last_fraud_scan_at: new Date().toISOString(),
  };

  // Auto-freeze commissions if enabled
  if (config.autoFreezeOnFlag) {
    updates.commission_frozen = true;
    updates.commission_frozen_at = new Date().toISOString();
    updates.commission_frozen_reason = `Auto-frozen: ${flagTypes.join(', ')}`;
  }

  // Auto-suspend if severity exceeds threshold
  if (config.autoSuspendOnSevere && maxSeverity >= config.severeFraudThreshold) {
    updates.status = 'suspended';

    logger.warn('Creator auto-suspended for severe fraud', {
      creatorId,
      maxSeverity,
      flagTypes,
    });
  }

  const { error } = await supabaseAdmin
    .from('creators')
    .update(updates)
    .eq('id', creatorId);

  if (error) {
    logger.error('Error applying fraud actions', { creatorId, error });
  }
}

/**
 * Scan a single creator for fraud anomalies
 *
 * @param {string} creatorId - Creator's ID
 * @param {string} scanType - 'scheduled', 'triggered', or 'manual'
 * @returns {Object} Scan results
 */
async function scanCreatorForAnomalies(creatorId, scanType = 'triggered') {
  const startTime = Date.now();
  const anomalies = [];

  try {
    const config = await getConfig();

    // Create scan record
    const { data: scan, error: scanError } = await supabaseAdmin
      .from('creator_fraud_scans')
      .insert({
        creator_id: creatorId,
        scan_type: scanType,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run all anomaly checks in parallel
    const [
      refundAnomaly,
      deviceIpAnomalies,
      velocityAnomaly,
      binAnomaly,
      geoAnomaly,
    ] = await Promise.all([
      checkRefundRate(creatorId, config),
      checkDeviceIpClustering(creatorId, config),
      checkVelocitySpike(creatorId, config),
      checkBinClustering(creatorId, config),
      checkGeoAnomaly(creatorId, config),
    ]);

    // Collect all anomalies
    if (refundAnomaly) anomalies.push(refundAnomaly);
    if (deviceIpAnomalies) anomalies.push(...deviceIpAnomalies);
    if (velocityAnomaly) anomalies.push(velocityAnomaly);
    if (binAnomaly) anomalies.push(binAnomaly);
    if (geoAnomaly) anomalies.push(geoAnomaly);

    // Create flags for detected anomalies
    const createdFlags = [];
    for (const anomaly of anomalies) {
      const flag = await createFraudFlag(creatorId, anomaly, config);
      if (flag) createdFlags.push(flag);
    }

    // Apply fraud actions if anomalies detected
    if (anomalies.length > 0) {
      await applyFraudActions(creatorId, anomalies, config);
    } else {
      // Update last scan time even if no anomalies
      await supabaseAdmin
        .from('creators')
        .update({ last_fraud_scan_at: new Date().toISOString() })
        .eq('id', creatorId);
    }

    const duration = Date.now() - startTime;

    // Update scan record
    if (scan) {
      await supabaseAdmin
        .from('creator_fraud_scans')
        .update({
          flags_created: createdFlags.length,
          anomalies_detected: anomalies,
          scan_metrics: {
            checksRun: 5,
            anomaliesFound: anomalies.length,
            flagsCreated: createdFlags.length,
          },
          completed_at: new Date().toISOString(),
          duration_ms: duration,
        })
        .eq('id', scan.id);
    }

    logger.info('Creator fraud scan complete', {
      creatorId,
      scanType,
      anomaliesFound: anomalies.length,
      flagsCreated: createdFlags.length,
      durationMs: duration,
    });

    return {
      creatorId,
      scanType,
      anomalies,
      flags: createdFlags,
      duration,
    };
  } catch (error) {
    logger.error('Error scanning creator for anomalies', { creatorId, error: error.message });
    return {
      creatorId,
      scanType,
      anomalies: [],
      flags: [],
      error: error.message,
    };
  }
}

/**
 * Scan all active creators for fraud anomalies
 * This should be run as a scheduled job (e.g., daily)
 *
 * @returns {Object} Scan results summary
 */
async function scanAllCreatorsForAnomalies() {
  logger.info('Starting full fraud anomaly scan');
  const startTime = Date.now();

  try {
    // Get all active creators
    const { data: creators, error } = await supabaseAdmin
      .from('creators')
      .select('id')
      .eq('status', 'active');

    if (error || !creators) {
      logger.error('Error fetching creators for fraud scan', { error });
      return { success: false, error: error?.message };
    }

    let scanned = 0;
    let flagged = 0;
    let totalFlags = 0;
    const errors = [];

    // Scan each creator
    for (const creator of creators) {
      try {
        const result = await scanCreatorForAnomalies(creator.id, 'scheduled');
        scanned++;

        if (result.anomalies.length > 0) {
          flagged++;
          totalFlags += result.flags.length;
        }
      } catch (error) {
        errors.push({ creatorId: creator.id, error: error.message });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Full fraud anomaly scan complete', {
      scanned,
      flagged,
      totalFlags,
      errors: errors.length,
      durationMs: duration,
    });

    return {
      success: true,
      scanned,
      flagged,
      totalFlags,
      errors,
      durationMs: duration,
    };
  } catch (error) {
    logger.error('Error in full fraud scan', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get creator's fraud status
 *
 * @param {string} creatorId - Creator's ID
 * @returns {Object} Fraud status
 */
async function getCreatorFraudStatus(creatorId) {
  try {
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('creators')
      .select(`
        fraud_risk_score,
        active_fraud_flags,
        commission_frozen,
        commission_frozen_at,
        commission_frozen_reason,
        last_fraud_scan_at,
        requires_fraud_review
      `)
      .eq('id', creatorId)
      .single();

    if (creatorError) {
      return null;
    }

    const { data: flags, error: flagsError } = await supabaseAdmin
      .from('creator_fraud_flags')
      .select('*')
      .eq('creator_id', creatorId)
      .eq('status', 'active')
      .order('severity_score', { ascending: false });

    return {
      riskScore: parseFloat(creator.fraud_risk_score) || 0,
      activeFlagCount: creator.active_fraud_flags || 0,
      commissionFrozen: creator.commission_frozen || false,
      commissionFrozenAt: creator.commission_frozen_at,
      commissionFrozenReason: creator.commission_frozen_reason,
      lastScanAt: creator.last_fraud_scan_at,
      requiresReview: creator.requires_fraud_review || false,
      activeFlags: flags?.map(f => ({
        id: f.id,
        type: f.flag_type,
        severity: parseFloat(f.severity_score),
        status: f.status,
        evidence: f.evidence,
        createdAt: f.created_at,
      })) || [],
    };
  } catch (error) {
    logger.error('Error getting creator fraud status', { creatorId, error: error.message });
    return null;
  }
}

/**
 * Review and resolve a fraud flag
 *
 * @param {string} flagId - Flag ID
 * @param {Object} resolution - Resolution details
 * @param {string} resolution.status - 'confirmed', 'dismissed', or 'resolved'
 * @param {string} resolution.reviewedBy - Admin email/ID
 * @param {string} resolution.notes - Review notes
 * @param {boolean} resolution.unfreezeCommissions - Whether to unfreeze
 * @param {boolean} resolution.unsuspendCreator - Whether to unsuspend
 */
async function resolveFraudFlag(flagId, resolution) {
  try {
    const { data: flag, error: flagError } = await supabaseAdmin
      .from('creator_fraud_flags')
      .select('*')
      .eq('id', flagId)
      .single();

    if (flagError || !flag) {
      throw new Error('Flag not found');
    }

    // Update flag
    const { error: updateError } = await supabaseAdmin
      .from('creator_fraud_flags')
      .update({
        status: resolution.status,
        reviewed_by: resolution.reviewedBy,
        reviewed_at: new Date().toISOString(),
        review_notes: resolution.notes,
        resolution_notes: resolution.resolutionNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flagId);

    if (updateError) {
      throw updateError;
    }

    // Count remaining active flags
    const { count } = await supabaseAdmin
      .from('creator_fraud_flags')
      .select('id', { count: 'exact' })
      .eq('creator_id', flag.creator_id)
      .eq('status', 'active');

    // Update creator status
    const creatorUpdates = {
      active_fraud_flags: count || 0,
      requires_fraud_review: (count || 0) > 0,
    };

    if (resolution.unfreezeCommissions) {
      creatorUpdates.commission_frozen = false;
      creatorUpdates.commission_frozen_at = null;
      creatorUpdates.commission_frozen_reason = null;
    }

    if (resolution.unsuspendCreator) {
      creatorUpdates.status = 'active';
    }

    // Recalculate risk score based on remaining flags
    if ((count || 0) === 0) {
      creatorUpdates.fraud_risk_score = 0;
    } else {
      const { data: remainingFlags } = await supabaseAdmin
        .from('creator_fraud_flags')
        .select('severity_score')
        .eq('creator_id', flag.creator_id)
        .eq('status', 'active');

      if (remainingFlags && remainingFlags.length > 0) {
        creatorUpdates.fraud_risk_score = Math.max(...remainingFlags.map(f => parseFloat(f.severity_score)));
      }
    }

    await supabaseAdmin
      .from('creators')
      .update(creatorUpdates)
      .eq('id', flag.creator_id);

    logger.info('Fraud flag resolved', {
      flagId,
      creatorId: flag.creator_id,
      resolution: resolution.status,
      reviewedBy: resolution.reviewedBy,
    });

    return { success: true };
  } catch (error) {
    logger.error('Error resolving fraud flag', { flagId, error: error.message });
    throw error;
  }
}

/**
 * Manually freeze creator's commissions
 *
 * @param {string} creatorId - Creator's ID
 * @param {string} reason - Reason for freeze
 * @param {string} freezedBy - Admin who froze
 */
async function freezeCreatorCommissions(creatorId, reason, freezedBy) {
  try {
    const { error } = await supabaseAdmin
      .from('creators')
      .update({
        commission_frozen: true,
        commission_frozen_at: new Date().toISOString(),
        commission_frozen_reason: reason,
        requires_fraud_review: true,
      })
      .eq('id', creatorId);

    if (error) throw error;

    // Create manual flag
    await supabaseAdmin
      .from('creator_fraud_flags')
      .insert({
        creator_id: creatorId,
        flag_type: 'manual_flag',
        severity_score: 0.50,
        evidence: { reason, freezedBy, action: 'commission_freeze' },
        status: 'active',
        commission_frozen: true,
        commission_frozen_at: new Date().toISOString(),
      });

    logger.info('Creator commissions frozen', { creatorId, reason, freezedBy });
    return { success: true };
  } catch (error) {
    logger.error('Error freezing creator commissions', { creatorId, error: error.message });
    throw error;
  }
}

/**
 * Unfreeze creator's commissions
 *
 * @param {string} creatorId - Creator's ID
 * @param {string} reason - Reason for unfreeze
 * @param {string} unfreezeBy - Admin who unfroze
 */
async function unfreezeCreatorCommissions(creatorId, reason, unfreezeBy) {
  try {
    const { error } = await supabaseAdmin
      .from('creators')
      .update({
        commission_frozen: false,
        commission_frozen_at: null,
        commission_frozen_reason: null,
      })
      .eq('id', creatorId);

    if (error) throw error;

    logger.info('Creator commissions unfrozen', { creatorId, reason, unfreezeBy });
    return { success: true };
  } catch (error) {
    logger.error('Error unfreezing creator commissions', { creatorId, error: error.message });
    throw error;
  }
}

/**
 * Record refund for a creator's earning
 * Call this when a refund is processed
 *
 * @param {string} earningId - Earning ID
 * @param {boolean} isChargeback - Whether this is a chargeback (not just refund)
 */
async function recordEarningRefund(earningId, isChargeback = false) {
  try {
    const { data: earning, error: fetchError } = await supabaseAdmin
      .from('creator_earnings')
      .select('id, creator_id')
      .eq('id', earningId)
      .single();

    if (fetchError || !earning) {
      logger.error('Earning not found for refund recording', { earningId });
      return;
    }

    const updates = {
      was_refunded: true,
      refunded_at: new Date().toISOString(),
    };

    if (isChargeback) {
      updates.was_chargeback = true;
      updates.chargeback_at = new Date().toISOString();
    }

    await supabaseAdmin
      .from('creator_earnings')
      .update(updates)
      .eq('id', earningId);

    // Trigger a fraud scan for this creator
    await scanCreatorForAnomalies(earning.creator_id, 'triggered');

    logger.info('Earning refund recorded', {
      earningId,
      creatorId: earning.creator_id,
      isChargeback,
    });
  } catch (error) {
    logger.error('Error recording earning refund', { earningId, error: error.message });
  }
}

/**
 * Get all creators requiring fraud review (for admin dashboard)
 */
async function getCreatorsRequiringReview() {
  try {
    const { data: creators, error } = await supabaseAdmin
      .from('creators')
      .select(`
        id,
        email,
        name,
        username,
        fraud_risk_score,
        active_fraud_flags,
        commission_frozen,
        commission_frozen_at,
        commission_frozen_reason,
        requires_fraud_review,
        status
      `)
      .eq('requires_fraud_review', true)
      .order('fraud_risk_score', { ascending: false });

    if (error) {
      logger.error('Error fetching creators for review', { error });
      return [];
    }

    return creators.map(c => ({
      id: c.id,
      email: c.email,
      name: c.name,
      username: c.username,
      riskScore: parseFloat(c.fraud_risk_score),
      activeFlagCount: c.active_fraud_flags,
      commissionFrozen: c.commission_frozen,
      commissionFrozenAt: c.commission_frozen_at,
      commissionFrozenReason: c.commission_frozen_reason,
      status: c.status,
    }));
  } catch (error) {
    logger.error('Error in getCreatorsRequiringReview', { error: error.message });
    return [];
  }
}

module.exports = {
  // Core scanning
  scanCreatorForAnomalies,
  scanAllCreatorsForAnomalies,

  // Status and flags
  getCreatorFraudStatus,
  resolveFraudFlag,

  // Admin actions
  freezeCreatorCommissions,
  unfreezeCreatorCommissions,
  getCreatorsRequiringReview,

  // Event handlers
  recordEarningRefund,

  // Individual checks (for testing/debugging)
  checkRefundRate,
  checkDeviceIpClustering,
  checkVelocitySpike,
  checkBinClustering,
  checkGeoAnomaly,

  // Config
  getConfig,
  FLAG_TYPES,
};
