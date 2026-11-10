const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { FLAG_ENV, isEnabled, snapshot, requireFeature } = require('../src/config/featureFlags');

const KEYS = Object.values(FLAG_ENV);
const saved = {};
test.beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const get = (s, p, method = 'GET') => fetch(`http://127.0.0.1:${s.address().port}${p}`, { method }).then(async (r) => ({ status: r.status, text: await r.text(), headers: r.headers }));

test('every flag is off unless its variable is explicitly on', () => {
  assert.deepEqual(snapshot({}), { phone_calls: false, learn: false, create: false, compete: false });
  for (const v of ['', '0', 'false', 'off', 'no', 'enabled', 'y']) assert.equal(isEnabled('learn', { FEATURE_LEARN: v }), false, v);
  for (const v of ['1', 'true', 'TRUE', ' on ', 'yes']) assert.equal(isEnabled('learn', { FEATURE_LEARN: v }), true, v);
  assert.equal(isEnabled('no_such_flag', { FEATURE_NO_SUCH_FLAG: '1' }), false);
});

test('GET /api/config/features reports the flags, needs no sign-in, and follows the environment', async () => {
  const app = express();
  app.use('/api/config', require('../src/routes/config'));
  const s = await listen(app);
  try {
    let r = await get(s, '/api/config/features');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text), { success: true, data: { phone_calls: false, learn: false, create: false, compete: false } });
    process.env.FEATURE_COMPETE = '1';
    r = await get(s, '/api/config/features');
    assert.equal(JSON.parse(r.text).data.compete, true);
    assert.equal(JSON.parse(r.text).data.phone_calls, false);
  } finally { s.close(); }
});

test('a gated API route answers 404 FEATURE_DISABLED while off, and works when on', async () => {
  const app = express();
  app.use('/api/phone', requireFeature('phone_calls'), (req, res) => res.json({ ok: true }));
  const s = await listen(app);
  try {
    let r = await get(s, '/api/phone/anything', 'POST');
    assert.equal(r.status, 404);
    assert.equal(JSON.parse(r.text).code, 'FEATURE_DISABLED');
    process.env.FEATURE_PHONE_CALLS = 'true';
    r = await get(s, '/api/phone/anything', 'POST');
    assert.equal(r.status, 200);
  } finally { s.close(); }
});

test('gated pages are a 404 with a short message, and the learn worker webhooks stay reachable while off', async () => {
  const app = express();
  app.use('/learn', requireFeature('learn', { page: true }), (req, res) => res.send('page'));
  app.use('/api/learn', requireFeature('learn', { except: /^\/webhook\// }), (req, res) => res.json({ path: req.path }));
  const s = await listen(app);
  try {
    let r = await get(s, '/learn/abc');
    assert.equal(r.status, 404);
    assert.match(r.text, /no longer available/);
    assert.doesNotMatch(r.text, /<script/i);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await get(s, '/api/learn/session/1')).status, 404);
    assert.equal((await get(s, '/api/learn/webhook/lesson-ready', 'POST')).status, 200);
    assert.equal((await get(s, '/api/learn/webhook/infographic-ready', 'POST')).status, 200);
    process.env.FEATURE_LEARN = '1';
    assert.equal((await get(s, '/learn/abc')).text, 'page');
  } finally { s.close(); }
});

test('app.js mounts every hidden feature behind its flag, and leaves the Twilio webhooks alone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const expect = {
    "'/learn'": 'learn', "'/create'": 'create', "'/compete'": 'compete', "'/compete-create'": 'compete',
    "'/api/learn'": 'learn', "'/api/create'": 'create', "'/api/compete'": 'compete', "'/api/phone'": 'phone_calls',
  };
  for (const [mount, flag] of Object.entries(expect)) {
    const line = src.split('\n').find((l) => l.startsWith(`app.use(${mount},`));
    assert.ok(line, `${mount} is mounted`);
    assert.ok(line.includes(`requireFeature('${flag}'`), `${mount} is gated by ${flag}`);
  }
  assert.match(src, /app\.use\('\/v1\/webhooks\/twilio', twilioWebhookRoutes\)/);
  assert.match(src, /app\.use\('\/api\/config', configRoutes\)/);
});
