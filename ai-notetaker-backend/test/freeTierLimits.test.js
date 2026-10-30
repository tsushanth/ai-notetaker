process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlidingWindow, aiDailyLimit, transcriptionGuard } = require('../src/middleware/freeTierLimits');
const { checkUsageLimits } = require('../src/middleware/subscription');

const mkRes = () => { const r = { code: null, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; return r; };
const run = async (mw, req) => { const res = mkRes(); let nexted = false; await mw(req, res, () => { nexted = true; }); return { res, nexted }; };
const deps = (o = {}) => ({
  now: () => 1_000_000_000_000,
  isPaid: async () => false,
  countAiUsage: async () => 0,
  getRecording: async () => ({ id: 'r1', status: 'uploaded', duration: null }),
  recentRecordings: async () => [],
  ...o
});
const ENV = {};

test('AI: a free user under the daily limit passes', async () => {
  const { nexted } = await run(aiDailyLimit({ deps: deps({ countAiUsage: async () => 59 }), window: new SlidingWindow(), env: ENV }), { userId: 'u1' });
  assert.equal(nexted, true);
});

test('AI: at the daily limit the user gets 429 DAILY_LIMIT_REACHED, not 403', async () => {
  const { res, nexted } = await run(aiDailyLimit({ deps: deps({ countAiUsage: async () => 60 }), window: new SlidingWindow(), env: ENV }), { userId: 'u1' });
  assert.equal(nexted, false);
  assert.equal(res.code, 429);
  assert.equal(res.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(res.body.details.limit, 60);
  assert.equal(res.body.details.upgradeRequired, false);
  assert.match(res.body.error, /60 AI generations/);
  assert.ok(res.headers['Retry-After']);
});

test('AI: the daily limit is env-configurable', async () => {
  const { res } = await run(aiDailyLimit({ deps: deps({ countAiUsage: async () => 3 }), window: new SlidingWindow(), env: { FREE_TIER_AI_GENERATIONS_PER_DAY: '3' } }), { userId: 'u1' });
  assert.equal(res.code, 429);
});

test('AI: paid users get 5x the limit', async () => {
  const mw = aiDailyLimit({ deps: deps({ isPaid: async () => true, countAiUsage: async () => 200 }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
  const mw2 = aiDailyLimit({ deps: deps({ isPaid: async () => true, countAiUsage: async () => 300 }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(mw2, { userId: 'u1' })).res.code, 429);
});

test('AI: the in-process window blocks a burst even when the table count is 0', async () => {
  const mw = aiDailyLimit({ deps: deps(), window: new SlidingWindow(), env: { FREE_TIER_AI_GENERATIONS_PER_DAY: '2' } });
  assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
  assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
  assert.equal((await run(mw, { userId: 'u1' })).res.code, 429);
  assert.equal((await run(mw, { userId: 'u2' })).nexted, true, 'other users are unaffected');
});

test('AI: a failing lookup never blocks the user', async () => {
  const mw = aiDailyLimit({ deps: deps({ countAiUsage: async () => { throw new Error('db down'); } }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
});

test('AI: no user -> 401', async () => {
  const { res } = await run(aiDailyLimit({ deps: deps(), window: new SlidingWindow(), env: ENV }), {});
  assert.equal(res.code, 401);
});

test('STT: a fresh free user passes', async () => {
  const { nexted } = await run(transcriptionGuard({ deps: deps(), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal(nexted, true);
});

test('STT: missing recording_id is left to the route (400)', async () => {
  const { nexted } = await run(transcriptionGuard({ deps: deps(), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: {} });
  assert.equal(nexted, true);
});

test('STT: an already-completed recording is never limited (no provider cost)', async () => {
  const d = deps({ getRecording: async () => ({ id: 'r1', status: 'completed' }), recentRecordings: async () => new Array(999).fill({ duration: 60, status: 'completed' }) });
  assert.equal((await run(transcriptionGuard({ deps: d, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).nexted, true);
});

test('STT: 30 transcriptions in 24h -> 429 with a clear message', async () => {
  const d = deps({ recentRecordings: async () => new Array(30).fill({ duration: 60, status: 'completed' }) });
  const { res, nexted } = await run(transcriptionGuard({ deps: d, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal(nexted, false);
  assert.equal(res.code, 429);
  assert.equal(res.body.details.scope, 'transcriptions');
  assert.match(res.body.error, /30 voice transcriptions/);
});

test('STT: 240 minutes of audio in 24h -> 429 audio_minutes', async () => {
  const d = deps({ recentRecordings: async () => [{ duration: 240 * 60, status: 'completed' }] });
  const { res } = await run(transcriptionGuard({ deps: d, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal(res.code, 429);
  assert.equal(res.body.details.scope, 'audio_minutes');
});

test('STT: a recording longer than 60 minutes is refused for free users (422 AUDIO_TOO_LONG), allowed for paid up to 5x', async () => {
  const d = deps({ getRecording: async () => ({ id: 'r1', status: 'uploaded', duration: 61 * 60 }) });
  const { res } = await run(transcriptionGuard({ deps: d, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal(res.code, 422);
  assert.equal(res.body.code, 'AUDIO_TOO_LONG');
  const paid = deps({ isPaid: async () => true, getRecording: async () => ({ id: 'r1', status: 'uploaded', duration: 61 * 60 }) });
  assert.equal((await run(transcriptionGuard({ deps: paid, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).nexted, true);
});

test('STT: repeated attempts (retries of a failing recording) hit the in-process window', async () => {
  const mw = transcriptionGuard({ deps: deps(), window: new SlidingWindow(), env: { FREE_TIER_TRANSCRIPTIONS_PER_DAY: '2' } });
  const req = () => ({ userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal((await run(mw, req())).nexted, true);
  assert.equal((await run(mw, req())).nexted, true);
  assert.equal((await run(mw, req())).res.code, 429);
});

test('STT: a failing lookup never blocks the user', async () => {
  const d = deps({ getRecording: async () => { throw new Error('x'); }, recentRecordings: async () => { throw new Error('y'); } });
  assert.equal((await run(transcriptionGuard({ deps: d, window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).nexted, true);
});

test('SlidingWindow forgets hits older than 24h', () => {
  const w = new SlidingWindow();
  w.record('k', 0);
  assert.equal(w.peek('k', 1, 1000).allowed, false);
  assert.equal(w.peek('k', 1, 24 * 3600 * 1000 + 1).allowed, true);
});

test('checkUsageLimits: default (flag off) is free -> only the daily limiter runs, no subscription/usage lookup', async () => {
  delete process.env.FREE_TIER_LEGACY_LIMITS;
  let daily = 0;
  const mw = checkUsageLimits('summary', { dailyLimiter: (req, res, next) => { daily++; next(); } });
  const { nexted } = await run(mw, { userId: 'u1' });
  assert.equal(nexted, true);
  assert.equal(daily, 1);
});

test('checkUsageLimits: the daily limiter can still say no in free mode', async () => {
  delete process.env.FREE_TIER_LEGACY_LIMITS;
  const mw = checkUsageLimits('summary', { dailyLimiter: (req, res) => res.status(429).json({}) });
  const { res, nexted } = await run(mw, { userId: 'u1' });
  assert.equal(nexted, false);
  assert.equal(res.code, 429);
});

test('checkUsageLimits: FREE_TIER_LEGACY_LIMITS=true routes through the old monthly check first (401 with no user proves it ran)', async () => {
  process.env.FREE_TIER_LEGACY_LIMITS = 'true';
  try {
    let daily = 0;
    const mw = checkUsageLimits('summary', { dailyLimiter: (req, res, next) => { daily++; next(); } });
    const { res, nexted } = await run(mw, {});
    assert.equal(res.code, 401);
    assert.equal(nexted, false);
    assert.equal(daily, 0);
  } finally { delete process.env.FREE_TIER_LEGACY_LIMITS; }
});
