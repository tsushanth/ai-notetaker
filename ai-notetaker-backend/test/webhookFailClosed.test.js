const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy';
process.env.FAILURE_REPORTER_DISABLED = '1';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'dummy';

const { verifySnsMessage, isSnsUrl, canonicalString } = require('../src/utils/snsVerify');

function listen(app) {
  return new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
}
async function post(server, p, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return res.status;
}

// ---- RevenueCat (ScribeAI): used to accept every request when REVENUECAT_WEBHOOK_SECRET was unset ----
test('RevenueCat webhook: unset secret => 503, wrong/missing Authorization => 401, correct => reaches the handler', async () => {
  const express = require('express');
  const router = require('../src/routes/subscriptions');
  const app = express();
  app.use('/api/subscriptions', router);
  const server = await listen(app);
  try {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', { event: { type: 'EXPIRATION', app_user_id: 'u' } }), 503);
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', { event: { type: 'EXPIRATION', app_user_id: 'u' } }, { Authorization: '' }), 503);
    process.env.REVENUECAT_WEBHOOK_SECRET = 'rc-secret-for-tests';
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', { event: {} }), 401);
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', { event: {} }, { Authorization: 'wrong' }), 401);
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', { event: { type: 'SOME_UNHANDLED_TYPE' } }, { Authorization: 'rc-secret-for-tests' }), 200, 'authorised request reaches the handler (unhandled type is acknowledged)');
    assert.equal(await post(server, '/api/subscriptions/webhook/revenuecat', {}, { Authorization: 'rc-secret-for-tests' }), 400);
  } finally { delete process.env.REVENUECAT_WEBHOOK_SECRET; server.close(); }
});

// ---- Learning worker callbacks ----
test('learning webhooks: secret is checked BEFORE the body is acted on, constant-time, fails closed when unset', async () => {
  const express = require('express');
  const router = require('../src/routes/learning');
  const { errorHandler } = require('../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/learn', router);
  app.use(errorHandler);
  const server = await listen(app);
  try {
    process.env.LEARNING_WORKER_SECRET = 'worker-secret';
    // the old failure branch ran for ANY caller who knew a session id (it wrote generation_status=failed)
    assert.equal(await post(server, '/api/learn/webhook/lesson-ready', { sessionId: 's1', secret: 'nope', error: 'x' }), 401);
    assert.equal(await post(server, '/api/learn/webhook/infographic-ready', { type: 'infographic_error', secret: 'nope' }), 401);
    assert.equal(await post(server, '/api/learn/webhook/infographic-ready', { type: 'infographic_error', secret: 'worker-secret' }), 200);
    delete process.env.LEARNING_WORKER_SECRET;
    assert.equal(await post(server, '/api/learn/webhook/infographic-ready', { type: 'infographic_error', secret: 'undefined' }), 401);
    assert.equal(await post(server, '/api/learn/webhook/lesson-ready', { sessionId: 's1', secret: 'x', error: 'x' }), 401);
  } finally { delete process.env.LEARNING_WORKER_SECRET; server.close(); }
});

// ---- SNS ----
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const CERT_URL = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem';
function signed(over = {}, version = '2') {
  const msg = { Type: 'Notification', MessageId: 'm1', TopicArn: 'arn:aws:sns:us-east-1:1:t', Message: '{"notificationType":"Bounce"}', Timestamp: '2026-11-01T00:00:00.000Z', SignatureVersion: version, SigningCertURL: CERT_URL, ...over };
  msg.Signature = crypto.createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256').update(canonicalString(msg)).sign(privateKey, 'base64');
  return msg;
}
const fetchCert = async () => PEM;

test('SNS: a correctly signed Notification / SubscriptionConfirmation verifies (SignatureVersion 1 and 2)', async () => {
  assert.equal((await verifySnsMessage(signed(), { fetchCert })).ok, true);
  assert.equal((await verifySnsMessage(signed({}, '1'), { fetchCert })).ok, true);
  const conf = signed({ Type: 'SubscriptionConfirmation', Token: 't', SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t' });
  assert.equal((await verifySnsMessage(conf, { fetchCert })).ok, true);
});

test('SNS: unsigned, tampered, wrong-key and off-AWS certificate URLs are refused', async () => {
  assert.equal((await verifySnsMessage({}, { fetchCert })).ok, false);
  assert.equal((await verifySnsMessage({ Type: 'Notification', Message: 'x' }, { fetchCert })).reason, 'no_signature');
  const m = signed();
  assert.equal((await verifySnsMessage({ ...m, Message: 'tampered' }, { fetchCert })).reason, 'bad_signature');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal((await verifySnsMessage(m, { fetchCert: async () => other.publicKey.export({ type: 'spki', format: 'pem' }) })).ok, false);
  for (const url of ['https://evil.example.com/cert.pem', 'http://sns.us-east-1.amazonaws.com/c.pem', 'https://sns.us-east-1.amazonaws.com.evil.com/c.pem', 'https://sns.us-east-1.amazonaws.com/c.txt', 'https://u@sns.us-east-1.amazonaws.com/c.pem']) {
    let fetched = false;
    const r = await verifySnsMessage(signed({ SigningCertURL: url }), { fetchCert: async () => { fetched = true; return PEM; } });
    assert.equal(r.ok, false, url);
    assert.equal(fetched, false, 'never fetches a certificate from a non-SNS host: ' + url);
  }
});

test('SNS: SubscribeURL host allow-list (the SSRF fix)', () => {
  assert.equal(isSnsUrl('https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription'), true);
  for (const u of ['http://169.254.169.254/latest', 'https://internal.flycast/x', 'https://sns.us-east-1.amazonaws.com.evil.com/', 'http://sns.us-east-1.amazonaws.com/', 'not a url', undefined]) assert.equal(isSnsUrl(u), false, String(u));
});

test('SES webhook route refuses an unsigned body and never fetches an attacker-supplied SubscribeURL', async () => {
  const express = require('express');
  const axios = require('axios');
  const origGet = axios.get;
  let fetched = 0;
  axios.get = async () => { fetched++; return {}; };
  const router = require('../src/routes/outreach');
  const app = express();
  app.use(express.json());
  app.use('/api/outreach', router);
  const server = await listen(app);
  try {
    assert.equal(await post(server, '/api/outreach/webhook/ses', {}), 403);
    assert.equal(await post(server, '/api/outreach/webhook/ses', { Type: 'SubscriptionConfirmation', SubscribeURL: 'http://169.254.169.254/latest/meta-data' }), 403);
    assert.equal(await post(server, '/api/outreach/webhook/ses', { Type: 'Notification', Message: JSON.stringify({ notificationType: 'Bounce' }) }), 403);
    assert.equal(fetched, 0);
  } finally { axios.get = origGet; server.close(); }
});

test('guardrail: no webhook route in ScribeAI compares a secret with !== / === against an env var', () => {
  for (const f of ['routes/subscriptions.js', 'routes/learning.js', 'routes/outreach.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');
    assert.equal(/webhookSecret\s*&&\s*authHeader/.test(src), false, f);
    assert.equal(/secret\s*!==\s*process\.env/.test(src), false, f);
  }
});
