/**
 * How far a client's word about its own subscription is trusted.
 *
 * SUBSCRIPTION_VERIFY_MODE
 *   log      (default) Android purchases carrying a token are checked with Google Play when credentials are configured.
 *            A token Google says is false is refused and an expired one is recorded as expired. Everything that cannot
 *            be checked (older apps send no token, no credentials, Google unreachable, iOS) is accepted as before,
 *            marked unverified and counted in the failure reporter.
 *   enforce  As above, and an unverified request may no longer GRANT access: it can only refresh or end access the
 *            account already has. Applies to the platforms in SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS (default
 *            "android"; iOS cannot be verified by this code, so listing it would refuse real iOS purchases).
 */
const crypto = require('crypto');

const PLATFORMS = ['android', 'ios']; // web subscriptions are written by the Stripe webhook, never by a client

function trustConfig(env = process.env) {
  const mode = String(env.SUBSCRIPTION_VERIFY_MODE || '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'log';
  const enforced = String(env.SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS || 'android').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { mode, enforced };
}

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** The account already has access to this product: refreshing it grants nothing new. */
function alreadyHas(existing, { productId, platform }, now = Date.now()) {
  return !!existing && existing.status === 'active' && existing.platform === platform && existing.product_id === productId
    && (!existing.current_period_end || Date.parse(existing.current_period_end) > now);
}

/**
 * Pure decision for a request that wants `status` on a platform, given what verification said (null when it was not
 * attempted). Returns { action: 'accept' | 'refuse', verified, patch, reason }; `patch` overrides client-sent columns.
 */
function decide({ platform, status, productId, existing, verification, config, now = Date.now() }) {
  const grants = status === 'active' || status === 'grace_period';
  const v = verification;
  if (v?.result === 'invalid') return { action: 'refuse', verified: false, reason: v.reason };
  if (v?.result === 'entitled') {
    // A cancelled subscription stays usable until its end date. A renewing one gets no end date: nothing on the server
    // would move it forward at renewal, and a paying user must not lapse because the app was not reopened.
    const patch = v.canceled
      ? { status: 'active', current_period_end: v.expiresAt, auto_renew_enabled: false }
      : { status: 'active', current_period_end: null };
    return { action: 'accept', verified: true, patch, reason: 'verified' };
  }
  if (v?.result === 'not_entitled') {
    return { action: 'accept', verified: true, patch: { status: 'expired', current_period_end: v.expiresAt }, reason: 'not_entitled' };
  }
  const reason = v ? v.reason : 'no_token';
  if (config.mode === 'enforce' && config.enforced.includes(platform) && grants && !alreadyHas(existing, { productId, platform }, now)) {
    return { action: 'refuse', verified: false, reason };
  }
  return { action: 'accept', verified: false, patch: {}, reason };
}

module.exports = { decide, trustConfig, tokenHash, alreadyHas, PLATFORMS };
