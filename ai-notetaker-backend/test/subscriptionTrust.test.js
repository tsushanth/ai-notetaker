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
test.beforeEach(() => { h.resetDb(); asked.length = 0; verdict = { result: 'unavailable', reason: 'not_configured' }; delete process.env.SUBSCRIPTION_VERIFY_MODE; delete process.env.SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS; });

const U = '11111111-1111-1111-1111-111111111111';
const body = (over = {}) => ({ productId: 'scribe_ai_yearly', platform: 'android', status: 'active', ...over });
const sync = (b) => h.call(server, 'POST', '/api/subscriptions/sync', { user: U, body: b });
const row = (over = {}) => ({ id: 's1', user_id: U, product_id: 'scribe_ai_yearly', platform: 'android', status: 'active', current_period_end: null, ...over });

test('by default a claim with no proof grants nothing: it is held as pending', async () => {
  const r = await sync(body({ transactionId: 'GPA.0000' }));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PURCHASE_NOT_VERIFIED');
  assert.equal(r.body.pending, true);
  assert.deepEqual(h.db.subscriptions.map((x) => [x.status, x.original_transaction_id]), [['pending', 'GPA.0000']]);
  assert.equal((h.db.subscription_events || []).length, 0);
});

test('a pending claim never becomes access by being repeated, in any status or on either platform', async () => {
  for (const b of [body(), body(), body({ status: 'grace_period' }), body({ platform: 'ios' })]) assert.equal((await sync(b)).status, 403);
  assert.deepEqual(h.db.subscriptions.map((x) => x.status), ['pending']);
});

test('emergency switch: log mode accepts as before and claims no verification', async () => {
  process.env.SUBSCRIPTION_VERIFY_MODE = 'log';
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
  assert.equal(r.body.pending, false);
  assert.equal((h.db.subscriptions || []).length, 0);
});

test('a verified purchase is stored with proof and without an end date while it renews', async () => {
  verdict = { result: 'entitled', state: 'SUBSCRIPTION_STATE_ACTIVE', expiresAt: '2027-01-01T00:00:00.000Z', canceled: false };
  h.db.subscriptions = [row({ status: 'pending' })];
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

test('an unverified request cannot grant access, with or without a token', async () => {
  verdict = { result: 'unavailable', reason: 'google_503' };
  assert.equal((await sync(body())).status, 403);
  assert.equal((await sync(body({ purchaseToken: 't' }))).status, 403);
  assert.deepEqual(h.db.subscriptions.map((x) => x.status), ['pending']);
});

test('an existing subscriber on an old app, or during a Google outage, is not locked out', async () => {
  h.db.subscriptions = [row()];
  assert.equal((await sync(body())).status, 200);
  verdict = { result: 'unavailable', reason: 'google_503' };
  assert.equal((await sync(body({ purchaseToken: 't' }))).status, 200);
  assert.equal(h.db.subscriptions[0].status, 'active');
  assert.equal((await sync(body({ status: 'cancelled' }))).status, 200);
  assert.equal(h.db.subscriptions[0].status, 'cancelled');
});

test('repeating existing access cannot extend or change it', async () => {
  const end = '2027-05-30T00:00:00.000Z';
  h.db.subscriptions = [row({ platform: 'ios', current_period_end: end, original_transaction_id: 'orig-1', price_amount: '29.99' })];
  const r = await sync(body({ platform: 'ios', expirationDate: '2099-01-01', originalTransactionId: 'other', priceAmount: '0' }));
  assert.equal(r.status, 200);
  const s = h.db.subscriptions[0];
  assert.deepEqual([s.current_period_end, s.original_transaction_id, s.price_amount], [end, 'orig-1', '29.99']);
});

test('"cancelled" with a date of the client\'s choosing gives no paid time', async () => {
  const claim = body({ status: 'cancelled', expirationDate: '2099-01-01', platform: 'ios' });
  assert.equal((await sync(claim)).status, 200);
  assert.equal(h.db.subscriptions[0].current_period_end, null);
  h.db.subscriptions = [row({ status: 'expired', current_period_end: '2020-01-01T00:00:00.000Z' })];
  await sync(body({ status: 'cancelled', expirationDate: '2099-01-01' }));
  assert.equal(h.db.subscriptions[0].current_period_end, '2020-01-01T00:00:00.000Z');
});

test('another product does not replace or remove the access held', async () => {
  h.db.subscriptions = [row()];
  const r = await sync(body({ productId: 'scribe_ai_monthly' }));
  assert.equal(r.status, 403);
  assert.equal(r.body.pending, false);
  assert.deepEqual([h.db.subscriptions[0].status, h.db.subscriptions[0].product_id], ['active', 'scribe_ai_yearly']);
});

test('platforms can be narrowed; unknown platforms and statuses are refused', async () => {
  process.env.SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS = 'android';
  assert.equal((await sync(body({ platform: 'ios' }))).status, 200);
  delete process.env.SUBSCRIPTION_VERIFY_ENFORCE_PLATFORMS;
  assert.equal((await sync(body({ platform: 'web' }))).status, 400);
  assert.equal((await sync(body({ status: 'lifetime' }))).status, 400);
});

test('the iOS reconcile and client event routes cannot grant access either', async () => {
  const claim = { productId: 'p', originalTransactionId: 'o', isSubscribed: true, expirationDate: '2099-01-01' };
  assert.equal((await h.call(server, 'POST', '/api/subscriptions/reconcile', { user: U, body: claim })).status, 403);
  assert.deepEqual(h.db.subscriptions.map((x) => x.status), ['pending']);
  h.db.subscriptions = [row({ status: 'expired' })];
  await h.call(server, 'POST', '/api/subscriptions/event', { user: U, body: { eventType: 'subscription_reactivated', platform: 'android' } });
  assert.equal(h.db.subscriptions[0].status, 'expired');
});

test('a repeat sync does not log another "subscription_started"', async () => {
  verdict = { result: 'entitled', state: 'SUBSCRIPTION_STATE_ACTIVE', expiresAt: null, canceled: false };
  await sync(body({ purchaseToken: 't' }));
  await sync(body({ purchaseToken: 't' }));
  assert.equal(h.db.subscription_events.filter((e) => e.event_type === 'subscription_started').length, 1);
});

test('decide: only unexpired access to the same product on the same platform counts as already held', () => {
  const config = { mode: 'enforce', enforced: ['android'] };
  const claim = { platform: 'android', status: 'active', productId: 'scribe_ai_yearly', verification: null, config };
  const act = (existing) => decide({ ...claim, existing }).action;
  assert.equal(act(row({ current_period_end: '2000-01-01' })), 'refuse');
  assert.equal(act(row({ product_id: 'scribe_ai_monthly' })), 'refuse');
  assert.equal(act(row({ status: 'expired' })), 'refuse');
  assert.equal(act(row({ status: 'pending' })), 'refuse');
  assert.equal(act(row({ status: 'cancelled' })), 'refuse');
  assert.equal(act(row({ status: 'cancelled', current_period_end: '2099-01-01' })), 'accept');
  assert.equal(act(row()), 'accept');
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
