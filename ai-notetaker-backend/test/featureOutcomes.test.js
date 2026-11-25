const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = 'test';
function stub(rel, exports) { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; }
const reports = []; const beats = [];
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('../src/utils/failureReporter', {
  reportFailure: (flow, err, ctx) => reports.push({ flow, message: err.message, ctx }),
  reportCounted: (flow, message, ctx) => reports.push({ flow, message, ctx }),
  heartbeat: (job) => beats.push(job),
});
const { createFeatureOutcomes, featureName, outcomeOf, clientKind } = require('../src/middleware/featureOutcomes');
const health = require('../src/services/featureHealth');
const { createProbeAlerts } = require('../src/services/llmMonitor');

const U = '11111111-1111-1111-1111-111111111111';
const rows = [];
let clock = 1_000_000;
const outcomes = createFeatureOutcomes({ insert: async (r) => rows.push(...r), now: () => clock, env: {} });
const app = express();
app.use(outcomes.middleware);
const router = express.Router();
router.post('/summary', (req, res) => { req.userId = U; res.json({ ok: true }); });
router.get('/:id', (req, res) => res.status(404).json({}));
router.post('/pending', (req, res) => { res.locals.outcome = 'pending'; res.status(503).json({}); });
let onHang;
router.post('/hang', () => onHang());
app.use('/api/ai', router);
let server;
test.before(async () => { server = app.listen(0); await new Promise((r) => server.once('listening', r)); });
test.after(() => server.close());

const call = (method, path, headers) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers });
const settle = async () => { await new Promise((r) => setTimeout(r, 30)); await outcomes.flush(); };

test('route names carry no ids or query strings', () => {
  assert.equal(featureName('GET', `/api/notes/${U}/export/pdf?token=abc`), 'GET /api/notes/:id/export/pdf');
  assert.equal(featureName('GET', '/api/shared/aZ09aZ09aZ09aZ09'), 'GET /api/shared/:id');
  assert.equal(featureName('POST', '/api/ai/flashcards/'), 'POST /api/ai/flashcards');
});

test('outcomes and clients', () => {
  assert.equal(outcomeOf({ status: 200 }), 'ok');
  assert.equal(outcomeOf({ status: 403 }), 'denied');
  assert.equal(outcomeOf({ status: 429 }), 'limit');
  assert.equal(outcomeOf({ status: 422 }), 'client_error');
  assert.equal(outcomeOf({ status: 502 }), 'server_error');
  assert.equal(outcomeOf({ status: 200, abandoned: true }), 'abandoned');
  assert.equal(clientKind('okhttp/4.12'), 'android');
  assert.equal(clientKind('Mozilla/5.0'), 'web');
});

test('a finished request is recorded with feature, outcome, status, duration and account', async () => {
  rows.length = 0;
  await (await call('POST', '/api/ai/summary?secret=1', { 'user-agent': 'okhttp/4' })).json();
  await (await call('GET', `/api/ai/${U}`)).json();
  await (await call('POST', '/api/ai/pending')).json();
  await call('GET', '/api/nothing-here');
  await call('GET', '/health');
  await settle();
  assert.deepEqual(rows.map((r) => [r.feature, r.outcome, r.status]), [
    ['POST /api/ai/summary', 'ok', 200], ['GET /api/ai/:id', 'client_error', 404], ['POST /api/ai/pending', 'pending', 503]]);
  assert.equal(rows[0].user_id, U);
  assert.equal(rows[0].client, 'android');
  assert.ok(!JSON.stringify(rows).includes('secret'));
});

test('a request the caller abandons is recorded, with how long they waited, and reported', async () => {
  rows.length = 0; reports.length = 0;
  const controller = new AbortController();
  onHang = () => { clock += 125_000; controller.abort(); };
  await assert.rejects(fetch(`http://127.0.0.1:${server.address().port}/api/ai/hang`, { method: 'POST', signal: controller.signal }));
  await settle();
  assert.deepEqual([rows[0].outcome, rows[0].status, rows[0].duration_ms], ['abandoned', null, 125_000]);
  assert.equal(reports[0].flow, 'request_abandoned');
});

test('a missing table drops rows without touching the request', async () => {
  const logged = [];
  const broken = createFeatureOutcomes({ insert: async () => { throw new Error('relation "feature_outcomes" does not exist'); }, log: (m) => logged.push(m), env: {} });
  broken.recorder.record({ feature: 'x' });
  await broken.flush();
  assert.equal(logged.length, 1);
});

test('feature health: nothing worked in a week, or most of a busy day failed', () => {
  const r = (feature, a7, o7, a1 = 0, o1 = 0) => ({ feature, attempts_7d: a7, ok_7d: o7, attempts_24h: a1, ok_24h: o1 });
  const out = health.evaluate([r('dead', 3, 0), r('tiny', 2, 0), r('bad-day', 40, 30, 6, 2), r('fine', 40, 38, 6, 5)]);
  assert.deepEqual(out.map((f) => [f.feature, f.code]), [['dead', 'NO_SUCCESS_7D'], ['bad-day', 'LOW_SUCCESS_24H']]);
});

test('feature health: one report per failing feature per day, and a beat only when the view was read', async () => {
  reports.length = 0; beats.length = 0;
  const db = (answer) => ({ from: () => ({ select: async () => answer }) });
  const failing = db({ data: [{ feature: 'POST /api/ai/mindmap', attempts_7d: 3, ok_7d: 0 }], error: null });
  await health.checkFeatureHealth({ db: failing, now: 0 });
  await health.checkFeatureHealth({ db: failing, now: 3600_000 });
  assert.equal(reports.length, 1);
  assert.equal(beats.length, 2);
  assert.equal(await health.checkFeatureHealth({ db: db({ data: null, error: { message: 'no view' } }) }), null);
  assert.equal(beats.length, 2);
});

test('AI probe: every result beats; two failures in a row report once an hour', () => {
  const sent = []; const alive = []; let now = 0;
  const on = createProbeAlerts({ report: (flow, e, ctx) => sent.push(ctx), beat: (j) => alive.push(j), now: () => now });
  on({ ok: false, status: 400, error_type: 'invalid_request_error' });
  assert.equal(sent.length, 0);
  on({ ok: false, status: 400, error_type: 'invalid_request_error' });
  on({ ok: false });
  assert.equal(sent.length, 1);
  now = 3600_000; on({ ok: false });
  assert.equal(sent.length, 2);
  on({ ok: true }); on({ ok: false });
  assert.equal(sent.length, 2);
  assert.equal(alive.length, 6);
});
