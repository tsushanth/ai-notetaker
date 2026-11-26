// Daily limits are saved: every feature type the code writes is accepted by the table, a refused row is loud, and a saved
// count still blocks after a restart.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const stub = (rel, exports) => { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; };
const logged = [];
const reported = [];
stub('../src/utils/logger', { logger: { info() {}, debug() {}, warn() {}, error: (m, c) => logged.push([m, c]) } });
stub('../src/utils/failureReporter', { reportCounted: (...a) => reported.push(a), reportFailure: async () => {} });
let insertResult = { error: null };
const inserted = [];
stub('@supabase/supabase-js', { createClient: () => ({ from: () => ({ insert: async (row) => { inserted.push(row); return insertResult; } }) }) });

const { USAGE_FEATURE_TYPES, AI_FEATURE_TYPES, FEATURE_CAPS, DAY_MS } = require('../src/utils/freeTierPolicy');
const { recordUsage } = require('../src/middleware/subscription');
const { featureDailyCap, SlidingWindow } = require('../src/middleware/freeTierLimits');

const root = path.join(__dirname, '..');
const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('the migration accepts exactly the feature types the backend lists', () => {
  const sql = fs.readFileSync(path.join(root, 'scripts/usage-tracking-feature-types-2026-11-26.sql'), 'utf8');
  const list = /check \(feature_type in \(([\s\S]*?)\)\)/.exec(sql)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...list].sort(), [...USAGE_FEATURE_TYPES].sort());
});

test('every feature type the code writes or counts is in that list', () => {
  const written = sources(path.join(root, 'src')).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/recordUsage\(req\.userId, '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(written.length >= 9, 'the scan found the route calls');
  const used = [...written, ...AI_FEATURE_TYPES, ...Object.values(FEATURE_CAPS).flatMap((s) => s.types)];
  assert.deepEqual(used.filter((t) => !USAGE_FEATURE_TYPES.includes(t)), []);
});

test('a refused usage row is logged and reported, and the request is not broken', async () => {
  logged.length = 0; reported.length = 0;
  insertResult = { error: { message: 'violates check constraint "usage_tracking_feature_type_check"', code: '23514' } };
  assert.equal(await recordUsage('u1', 'upload', {}), false);
  assert.equal(logged[0][0], 'Failed to record usage');
  assert.equal(reported[0][0], 'usage_record_failed');
  assert.deepEqual(reported[0][2], { feature: 'upload', db_code: '23514' });
});

test('an accepted usage row is quiet', async () => {
  logged.length = 0; reported.length = 0; inserted.length = 0;
  insertResult = { error: null };
  assert.equal(await recordUsage('u1', 'tts', { via: 'daily_cap' }), true);
  assert.equal(inserted[0].feature_type, 'tts');
  assert.equal(logged.length + reported.length, 0);
});

const mkRes = () => ({ code: null, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('upload limit stays 10 and holds after a restart, with the time until the next use', async () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const deps = {
    now: () => now, isPaid: async () => false, countUsage: async () => 10, recordUsage: async () => true, llmSpendUsd: async () => 0,
    usageAt: async (userId, types, since, index) => { assert.equal(index, 0); return new Date(now - DAY_MS + 5 * 3600_000).toISOString(); },
  };
  const res = mkRes();
  let passed = false;
  // A new window is what a restarted machine has: only the table remembers.
  await featureDailyCap('upload', { deps, window: new SlidingWindow(), env: {}, cache: { at: 0, usd: 0, has: false } })({ userId: 'u1' }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.code, 429);
  assert.equal(res.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(res.body.error, 'You have reached today\'s limit of 10 uploads. You can try again in about 5 hours.');
  assert.equal(res.headers['Retry-After'], String(5 * 3600));
});

test('the tenth upload still passes', async () => {
  const deps = { now: () => Date.now(), isPaid: async () => false, countUsage: async () => 9, recordUsage: async () => true, llmSpendUsd: async () => 0 };
  let passed = false;
  await featureDailyCap('upload', { deps, window: new SlidingWindow(), env: {}, cache: { at: 0, usd: 0, has: false } })({ userId: 'u1' }, mkRes(), () => { passed = true; });
  assert.equal(passed, true);
});
