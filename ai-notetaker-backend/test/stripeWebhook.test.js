const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Stripe = require('stripe');
const { verifyStripeWebhook } = require('../src/utils/stripeWebhook');

const stripe = new Stripe('sk_test_not_a_real_key');
const SECRET = 'whsec_test_secret_for_unit_tests_only';
const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { userId: 'u1' } } } });
const signed = (body = payload, secret = SECRET) => stripe.webhooks.generateTestHeaderString({ payload: body, secret });
const call = (over = {}) => verifyStripeWebhook({ stripe, rawBody: Buffer.from(payload), signature: signed(), secret: SECRET, ...over });

test('a correctly signed event is accepted and returned', () => {
  const r = call();
  assert.equal(r.ok, true);
  assert.equal(r.event.type, 'customer.subscription.updated');
});

test('NO signature header is refused (this was the hole: it used to be parsed as trusted)', () => {
  for (const signature of [undefined, null, '']) {
    const r = call({ signature });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.code, 'MISSING_SIGNATURE');
    assert.equal(r.event, undefined);
  }
});

test('a forged event with a made-up signature is refused', () => {
  const r = call({ signature: 't=1700000000,v1=' + 'a'.repeat(64) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_SIGNATURE');
});

test('an event signed with a different secret, or whose body was altered, is refused', () => {
  assert.equal(call({ signature: signed(payload, 'whsec_other') }).ok, false);
  const tampered = payload.replace('u1', 'attacker');
  assert.equal(call({ rawBody: Buffer.from(tampered) }).ok, false);
});

test('with no secret configured NOTHING is accepted, even a perfectly signed event (fail closed, 503)', () => {
  for (const secret of [undefined, null, '']) {
    const r = call({ secret });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(r.code, 'NO_WEBHOOK_SECRET');
  }
});

test('an already-parsed object body (express.json ran first) is refused, not trusted', () => {
  assert.equal(call({ rawBody: JSON.parse(payload) }).ok, false);
});

test('guardrail: neither webhook route may fall back to parsing an unsigned body', () => {
  for (const f of ['../src/app.js', '../src/routes/subscriptions.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.equal(/webhookSecret\s*&&\s*sig/.test(src), false, f + ': no "secret && sig else trust" pattern');
    assert.equal(src.includes('signature verification skipped - no webhook secret configured'), false, f);
    assert.ok(src.includes('verifyStripeWebhook('), f + ' uses the shared check');
  }
});
