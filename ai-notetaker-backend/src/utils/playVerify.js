/**
 * Ask Google Play what a purchase token is really worth (purchases.subscriptionsv2.get).
 *
 * Credentials: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (the JSON key of a service account that Play Console lets view this
 * app's orders and subscriptions). Without it every answer is { result: 'unavailable', reason: 'not_configured' }.
 */
const { GoogleAuth } = require('google-auth-library');

const PACKAGE_NAME = 'com.kreativekoala.scribeai';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TIMEOUT_MS = 10_000;
const ENTITLED = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);

const isConfigured = (env = process.env) => !!env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

let cached = null;
async function accessToken(env) {
  if (!cached) cached = new GoogleAuth({ credentials: JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON), scopes: [SCOPE] });
  return cached.getAccessToken();
}

/** Pure reading of a SubscriptionPurchaseV2 resource. */
function readPurchase(json, productId, now = Date.now()) {
  const items = Array.isArray(json?.lineItems) ? json.lineItems : [];
  const item = items.find((i) => i.productId === productId);
  if (!item) return { result: 'invalid', reason: 'product_mismatch' };
  const state = String(json.subscriptionState || '');
  const expiresAt = Number.isFinite(Date.parse(item.expiryTime)) ? new Date(item.expiryTime).toISOString() : null;
  const entitled = ENTITLED.has(state) && (!expiresAt || Date.parse(expiresAt) > now);
  return { result: entitled ? 'entitled' : 'not_entitled', state, expiresAt, canceled: state === 'SUBSCRIPTION_STATE_CANCELED' };
}

/**
 * { result: 'entitled' | 'not_entitled' | 'invalid' | 'unavailable', ... }
 * 'invalid' only when Google says the token is not a purchase of this product. Anything that could be our own
 * misconfiguration or Google's outage is 'unavailable', so it never counts against the user.
 */
async function verifySubscription({ purchaseToken, productId }, { env = process.env, fetchImpl = fetch, getToken = accessToken, now = Date.now() } = {}) {
  if (!isConfigured(env)) return { result: 'unavailable', reason: 'not_configured' };
  try {
    const token = await getToken(env);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 400 || res.status === 404) return { result: 'invalid', reason: `google_${res.status}` };
    // 410: the purchase expired too long ago to be returned.
    if (res.status === 410) return { result: 'not_entitled', state: 'EXPIRED_LONG_AGO', expiresAt: null };
    if (!res.ok) return { result: 'unavailable', reason: `google_${res.status}` };
    return readPurchase(await res.json(), productId, now);
  } catch (e) {
    return { result: 'unavailable', reason: e.name || 'error' };
  }
}

module.exports = { verifySubscription, readPurchase, isConfigured, PACKAGE_NAME };
