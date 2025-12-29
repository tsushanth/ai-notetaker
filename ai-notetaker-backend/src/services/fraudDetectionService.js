/**
 * Fraud Detection Service
 * Prevents self-referral and household fraud in the creator program
 *
 * Checks performed:
 * 1. Same user ID (creator and subscriber are the same)
 * 2. Same/similar email
 * 3. Same device fingerprint
 * 4. Same IP address
 * 5. Same IP subnet (household detection)
 * 6. Same payment method (last4 + brand)
 */

const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// Hash function for sensitive data
function hashData(data) {
  if (!data) return null;
  return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
}

// Extract /24 subnet from IP address (first 3 octets)
function getIPSubnet(ip) {
  if (!ip) return null;

  // Handle IPv4
  const ipv4Match = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (ipv4Match) {
    return ipv4Match[1]; // Returns first 3 octets
  }

  // Handle IPv6-mapped IPv4 (::ffff:192.168.1.1)
  const mappedMatch = ip.match(/::ffff:(\d+\.\d+\.\d+)\.\d+$/i);
  if (mappedMatch) {
    return mappedMatch[1];
  }

  // For pure IPv6, use first 4 groups
  const ipv6Parts = ip.split(':');
  if (ipv6Parts.length >= 4) {
    return ipv6Parts.slice(0, 4).join(':');
  }

  return ip; // Return as-is if can't parse
}

// Create payment fingerprint from last4 and brand
function createPaymentFingerprint(last4, brand) {
  if (!last4 || !brand) return null;
  return hashData(`${brand.toLowerCase()}-${last4}`);
}

/**
 * Fraud signal types and their severity
 */
const FRAUD_SIGNALS = {
  SAME_USER: { type: 'same_user', severity: 1.0, blocks: true },
  SAME_EMAIL: { type: 'same_email', severity: 1.0, blocks: true },
  SAME_DEVICE: { type: 'same_device', severity: 1.0, blocks: true },
  SAME_IP: { type: 'same_ip', severity: 0.9, blocks: true },
  SIMILAR_IP_SUBNET: { type: 'similar_ip_subnet', severity: 0.7, blocks: true },
  SAME_PAYMENT: { type: 'same_payment_method', severity: 1.0, blocks: true },
  VELOCITY_ABUSE: { type: 'velocity_abuse', severity: 0.8, blocks: true },
};

/**
 * Check for fraud signals between creator and subscriber
 *
 * @param {Object} params - Check parameters
 * @param {string} params.creatorId - Creator's ID
 * @param {string} params.subscriberUserId - Subscriber's user ID
 * @param {string} params.subscriberEmail - Subscriber's email
 * @param {string} params.deviceFingerprint - Device fingerprint hash
 * @param {string} params.ipAddress - Subscriber's IP address
 * @param {Object} params.paymentMethod - { last4, brand }
 * @param {string} params.redemptionId - Promo redemption ID
 *
 * @returns {Object} { blocked: boolean, signals: array, reason: string }
 */
async function checkForFraud({
  creatorId,
  subscriberUserId,
  subscriberEmail,
  deviceFingerprint,
  ipAddress,
  paymentMethod,
  redemptionId,
}) {
  const signals = [];
  let blocked = false;
  let reason = null;

  try {
    // Get creator data
    const { data: creator, error: creatorError } = await supabaseAdmin
      .from('creators')
      .select('*')
      .eq('id', creatorId)
      .single();

    if (creatorError || !creator) {
      logger.error('Failed to fetch creator for fraud check', { creatorId, error: creatorError });
      return { blocked: false, signals: [], reason: null };
    }

    // =========================================
    // CHECK 1: Same User ID
    // =========================================
    if (creator.user_id && creator.user_id === subscriberUserId) {
      signals.push({
        ...FRAUD_SIGNALS.SAME_USER,
        data: { creatorUserId: creator.user_id, subscriberUserId },
      });
      blocked = true;
      reason = 'Creator cannot earn commission on their own subscription';
    }

    // =========================================
    // CHECK 2: Same/Similar Email
    // =========================================
    if (subscriberEmail) {
      const subscriberEmailHash = hashData(subscriberEmail);
      const creatorEmailHash = hashData(creator.email);

      if (subscriberEmailHash === creatorEmailHash) {
        signals.push({
          ...FRAUD_SIGNALS.SAME_EMAIL,
          data: { match: 'exact' },
        });
        blocked = true;
        reason = reason || 'Email matches creator account';
      }

      // Check for similar email patterns (same base, different +suffix)
      const subscriberBase = subscriberEmail.split('@')[0].split('+')[0].toLowerCase();
      const creatorBase = creator.email.split('@')[0].split('+')[0].toLowerCase();
      const subscriberDomain = subscriberEmail.split('@')[1]?.toLowerCase();
      const creatorDomain = creator.email.split('@')[1]?.toLowerCase();

      if (subscriberBase === creatorBase && subscriberDomain === creatorDomain) {
        signals.push({
          ...FRAUD_SIGNALS.SAME_EMAIL,
          confidence_score: 0.95,
          data: { match: 'base_pattern', pattern: subscriberBase },
        });
        blocked = true;
        reason = reason || 'Email pattern matches creator account';
      }
    }

    // =========================================
    // CHECK 3: Same Device Fingerprint
    // =========================================
    if (deviceFingerprint && creator.device_fingerprints?.length > 0) {
      const fingerprintHash = hashData(deviceFingerprint);

      if (creator.device_fingerprints.includes(fingerprintHash)) {
        signals.push({
          ...FRAUD_SIGNALS.SAME_DEVICE,
          data: { fingerprintHash: fingerprintHash.substring(0, 16) + '...' },
        });
        blocked = true;
        reason = reason || 'Device matches creator account';
      }
    }

    // =========================================
    // CHECK 4: Same IP Address
    // =========================================
    if (ipAddress && creator.ip_addresses?.length > 0) {
      const ipHash = hashData(ipAddress);

      if (creator.ip_addresses.includes(ipHash)) {
        signals.push({
          ...FRAUD_SIGNALS.SAME_IP,
          data: { ipHash: ipHash.substring(0, 16) + '...' },
        });
        blocked = true;
        reason = reason || 'IP address matches creator account';
      }
    }

    // =========================================
    // CHECK 5: Same IP Subnet (Household)
    // =========================================
    if (ipAddress && creator.ip_addresses?.length > 0) {
      const subscriberSubnet = getIPSubnet(ipAddress);
      const subscriberSubnetHash = hashData(subscriberSubnet);

      // Get creator's subnets from stored IPs
      // Note: We need to compare subnets, but we only store full IP hashes
      // For this to work properly, we'd need to store subnet hashes separately
      // For now, we'll flag this for manual review if the full IP doesn't match
      // but we detect the same subnet from recent redemptions

      // Check recent redemptions from same subnet
      const { data: recentRedemptions } = await supabaseAdmin
        .from('promo_redemptions')
        .select('ip_subnet, user_id')
        .eq('creator_id', creatorId)
        .eq('attribution_status', 'attributed')
        .not('ip_subnet', 'is', null)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(100);

      if (recentRedemptions?.length > 0) {
        const subnetMatches = recentRedemptions.filter(r =>
          r.ip_subnet === subscriberSubnetHash && r.user_id !== subscriberUserId
        );

        // If 3+ different users from same subnet, could be household abuse
        if (subnetMatches.length >= 2) {
          signals.push({
            ...FRAUD_SIGNALS.SIMILAR_IP_SUBNET,
            data: {
              subnetMatchCount: subnetMatches.length + 1,
              note: 'Multiple conversions from same network',
            },
          });
          // Don't auto-block for subnet, but flag it
          // blocked = true; // Uncomment to auto-block
        }
      }
    }

    // =========================================
    // CHECK 6: Same Payment Method
    // =========================================
    if (paymentMethod?.last4 && paymentMethod?.brand) {
      const paymentFingerprint = createPaymentFingerprint(paymentMethod.last4, paymentMethod.brand);

      if (creator.payment_fingerprints?.includes(paymentFingerprint)) {
        signals.push({
          ...FRAUD_SIGNALS.SAME_PAYMENT,
          data: {
            brand: paymentMethod.brand,
            last4: paymentMethod.last4,
          },
        });
        blocked = true;
        reason = reason || 'Payment method matches creator account';
      }
    }

    // =========================================
    // LOG FRAUD SIGNALS
    // =========================================
    if (signals.length > 0) {
      logger.warn('Fraud signals detected', {
        creatorId,
        subscriberUserId,
        redemptionId,
        signalCount: signals.length,
        blocked,
        signals: signals.map(s => s.type),
      });

      // Store signals in database
      for (const signal of signals) {
        await supabaseAdmin.from('creator_fraud_signals').insert({
          creator_id: creatorId,
          user_id: subscriberUserId,
          redemption_id: redemptionId,
          signal_type: signal.type,
          confidence_score: signal.confidence_score || signal.severity,
          signal_data: signal.data || {},
          is_blocked: blocked && signal.blocks,
        });
      }

      // Update redemption with fraud check result
      if (redemptionId) {
        await supabaseAdmin
          .from('promo_redemptions')
          .update({
            fraud_check_result: blocked ? 'blocked' : 'flagged',
            fraud_signals: signals.map(s => ({
              type: s.type,
              severity: s.severity,
              confidence: s.confidence_score || s.severity,
            })),
          })
          .eq('id', redemptionId);
      }
    } else {
      // Mark as passed if no signals
      if (redemptionId) {
        await supabaseAdmin
          .from('promo_redemptions')
          .update({ fraud_check_result: 'passed' })
          .eq('id', redemptionId);
      }
    }

    return {
      blocked,
      signals: signals.map(s => ({
        type: s.type,
        severity: s.severity,
        confidence: s.confidence_score || s.severity,
      })),
      reason,
    };
  } catch (error) {
    logger.error('Error in fraud detection', { error: error.message, creatorId, subscriberUserId });
    // On error, don't block - but log for investigation
    return { blocked: false, signals: [], reason: null, error: error.message };
  }
}

/**
 * Register creator's device/IP/payment fingerprints
 * Called when creator signs up or uses the app
 */
async function registerCreatorFingerprints(creatorId, {
  deviceFingerprint,
  ipAddress,
  paymentMethod,
}) {
  try {
    const updates = {};

    // Hash and store device fingerprint
    if (deviceFingerprint) {
      const fingerprintHash = hashData(deviceFingerprint);
      const { data: current } = await supabaseAdmin
        .from('creators')
        .select('device_fingerprints')
        .eq('id', creatorId)
        .single();

      const fingerprints = current?.device_fingerprints || [];
      if (!fingerprints.includes(fingerprintHash)) {
        updates.device_fingerprints = [...fingerprints, fingerprintHash].slice(-10); // Keep last 10
      }
    }

    // Hash and store IP address
    if (ipAddress) {
      const ipHash = hashData(ipAddress);
      const { data: current } = await supabaseAdmin
        .from('creators')
        .select('ip_addresses')
        .eq('id', creatorId)
        .single();

      const ips = current?.ip_addresses || [];
      if (!ips.includes(ipHash)) {
        updates.ip_addresses = [...ips, ipHash].slice(-20); // Keep last 20 (IPs change more often)
      }
    }

    // Hash and store payment fingerprint
    if (paymentMethod?.last4 && paymentMethod?.brand) {
      const paymentFingerprint = createPaymentFingerprint(paymentMethod.last4, paymentMethod.brand);
      const { data: current } = await supabaseAdmin
        .from('creators')
        .select('payment_fingerprints')
        .eq('id', creatorId)
        .single();

      const payments = current?.payment_fingerprints || [];
      if (!payments.includes(paymentFingerprint)) {
        updates.payment_fingerprints = [...payments, paymentFingerprint].slice(-5); // Keep last 5
      }
    }

    // Update if there are changes
    if (Object.keys(updates).length > 0) {
      await supabaseAdmin
        .from('creators')
        .update(updates)
        .eq('id', creatorId);

      logger.info('Creator fingerprints updated', {
        creatorId,
        updatedFields: Object.keys(updates),
      });
    }

    return true;
  } catch (error) {
    logger.error('Error registering creator fingerprints', { error: error.message, creatorId });
    return false;
  }
}

/**
 * Store subscriber's fingerprints when they apply a promo code
 */
async function storeRedemptionFingerprints(redemptionId, {
  deviceFingerprint,
  ipAddress,
}) {
  try {
    const updates = {};

    if (deviceFingerprint) {
      updates.device_fingerprint = hashData(deviceFingerprint);
    }

    if (ipAddress) {
      updates.ip_address = hashData(ipAddress);
      updates.ip_subnet = hashData(getIPSubnet(ipAddress));
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin
        .from('promo_redemptions')
        .update(updates)
        .eq('id', redemptionId);
    }

    return true;
  } catch (error) {
    logger.error('Error storing redemption fingerprints', { error: error.message, redemptionId });
    return false;
  }
}

module.exports = {
  checkForFraud,
  registerCreatorFingerprints,
  storeRedemptionFingerprints,
  hashData,
  getIPSubnet,
  createPaymentFingerprint,
  FRAUD_SIGNALS,
};
