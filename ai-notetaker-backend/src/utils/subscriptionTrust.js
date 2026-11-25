/**
 * A client's word about its own subscription grants nothing. Access comes from the store:
 *   Android  the purchase token is checked with Google Play (utils/playVerify.js)
 *   iOS      Apple's signed server notifications (utils/appleJws.js) activate and renew
 *   Web      the signed Stripe webhook
 *
 * An unverifiable request to GRANT access is held as 'pending' (which grants nothing) and reported, so a real buyer is
 * visible and can be activated by the store's own message. Nobody loses access they already have: a request that only
 * repeats it is accepted, and it cannot extend or change it. A client may always end its own access.
 *
 * SUBSCRIPTION_VERIFY_MODE=log restores the old behaviour (accept and count), for an emergency only.
 * SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS (default "android,ios") narrows enforcement.
 */
const crypto = require('crypto');

const PLATFORMS = ['android', 'ios']; // web subscriptions are written by the Stripe webhook, never by a client

function trustConfig(env = process.env) {
  const mode = String(env.SUBSCRIPTION_VERIFY_MODE || '').trim().toLowerCase() === 'log' ? 'log' : 'enforce';
  const enforced = String(env.SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS || PLATFORMS.join(',')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { mode, enforced };
}

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * The account already has access to this product: active with time left (or no end date), or cancelled / in grace with
 * paid time left. Repeating it grants nothing new.
 */
function alreadyHas(existing, { productId, platform }, now = Date.now()) {
  if (!existing || existing.platform !== platform || existing.product_id !== productId) return false;
  const end = existing.current_period_end ? Date.parse(existing.current_period_end) : null;
  if (existing.status === 'active') return end === null || end > now;
  return ['cancelled', 'grace_period'].includes(existing.status) && end !== null && end > now;
}

/**
 * Pure decision for a request that wants `status` on a platform, given what verification said (null when it was not
 * possible). Returns { action: 'accept' | 'refuse', verified, patch, reason }; `patch` overrides client-sent columns.
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
  if (config.mode !== 'enforce' || !config.enforced.includes(platform)) {
    return { action: 'accept', verified: false, patch: {}, reason };
  }
  if (!grants) {
    // Ending access is accepted, but not with dates of the client's choosing: a "cancelled" row with a future end date
    // still gives paid access until then.
    return { action: 'accept', verified: false, reason, patch: held(existing) };
  }
  if (!alreadyHas(existing, { productId, platform }, now)) return { action: 'refuse', verified: false, reason };
  // A repeat of existing access: what the server holds stays as it is.
  return { action: 'accept', verified: false, reason, patch: { ...held(existing), status: existing.status } };
}

/** The columns that carry entitlement, as the server already holds them (empty when there is no row). */
function held(existing) {
  return {
    ...(existing?.product_id && { product_id: existing.product_id }),
    ...(existing?.platform && { platform: existing.platform }),
    current_period_start: existing?.current_period_start ?? null,
    current_period_end: existing?.current_period_end ?? null,
    is_trial: existing?.is_trial ?? false,
    trial_end: existing?.trial_end ?? null,
    original_transaction_id: existing?.original_transaction_id ?? null,
    price_amount: existing?.price_amount ?? null,
  };
}

module.exports = { decide, trustConfig, tokenHash, alreadyHas, PLATFORMS };
