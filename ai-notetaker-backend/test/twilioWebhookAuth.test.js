const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Twilio = require('twilio');
process.env.FAILURE_REPORTER_DISABLED = '1';
const { twilioWebhookAuth, verifyTwilioRequest, candidateUrls } = require('../src/middleware/twilioWebhookAuth');

const TOKEN = 'test-auth-token-0123456789abcdef';
const BASE = 'https://ai-notetaker-backend.fly.dev';
const params = { CallSid: 'CA123', CallStatus: 'completed' };
const sign = (url, p = params, token = TOKEN) => Twilio.getExpectedTwilioSignature(token, url, p);
const reqFor = (sig, url = '/v1/webhooks/twilio/call-status?call_id=abc') => ({ originalUrl: url, headers: { host: 'ai-notetaker-backend.fly.dev', ...(sig ? { 'x-twilio-signature': sig } : {}) }, body: params });

test('verify: signed request ok (SERVICE URL and Host header candidates), with or without /v1', () => {
  assert.equal(verifyTwilioRequest(reqFor(sign(`${BASE}/v1/webhooks/twilio/call-status?call_id=abc`)), TOKEN, BASE).ok, true);
  assert.equal(verifyTwilioRequest(reqFor(sign(`${BASE}/webhooks/twilio/call-status?call_id=abc`)), TOKEN, undefined).ok, true);
});
test('verify: missing signature, wrong token, tampered params, no token', () => {
  const url = `${BASE}/v1/webhooks/twilio/call-status?call_id=abc`;
  assert.deepEqual(verifyTwilioRequest(reqFor(undefined), TOKEN, BASE), { ok: false, reason: 'no_signature_header' });
  assert.equal(verifyTwilioRequest(reqFor(sign(url, params, 'other-token-0123456789abcdef')), TOKEN, BASE).reason, 'signature_mismatch');
  assert.equal(verifyTwilioRequest(reqFor(sign(url, { ...params, CallStatus: 'failed' })), TOKEN, BASE).ok, false);
  assert.equal(verifyTwilioRequest(reqFor(sign(url)), undefined, BASE).reason, 'auth_token_not_configured');
});
test('candidateUrls', () => {
  const c = candidateUrls({ originalUrl: '/v1/webhooks/twilio/x?a=1', headers: { host: 'h.example' } }, 'https://svc.example/');
  assert.deepEqual(c.sort(), ['https://h.example/v1/webhooks/twilio/x?a=1', 'https://h.example/webhooks/twilio/x?a=1', 'https://svc.example/v1/webhooks/twilio/x?a=1']);
});

async function start(enforce) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const hits = [];
  app.use('/v1/webhooks/twilio', twilioWebhookAuth({ enforce: () => enforce, authToken: () => TOKEN, baseUrl: () => BASE }));
  app.post('/v1/webhooks/twilio/call-status', (req, res) => { hits.push(1); res.json({ ok: true }); });
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const post = (headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/v1/webhooks/twilio/call-status?call_id=abc`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(params).toString() }).then((r) => r.status);
  return { server, hits, post };
}
const PATH = '/v1/webhooks/twilio/call-status?call_id=abc';

test('phase 1: unsigned and forged requests still reach the handler; correctly signed does too', async () => {
  const { server, hits, post } = await start(false);
  try {
    assert.equal(await post(), 200);
    assert.equal(await post({ 'X-Twilio-Signature': 'bogus' }), 200);
    assert.equal(await post({ 'X-Twilio-Signature': sign(`${BASE}${PATH}`) }), 200);
    assert.equal(hits.length, 3);
  } finally { server.close(); }
});
test('enforce: unsigned and forged get 403 and never reach the handler; signed passes', async () => {
  const { server, hits, post } = await start(true);
  try {
    assert.equal(await post(), 403);
    assert.equal(await post({ 'X-Twilio-Signature': 'bogus' }), 403);
    assert.equal(hits.length, 0);
    assert.equal(await post({ 'X-Twilio-Signature': sign(`${BASE}${PATH}`) }), 200);
    assert.equal(hits.length, 1);
  } finally { server.close(); }
});
test('guardrail: every twilioWebhooks route sits behind the middleware', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/routes/twilioWebhooks.js'), 'utf8');
  const useIdx = src.indexOf('router.use(twilioWebhookAuth())');
  assert.ok(useIdx > 0);
  assert.equal(src.indexOf('router.post(') > useIdx, true);
});
