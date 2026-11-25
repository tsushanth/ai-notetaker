// A client's claim to be subscribed: checked with Google Play when possible, and refused when enforcement is on.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();

let verdict = { result: 'unavailable', reason: 'not_configured' };
const asked = [];
const full = require.resolve(path.join(__dirname, '..', 'src', 'utils', 'playVerify.js'));
const real = require(full);
require.cache[full].exports = { ...real, verifySubscription: async (q) => { asked.push(q); return verdict; } };

const { decide } = require('../src/utils/subscriptionTrust');
const app = h.makeApp({ '/api/subscriptions': require('../src/routes/subscriptions') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());
test.beforeEach(() => { h.resetDb(); asked.length = 0; delete process.env.SUBSCRIPTION_VERIFY_MODE; });

const U = '11111111-1111-1111-1111-111111111111';
const body = (over = {}) => ({ productId: 'scribe_ai_yearly', platform: 'android', status: 'active', ...over });
const sync = (b) => h.call(server, 'POST', '/api/subscriptions/sync', { user: U, body: b });
const row = (over = {}) => ({ id: 's1', user_id: U, product_id: 'scribe_ai_yearly', platform: 'android', status: 'active', current_period_end: null, ...over });
const enforce = () => { process.env.SUBSCRIPTION_VERIFY_MODE = 'enforce'; };

test('log mode (default): an old app without a token is accepted as before, and no verification is claimed', async () => {
  assert.equal((await sync(body())).status, 200);
  assert.equal(h.db.subscriptions[0].status, 'active');
  assert.equal(h.db.subscriptions[0].metadata, undefined);
  assert.equal(asked.length, 0);
});

test('a token Google calls false is refused in both modes', async () => {
  verdict = { result: 'invalid', reason: 'google_400' };
  const r = await sync(body({ purchaseToken: 'forged' }));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PURCHASE_NOT_VERIFIED');
  assert.equal((h.db.subscriptions || []).length, 0);
});

test('a verified purchase is stored with proof and without an end date while it renews', async () => {
  verdict = { result: 'entitled', state: 'SUBSCRIPTION_STATE_ACTIVE', expiresAt: '2027-01-01T00:00:00.000Z', canceled: false };
  enforce();
  assert.equal((await sync(body({ purchaseToken: 'real-token' }))).status, 200);
  const s = h.db.subscriptions[0];
  assert.equal(s.current_period_end, null);
  assert.equal(s.metadata.verified, true);
  assert.ok(!JSON.stringify(h.db).includes('real-token'), 'the raw token is not stored');
});

test('an expired purchase is recorded as expired, whatever the client says', async () => {
  verdict = { result: 'not_entitled', state: 'SUBSCRIPTION_STATE_EXPIRED', expiresAt: '2026-01-01T00:00:00.000Z' };
  await sync(body({ purchaseToken: 'old' }));
  assert.equal(h.db.subscriptions[0].status, 'expired');
});

test('enforce: an unverified request cannot grant access', async () => {
  enforce();
  verdict = { result: 'unavailable', reason: 'google_503' };
  assert.equal((await sync(body())).status, 403);
  assert.equal((await sync(body({ purchaseToken: 't' }))).status, 403);
  assert.equal((h.db.subscriptions || []).length, 0);
});

test('enforce: an existing subscriber on an old app, or during a Google outage, is not locked out', async () => {
  enforce();
  h.db.subscriptions = [row()];
  assert.equal((await sync(body())).status, 200);
  verdict = { result: 'unavailable', reason: 'google_503' };
  assert.equal((await sync(body({ purchaseToken: 't' }))).status, 200);
  assert.equal((await sync(body({ status: 'cancelled' }))).status, 200);
  assert.equal(h.db.subscriptions[0].status, 'cancelled');
});

test('a verified purchase that moves to another account ends it on the first', async () => {
  verdict = { result: 'entitled', state: 'SUBSCRIPTION_STATE_ACTIVE', expiresAt: null, canceled: false };
  await sync(body({ purchaseToken: 'shared' }));
  const other = h.db.subscriptions[0];
  other.user_id = 'previous-owner';
  other['metadata->>purchase_token_sha256'] = other.metadata.purchase_token_sha256; // the fake database has no JSON paths
  await sync(body({ purchaseToken: 'shared' }));
  assert.equal(other.status, 'expired');
  assert.equal(h.db.subscriptions.find((s) => s.user_id === U).status, 'active');
});

test('enforce: iOS is untouched unless listed; unknown platforms and statuses are refused', async () => {
  enforce();
  assert.equal((await sync(body({ platform: 'ios', productId: 'com.kreativekoala.scribeai.yearly' }))).status, 200);
  assert.equal((await sync(body({ platform: 'web' }))).status, 400);
  assert.equal((await sync(body({ status: 'lifetime' }))).status, 400);
});

test('a repeat sync does not log another "subscription_started"', async () => {
  await sync(body());
  await sync(body());
  assert.equal(h.db.subscription_events.filter((e) => e.event_type === 'subscription_started').length, 1);
});

test('decide: an expired or different-product row does not count as existing access', () => {
  const config = { mode: 'enforce', enforced: ['android'] };
  const claim = { platform: 'android', status: 'active', productId: 'scribe_ai_yearly', verification: null, config };
  assert.equal(decide({ ...claim, existing: row({ current_period_end: '2000-01-01' }) }).action, 'refuse');
  assert.equal(decide({ ...claim, existing: row({ product_id: 'scribe_ai_monthly' }) }).action, 'refuse');
  assert.equal(decide({ ...claim, existing: row({ status: 'expired' }) }).action, 'refuse');
  assert.equal(decide({ ...claim, existing: row() }).action, 'accept');
});

test('reading Google\'s answer', () => {
  const at = (state, expiryTime) => real.readPurchase({ subscriptionState: state, lineItems: [{ productId: 'p', expiryTime }] }, 'p', Date.parse('2026-11-25'));
  assert.equal(at('SUBSCRIPTION_STATE_ACTIVE', '2027-01-01T00:00:00Z').result, 'entitled');
  assert.equal(at('SUBSCRIPTION_STATE_CANCELED', '2027-01-01T00:00:00Z').canceled, true);
  assert.equal(at('SUBSCRIPTION_STATE_CANCELED', '2026-01-01T00:00:00Z').result, 'not_entitled');
  assert.equal(at('SUBSCRIPTION_STATE_ON_HOLD', '2027-01-01T00:00:00Z').result, 'not_entitled');
  assert.equal(at('SUBSCRIPTION_STATE_PENDING', null).result, 'not_entitled');
  assert.equal(real.readPurchase({ lineItems: [{ productId: 'other' }] }, 'p').result, 'invalid');
});

test('verification errors that may be our fault never count against the user', async () => {
  const env = { GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{}' };
  const ask = (status) => real.verifySubscription({ purchaseToken: 't', productId: 'p' }, { env, getToken: async () => 'x', fetchImpl: async () => new Response('{}', { status }) });
  for (const s of [401, 403, 500, 503]) assert.equal((await ask(s)).result, 'unavailable');
  assert.equal((await ask(404)).result, 'invalid');
  assert.equal((await real.verifySubscription({ purchaseToken: 't', productId: 'p' }, { env: {} })).reason, 'not_configured');
});
