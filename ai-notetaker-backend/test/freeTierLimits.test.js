process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlidingWindow, aiDailyLimit, transcriptionGuard, featureDailyCap, meetingBotGuard, llmSpendBreaker, admitAutoFormatting } = require('../src/middleware/freeTierLimits');
const { checkUsageLimits } = require('../src/middleware/subscription');

const mkRes = () => { const r = { code: null, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; return r; };
const run = async (mw, req) => { const res = mkRes(); let nexted = false; await mw(req, res, () => { nexted = true; }); return { res, nexted }; };
const deps = (o = {}) => ({
  now: () => 1_000_000_000_000,
  isPaid: async () => false,
  countAiUsage: async () => 0,
  getRecording: async () => ({ id: 'r1', status: 'uploaded', duration: null }),
  recentRecordings: async () => [],
  countUsage: async () => 0,
  recordUsage: async () => {},
  recentMeetings: async () => [],
  llmSpendUsd: async () => 0,
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
  const mw = aiDailyLimit({ deps: deps({ isPaid: async () => true, countAiUsage: async () => 299 }), window: new SlidingWindow(), env: ENV });
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
  const mw = checkUsageLimits('summary', { breaker: (q, r, n) => n(), dailyLimiter: (req, res, next) => { daily++; next(); } });
  const { nexted } = await run(mw, { userId: 'u1' });
  assert.equal(nexted, true);
  assert.equal(daily, 1);
});

test('checkUsageLimits: the daily limiter can still say no in free mode', async () => {
  delete process.env.FREE_TIER_LEGACY_LIMITS;
  const mw = checkUsageLimits('summary', { breaker: (q, r, n) => n(), dailyLimiter: (req, res) => res.status(429).json({}) });
  const { res, nexted } = await run(mw, { userId: 'u1' });
  assert.equal(nexted, false);
  assert.equal(res.code, 429);
});

test('checkUsageLimits: FREE_TIER_LEGACY_LIMITS=true routes through the old monthly check first (401 with no user proves it ran)', async () => {
  process.env.FREE_TIER_LEGACY_LIMITS = 'true';
  try {
    let daily = 0;
    const mw = checkUsageLimits('summary', { breaker: (q, r, n) => n(), dailyLimiter: (req, res, next) => { daily++; next(); } });
    const { res, nexted } = await run(mw, {});
    assert.equal(res.code, 401);
    assert.equal(nexted, false);
    assert.equal(daily, 0);
  } finally { delete process.env.FREE_TIER_LEGACY_LIMITS; }
});

// ---- defaults of the free plan ----------------------------------------------------------------------------------------
test('STT: the 31st transcription of the day is refused, the 30th is allowed (default 30/day, unchanged)', async () => {
  const mk = (n) => deps({ recentRecordings: async () => new Array(n).fill({ duration: 30, status: 'completed' }) });
  assert.equal((await run(transcriptionGuard({ deps: mk(29), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).nexted, true);
  assert.equal((await run(transcriptionGuard({ deps: mk(30), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).res.code, 429);
});

test('STT: 239 minutes of audio today is fine, 240 is not (default 240 min/day, unchanged)', async () => {
  const mk = (min) => deps({ recentRecordings: async () => [{ duration: min * 60, status: 'completed' }] });
  assert.equal((await run(transcriptionGuard({ deps: mk(239), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } })).nexted, true);
  const { res } = await run(transcriptionGuard({ deps: mk(240), window: new SlidingWindow(), env: ENV }), { userId: 'u1', body: { recording_id: 'r1' } });
  assert.equal(res.code, 429);
  assert.match(res.body.error, /240 minutes/);
});

// ---- per-feature caps -------------------------------------------------------------------------------------------------
test('feature cap: podcast 3/day. 2 used -> pass; 3 used -> 429 with the shared body shape', async () => {
  const mk = (n) => featureDailyCap('podcast', { deps: deps({ countUsage: async () => n }), window: new SlidingWindow(), env: ENV, cache: { at: 0, usd: 0, has: false } });
  assert.equal((await run(mk(2), { userId: 'u1' })).nexted, true);
  const { res, nexted } = await run(mk(3), { userId: 'u1' });
  assert.equal(nexted, false);
  assert.equal(res.code, 429);
  assert.deepEqual(Object.keys(res.body).sort(), ['code', 'details', 'error', 'success']);
  assert.equal(res.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(res.body.details.scope, 'podcast');
  assert.equal(res.body.details.limit, 3);
  assert.equal(res.body.details.upgradeRequired, false);
  assert.match(res.body.error, /limit of 3 podcasts/);
});

test('feature cap: counts the right usage types and the last 24 hours only', async () => {
  let seen;
  const d = deps({ countUsage: async (u, types, since) => { seen = { u, types, since }; return 0; } });
  await run(featureDailyCap('upload', { deps: d, window: new SlidingWindow(), env: ENV, cache: { at: 0, usd: 0, has: false } }), { userId: 'u9' });
  assert.deepEqual(seen.types, ['upload']);
  assert.equal(seen.u, 'u9');
  assert.equal(seen.since, new Date(1_000_000_000_000 - 24 * 3600 * 1000).toISOString());
});

test('feature cap: record:true features write one usage row on admit, record:false features do not', async () => {
  const rec = [];
  const d = deps({ recordUsage: async (u, t) => { rec.push([u, t]); } });
  const nocache = () => ({ at: 0, usd: 0, has: false });
  await run(featureDailyCap('tts', { deps: d, window: new SlidingWindow(), env: ENV, cache: nocache() }), { userId: 'u1' });
  await run(featureDailyCap('podcast', { deps: d, window: new SlidingWindow(), env: ENV, cache: nocache() }), { userId: 'u1' });
  assert.deepEqual(rec, [['u1', 'tts']]);
});

test('feature cap: Pro users get the explicit Pro number (podcast 10, infographic 15), others the paid multiplier; a failing count never blocks; a bad name throws', async () => {
  const nocache = () => ({ at: 0, usd: 0, has: false });
  const paid = deps({ isPaid: async () => true, countUsage: async () => 9 });
  assert.equal((await run(featureDailyCap('podcast', { deps: paid, window: new SlidingWindow(), env: ENV, cache: nocache() }), { userId: 'u1' })).nexted, true);
  const paid2 = deps({ isPaid: async () => true, countUsage: async () => 10 });
  const blocked = await run(featureDailyCap('podcast', { deps: paid2, window: new SlidingWindow(), env: ENV, cache: nocache() }), { userId: 'u1' });
  assert.equal(blocked.res.code, 429);
  assert.equal(blocked.res.body.details.limit, 10);
  const info = (n) => featureDailyCap('infographic', { deps: deps({ isPaid: async () => true, countUsage: async () => n }), window: new SlidingWindow(), env: ENV, cache: nocache() });
  assert.equal((await run(info(14), { userId: 'u1' })).nexted, true);
  assert.equal((await run(info(15), { userId: 'u1' })).res.code, 429);
  const tts = (n) => featureDailyCap('tts', { deps: deps({ isPaid: async () => true, countUsage: async () => n }), window: new SlidingWindow(), env: ENV, cache: nocache() });
  assert.equal((await run(tts(99), { userId: 'u1' })).nexted, true, 'tts: 5 x 20');
  assert.equal((await run(tts(100), { userId: 'u1' })).res.code, 429);
  const broken = deps({ countUsage: async () => { throw new Error('db'); } });
  assert.equal((await run(featureDailyCap('podcast', { deps: broken, window: new SlidingWindow(), env: ENV, cache: nocache() }), { userId: 'u1' })).nexted, true);
  assert.throws(() => featureDailyCap('nope'), /unknown capped feature/);
});

test('feature cap: no user -> 401', async () => {
  const { res } = await run(featureDailyCap('podcast', { deps: deps(), window: new SlidingWindow(), env: ENV, cache: { at: 0, usd: 0, has: false } }), {});
  assert.equal(res.code, 401);
});

// ---- meeting bot ------------------------------------------------------------------------------------------------------
const mtg = (status, hours) => ({ status, duration_seconds: hours == null ? null : hours * 3600 });

test('meeting guard: 3 sessions/day for non-Pro (only reachable with the flag off)', async () => {
  const mk = (rows) => meetingBotGuard({ deps: deps({ recentMeetings: async () => rows }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(mk([mtg('completed', 1), mtg('completed', 1)]), { userId: 'u1' })).nexted, true);
  const { res } = await run(mk([mtg('completed', 0.1), mtg('completed', 0.1), mtg('bot_joining', null)]), { userId: 'u1' });
  assert.equal(res.code, 429);
  assert.equal(res.body.details.scope, 'meeting_sessions');
});

test('meeting guard: 4 hours/day; unknown length counts as 1 hour; failed and cancelled do not count', async () => {
  const mk = (rows) => meetingBotGuard({ deps: deps({ recentMeetings: async () => rows }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(mk([mtg('completed', 3.9)]), { userId: 'u1' })).nexted, true);
  assert.equal((await run(mk([mtg('completed', 4)]), { userId: 'u1' })).res.body.details.scope, 'meeting_hours');
  assert.equal((await run(mk([mtg('in_call', null), mtg('completed', 3)]), { userId: 'u1' })).res.body.details.scope, 'meeting_hours', '1h assumed + 3h = 4h');
  assert.equal((await run(mk([mtg('failed', 9), mtg('cancelled', 9), mtg('completed', 1)]), { userId: 'u1' })).nexted, true);
});

test('meeting guard: the in-process window stops a burst before the table shows it; a failing lookup does not block; paid get 5x', async () => {
  const w = new SlidingWindow();
  const mw = meetingBotGuard({ deps: deps(), window: w, env: ENV });
  for (let i = 0; i < 3; i++) assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
  assert.equal((await run(mw, { userId: 'u1' })).res.code, 429);
  const broken = meetingBotGuard({ deps: deps({ recentMeetings: async () => { throw new Error('x'); } }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(broken, { userId: 'u1' })).nexted, true);
  const pro = (rows) => meetingBotGuard({ deps: deps({ isPaid: async () => true, recentMeetings: async () => rows }), window: new SlidingWindow(), env: ENV });
  assert.equal((await run(pro(new Array(7).fill(mtg('completed', 0.1))), { userId: 'u1' })).nexted, true, 'Pro: 8 sessions/day');
  assert.equal((await run(pro(new Array(8).fill(mtg('completed', 0.1))), { userId: 'u1' })).res.body.details.limit, 8);
  assert.equal((await run(pro([mtg('completed', 9.9)]), { userId: 'u1' })).nexted, true, 'Pro: 10 hours/day');
  assert.equal((await run(pro([mtg('completed', 10)]), { userId: 'u1' })).res.body.details.scope, 'meeting_hours');
});

// ---- global breaker -----------------------------------------------------------------------------------------------------
const brk = (usd, o = {}) => llmSpendBreaker({ deps: deps({ llmSpendUsd: async () => usd, ...o }), env: ENV, cache: { at: 0, usd: 0, has: false, inflight: null } });

test('breaker: under $25 passes; $25 blocks non-paying users only; $75 blocks everyone', async () => {
  assert.equal((await run(brk(24.99), { userId: 'u1' })).nexted, true);
  const soft = await run(brk(25), { userId: 'u1' });
  assert.equal(soft.res.code, 429);
  assert.equal(soft.res.body.code, 'GLOBAL_DAILY_BUDGET_REACHED');
  assert.equal((await run(brk(25, { isPaid: async () => true }), { userId: 'u1' })).nexted, true);
  assert.equal((await run(brk(75, { isPaid: async () => true }), { userId: 'u1' })).res.code, 429);
});

test('breaker: the spend lookup is cached for a minute (one query, not one per request)', async () => {
  let calls = 0, t = 1_000_000_000_000;
  const d = deps({ now: () => t, llmSpendUsd: async () => { calls++; return 1; } });
  const cache = { at: 0, usd: 0, has: false };
  const mw = llmSpendBreaker({ deps: d, env: ENV, cache });
  await run(mw, { userId: 'u1' }); await run(mw, { userId: 'u1' }); await run(mw, { userId: 'u2' });
  assert.equal(calls, 1);
  t += 61_000;
  await run(mw, { userId: 'u1' });
  assert.equal(calls, 2);
});

test('breaker: too many rows to total up (Infinity) is "unknown": fail open for everyone, not a block', async () => {
  assert.equal((await run(brk(Number.POSITIVE_INFINITY), { userId: 'u1' })).nexted, true);
  assert.equal((await run(brk(Number.POSITIVE_INFINITY, { isPaid: async () => true }), { userId: 'u1' })).nexted, true);
});

test('breaker: a failing lookup is remembered as unknown for a minute (no re-query per request), then retried', async () => {
  let calls = 0, t = 1_000_000_000_000;
  const d = deps({ now: () => t, llmSpendUsd: async () => { calls++; throw new Error('db down'); } });
  const cache = { at: 0, usd: 0, has: false, inflight: null };
  const mw = llmSpendBreaker({ deps: d, env: ENV, cache });
  for (let i = 0; i < 5; i++) assert.equal((await run(mw, { userId: 'u' + i })).nexted, true, 'fails open');
  assert.equal(calls, 1);
  t += 61_000;
  assert.equal((await run(mw, { userId: 'u1' })).nexted, true);
  assert.equal(calls, 2, 'retried after the minute');
});

test('breaker: concurrent callers share one in-flight lookup (single flight)', async () => {
  let calls = 0, release;
  const gate = new Promise((r) => { release = r; });
  const d = deps({ llmSpendUsd: async () => { calls++; await gate; return 30; } });
  const mw = llmSpendBreaker({ deps: d, env: ENV, cache: { at: 0, usd: 0, has: false, inflight: null } });
  const pending = Array.from({ length: 10 }, (_, i) => run(mw, { userId: 'u' + i }));
  await new Promise((r) => setImmediate(r));
  release();
  const results = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.res.code === 429), 'all ten see the same verdict ($30 is over the soft level)');
});

test('breaker: tripped breaker answers before any per-user count or usage write', async () => {
  const rec = [];
  const d = deps({ llmSpendUsd: async () => 99, recordUsage: async (...a) => rec.push(a), countUsage: async () => { throw new Error('should not be asked'); } });
  const { res } = await run(featureDailyCap('create', { deps: d, window: new SlidingWindow(), env: ENV, cache: { at: 0, usd: 0, has: false } }), { userId: 'u1' });
  assert.equal(res.body.code, 'GLOBAL_DAILY_BUDGET_REACHED');
  assert.deepEqual(rec, []);
});

test('checkUsageLimits runs the global breaker first, then the daily limiter', async () => {
  const order = [];
  const mw = checkUsageLimits('summary', { breaker: (q, r, n) => { order.push('breaker'); n(); }, dailyLimiter: (q, r, n) => { order.push('daily'); n(); } });
  await run(mw, { userId: 'u1' });
  assert.deepEqual(order, ['breaker', 'daily']);
  const stop = checkUsageLimits('summary', { breaker: (q, r) => r.status(429).json({ code: 'GLOBAL_DAILY_BUDGET_REACHED' }), dailyLimiter: () => { throw new Error('must not run'); } });
  assert.equal((await run(stop, { userId: 'u1' })).res.code, 429);
});

// ---- background formatting ---------------------------------------------------------------------------------------------
test('auto-format: allowed under the cap (and counted), skipped silently over the cap or when the breaker is tripped', async () => {
  const nocache = () => ({ at: 0, usd: 0, has: false });
  const rec = [];
  assert.equal(await admitAutoFormatting('u1', { deps: deps({ recordUsage: async (...a) => rec.push(a) }), window: new SlidingWindow(), env: ENV, cache: nocache() }), true);
  assert.deepEqual(rec.map((r) => r[1]), ['formatting']);
  assert.equal(await admitAutoFormatting('u1', { deps: deps({ countUsage: async () => 20 }), window: new SlidingWindow(), env: ENV, cache: nocache() }), false);
  assert.equal(await admitAutoFormatting('u1', { deps: deps({ llmSpendUsd: async () => 99 }), window: new SlidingWindow(), env: ENV, cache: nocache() }), false);
});
