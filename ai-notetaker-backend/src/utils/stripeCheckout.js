/**
 * Stripe customer + Checkout Session reuse for the web subscription flow.
 *
 * Before: POST /stripe/checkout created a NEW Stripe customer whenever `subscriptions.stripe_customer_id`
 * was empty, and that column is only filled by the webhook after a purchase completes. So a user who opened
 * checkout and did not finish (or whose session creation failed after the customer was created) got another
 * customer on every attempt: live Stripe held 12 customers for one user in 40 minutes, 15 for two users,
 * 9 of them with no session at all. Now the customer is looked up (stored id, then Stripe by email + userId
 * metadata, then metadata search) before one is created, and a still-open session for the same plan is returned
 * instead of a new one. Price, trial and discounts are untouched.
 */
const crypto = require('crypto');

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;
const MIN_REMAINING_SECONDS = 30 * 60;

function bucket(now) {
  return Math.floor(now / IDEMPOTENCY_WINDOW_MS);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

/** Returns the Stripe customer id to use for this user, creating one only if none exists. */
async function getOrCreateCustomer({ stripe, userId, email, name, storedCustomerId, now = Date.now(), log = () => {} }) {
  if (storedCustomerId) {
    try {
      const c = await stripe.customers.retrieve(storedCustomerId);
      if (c && !c.deleted) return { customerId: c.id, source: 'stored' };
    } catch (err) {
      log('Stored Stripe customer not usable, looking elsewhere', { userId, code: err && err.code });
    }
  }

  const matchesUser = (c) => c && !c.deleted && c.metadata && c.metadata.userId === userId;
  const newest = (list) => list.filter(matchesUser).sort((a, b) => b.created - a.created)[0];

  try {
    const byEmail = await stripe.customers.list({ email, limit: 20 });
    const hit = newest(byEmail.data || []);
    if (hit) return { customerId: hit.id, source: 'email' };
  } catch (err) {
    log('Stripe customer lookup by email failed', { userId, code: err && err.code });
  }

  try {
    // Covers a changed email. Search is eventually consistent (about a minute), so it is the second lookup, not the first.
    const bySearch = await stripe.customers.search({ query: `metadata['userId']:'${String(userId).replace(/[^A-Za-z0-9-]/g, '')}'`, limit: 10 });
    const hit = newest(bySearch.data || []);
    if (hit) return { customerId: hit.id, source: 'search' };
  } catch (err) {
    log('Stripe customer search failed', { userId, code: err && err.code });
  }

  const customer = await stripe.customers.create(
    { email, name: name || undefined, metadata: { userId } },
    { idempotencyKey: `scribe-customer:${userId}:${bucket(now)}` }
  );
  return { customerId: customer.id, source: 'created' };
}

/** A still-open session for this user, price and discount state with enough time left, or null. */
async function findOpenSession({ stripe, customerId, userId, priceId, discount, now = Date.now() }) {
  try {
    const list = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
    const nowSec = Math.floor(now / 1000);
    return (
      (list.data || []).find(
        (s) =>
          s.url &&
          s.status === 'open' &&
          s.metadata && s.metadata.userId === userId && s.metadata.priceId === priceId &&
          s.metadata.discount === (discount ? '1' : '0') &&
          (s.expires_at || 0) - nowSec >= MIN_REMAINING_SECONDS
      ) || null
    );
  } catch (_) {
    return null; // never block checkout on a lookup failure
  }
}

/** Create the session (identical repeat calls inside 5 minutes return the same one). */
async function createSession({ stripe, sessionConfig, userId, now = Date.now() }) {
  return stripe.checkout.sessions.create(sessionConfig, {
    idempotencyKey: `scribe-checkout:${userId}:${bucket(now)}:${fingerprint(sessionConfig)}`,
  });
}

module.exports = { getOrCreateCustomer, findOpenSession, createSession, MIN_REMAINING_SECONDS };
