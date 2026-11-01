const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyRecallWebhook, presentSignatureHeaderNames } = require('../src/utils/recallWebhook');

// A Svix-format secret: "whsec_" + base64 of the raw key bytes.
const KEY_BYTES = crypto.randomBytes(32);
const SECRET = 'whsec_' + KEY_BYTES.toString('base64');
const NOW_MS = 1_800_000_000_000;
const ts = String(Math.floor(NOW_MS / 1000));
const body = JSON.stringify({ event: 'bot.done', data: { bot_id: 'b1' } });

const sign = (id, timestamp, raw, keyBytes = KEY_BYTES) =>
  'v1,' + crypto.createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${raw}`).digest('base64');
const headersFor = (prefix, over = {}) => ({
  [`${prefix}-id`]: 'msg_1', [`${prefix}-timestamp`]: ts, [`${prefix}-signature`]: sign('msg_1', ts, body), ...over,
});
const verify = (over = {}) => verifyRecallWebhook({ rawBody: Buffer.from(body), headers: headersFor('webhook'), secrets: [SECRET], nowMs: NOW_MS, ...over });

test('a correctly signed delivery is accepted, with webhook-* headers and with legacy svix-* headers', () => {
  assert.deepEqual([verify().ok, verify().scheme], [true, 'webhook']);
  const r = verify({ headers: headersFor('svix') });
  assert.deepEqual([r.ok, r.scheme], [true, 'svix']);
});

test('a header carrying several signatures (secret rotation) is accepted if any v1 entry matches', () => {
  const rotated = 'v1,' + 'A'.repeat(44) + ' v2,ignored ' + sign('msg_1', ts, body);
  assert.equal(verify({ headers: headersFor('webhook', { 'webhook-signature': rotated }) }).ok, true);
});

test('either of two configured secrets may match (endpoint secret vs workspace verification secret)', () => {
  const other = 'whsec_' + crypto.randomBytes(32).toString('base64');
  assert.equal(verify({ secrets: [other, SECRET] }).ok, true);
  assert.equal(verify({ secrets: [undefined, '', SECRET] }).ok, true);
});

test('a forged signature, a wrong secret, or a tampered body is refused', () => {
  assert.equal(verify({ headers: headersFor('webhook', { 'webhook-signature': 'v1,' + 'A'.repeat(44) }) }).reason, 'bad_signature');
  assert.equal(verify({ secrets: ['whsec_' + crypto.randomBytes(32).toString('base64')] }).reason, 'bad_signature');
  assert.equal(verify({ rawBody: Buffer.from(body.replace('b1', 'b2')) }).reason, 'bad_signature');
});

test('a signature over re-serialised JSON of a different byte layout is refused (raw bytes are what is signed)', () => {
  const pretty = JSON.stringify(JSON.parse(body), null, 2);
  assert.equal(verify({ rawBody: Buffer.from(pretty) }).ok, false);
});

test('replay: timestamps outside the 5 minute tolerance are refused, both directions', () => {
  for (const delta of [-301, 301]) {
    const t = String(Math.floor(NOW_MS / 1000) + delta);
    const r = verify({ headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': sign('msg_1', t, body) } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'stale_timestamp');
  }
  const t = String(Math.floor(NOW_MS / 1000) - 299);
  assert.equal(verify({ headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': t, 'webhook-signature': sign('msg_1', t, body) } }).ok, true);
});

test('missing secret, no signature headers, or partial headers are all refused (the old code returned true for these)', () => {
  assert.equal(verify({ secrets: [] }).reason, 'no_secret');
  assert.equal(verify({ secrets: [undefined, ''] }).reason, 'no_secret');
  assert.equal(verify({ headers: {} }).reason, 'no_signature_headers');
  assert.equal(verify({ headers: { 'content-type': 'application/json' } }).ok, false);
  assert.equal(verify({ headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': ts } }).reason, 'partial_headers');
});

test('the old x-recall-signature / x-webhook-signature headers do not authenticate anything', () => {
  const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const r = verify({ headers: { 'x-recall-signature': hex } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_signature_headers');
});

test('diagnostics list header NAMES only, never values', () => {
  const names = presentSignatureHeaderNames({ ...headersFor('svix'), authorization: 'Bearer x' });
  assert.deepEqual(names.sort(), ['svix-id', 'svix-signature', 'svix-timestamp']);
  assert.equal(JSON.stringify(verify({ headers: {} })).includes('whsec_'), false);
});

test('a malformed secret never throws', () => {
  assert.equal(verify({ secrets: ['whsec_'] }).ok, false);
  assert.equal(verify({ secrets: ['%%%not-base64%%%'] }).ok, false);
});

test('guardrail: the Recall route verifies with the Svix helper and reports unverified deliveries', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.ok(src.includes('verifyRecallWebhook('), 'route uses the Svix check');
  assert.ok(src.includes("reportCounted('webhook_recall'"), 'unverified deliveries are counted');
  assert.equal(/Allow through in development/.test(src), false);
  assert.equal(/!RECALL_WEBHOOK_SECRET \|\| !signature\) \{\s*logger\.warn[^}]*return true/.test(src), false);
});
