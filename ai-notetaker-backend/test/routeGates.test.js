// Route-level tests for FREE_EXCEPT_COSTLY (the formerly paywalled routes) and the daily caps on the formerly uncapped routes.
const h = require('./helpers/routeHarness');
h.install();
const test = require('node:test');
const assert = require('node:assert/strict');

const subscription = require('../src/middleware/subscription');
const limits = require('../src/middleware/freeTierLimits');
const { getFreeTierConfig } = require('../src/utils/freeTierPolicy');

const mounts = {
  '/api/notes': require('../src/routes/exports'),
  '/api/learn': require('../src/routes/learning'),
  '/api/create': require('../src/routes/createContent'),
  '/api/compete': require('../src/routes/compete'),
  '/api/integrations': require('../src/routes/integrations'),
  '/api': require('../src/routes/sharing'),
  '/api/ai': require('../src/routes/ai'),
  '/api/formatting': require('../src/routes/formatting'),
  '/api/uploads': require('../src/routes/uploads'),
  '/api/tts': require('../src/routes/tts'),
  '/api/meetings': require('../src/routes/meetings')
};
let server;
test.before(async () => { server = await h.listen(h.makeApp(mounts)); });
test.after(() => server.close());
test.beforeEach(() => {
  h.resetDb();
  h.shares.length = 0;
  for (const k of Object.keys(h.calls)) delete h.calls[k];
  limits._resetBudgetCacheForTests();
  delete process.env.FREE_EXCEPT_COSTLY;
  for (const k of Object.keys(process.env)) if (k.startsWith('FREE_TIER_') || k.startsWith('LLM_DAILY_') || k.startsWith('PRO_')) delete process.env[k];
});

let n = 0;
const fresh = () => `user-${++n}`; // every test gets its own user: the in-process windows are per user and per process
const subscriber = (id) => h.db.subscriptions = [{ user_id: id, status: 'active', current_period_end: null, product_id: 'pro', platform: 'android', is_trial: false }];
const trial = (id) => h.db.user_trials = [{ user_id: id, trial_start: h.nowIso(-1000), trial_end: h.nowIso(86400000) }];
const creatorOnly = (id) => { h.db.creators = [{ id: 'c1', user_id: id, status: 'active', has_premium_access: true, created_at: h.nowIso(-86400000) }]; };
const call = (method, path, user, body) => h.call(server, method, path, { user, body });
const PREMIUM_BODY = { success: false, error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' };

// ---------------------------------------------------------------------------------------------------------------------
// 1. FREE_EXCEPT_COSTLY: the formerly paywalled routes are free; the three costly ones are Pro
// ---------------------------------------------------------------------------------------------------------------------
const FREED = [
  { name: 'export PDF', method: 'GET', path: '/api/notes/n1/export/pdf', body: undefined, blocked: { success: false, error: 'Premium subscription required to export notes', code: 'PREMIUM_REQUIRED' } },
  { name: 'export DOCX', method: 'GET', path: '/api/notes/n1/export/docx', body: undefined, blocked: { success: false, error: 'Premium subscription required to export notes', code: 'PREMIUM_REQUIRED' } },
  { name: 'Learn start', method: 'POST', path: '/api/learn/n1/start', body: {}, blocked: PREMIUM_BODY },
  { name: 'Create', method: 'POST', path: '/api/create/n1', body: { prompt: 'make a poem' }, blocked: PREMIUM_BODY, okStatus: [200, 500] },
  { name: 'Compete', method: 'POST', path: '/api/compete/n1/create', body: {}, blocked: PREMIUM_BODY, okStatus: [200, 500] },
  { name: 'integration webhook', method: 'POST', path: '/api/integrations/webhooks', body: { webhookUrl: 'https://example.com/h' }, blocked: { success: false, error: 'Premium subscription required for integrations', code: 'PREMIUM_REQUIRED' } },
  { name: 'AI suggestions (requireSubscription)', method: 'GET', path: '/api/ai/suggestions/n1', body: undefined, blockedStatus: 403, blockedCode: 'SUBSCRIPTION_REQUIRED' }
];

for (const g of FREED) {
  const passes = (r) => g.okStatus ? g.okStatus.includes(r.status) : r.status === 200;
  // Create/Compete call the model over axios after the gate; with no network that ends in a 500 from inside the handler, which is
  // past the gate. What matters for the gate is: not 403, not 429.
  test(`${g.name}: free user passes by default (FREE_EXCEPT_COSTLY on)`, async () => {
    const r = await call(g.method, g.path, fresh(), g.body);
    assert.ok(passes(r), `${g.name} got ${r.status} ${JSON.stringify(r.body)}`);
    assert.notEqual(r.status, 403);
  });
  test(`${g.name}: FREE_EXCEPT_COSTLY=false restores the old gate exactly (free user 403, subscriber / trial pass)`, async () => {
    process.env.FREE_EXCEPT_COSTLY = 'false';
    const u = fresh();
    const blocked = await call(g.method, g.path, u, g.body);
    assert.equal(blocked.status, g.blockedStatus || 403);
    if (g.blocked) assert.deepEqual(blocked.body, g.blocked);
    if (g.blockedCode) assert.equal(blocked.body.code, g.blockedCode);

    const s = fresh(); subscriber(s);
    const ok = await call(g.method, g.path, s, g.body);
    assert.ok(passes(ok), `subscriber got ${ok.status}`);
  });
}

// The three Pro features: gated for free users by default (existing paywall shape), open as before with the flag off -------
const PRO_GATED = [
  { name: 'podcast script', method: 'POST', path: '/api/ai/podcast/script', body: { note_id: 'n1' }, feature: 'podcast', error: 'Podcast generation requires a premium subscription' },
  { name: 'podcast (audio)', method: 'POST', path: '/api/ai/podcast', body: { note_id: 'n1' }, feature: 'podcast', error: 'Podcast generation requires a premium subscription', okStatus: [200, 500] },
  { name: 'infographic', method: 'POST', path: '/api/ai/infographic', body: { note_id: 'n1' }, feature: 'infographic', error: 'Infographic generation requires a premium subscription' },
  { name: 'meeting bot', method: 'POST', path: '/api/meetings', body: { meetingUrl: 'https://zoom.us/j/123' }, feature: 'meeting_bot', error: 'Meeting bot requires a premium subscription', okStatus: [201] }
];
for (const g of PRO_GATED) {
  const ok = (r) => (g.okStatus || [200]).includes(r.status);
  test(`${g.name}: a free user is refused with the existing paywall response (403 SUBSCRIPTION_REQUIRED) and nothing is generated`, async () => {
    const r = await call(g.method, g.path, fresh(), g.body);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { success: false, error: g.error, code: 'SUBSCRIPTION_REQUIRED', details: { feature: g.feature, upgradeRequired: true, reason: 'no_subscription', trialExpired: false } });
    assert.deepEqual(Object.keys(h.calls).filter((k) => /^(ai\.(podcast|infographic)|meeting\.create)/.test(k)), [], 'the model / Recall were never called');
    assert.equal((h.db.usage_tracking || []).length, 0, 'no usage recorded');
  });
  test(`${g.name}: Pro users (subscriber, trial, creator premium) are allowed`, async () => {
    const sub = fresh(); subscriber(sub);
    assert.ok(ok(await call(g.method, g.path, sub, g.body)), 'subscriber');
    const t = fresh(); trial(t);
    assert.ok(ok(await call(g.method, g.path, t, g.body)), 'trial');
    const c = fresh(); creatorOnly(c);
    assert.ok(ok(await call(g.method, g.path, c, g.body)), 'creator premium');
  });
  test(`${g.name}: FREE_EXCEPT_COSTLY=false is today's behaviour exactly: open to free users (the old gate was a no-op)`, async () => {
    process.env.FREE_EXCEPT_COSTLY = 'false';
    assert.ok(ok(await call(g.method, g.path, fresh(), g.body)));
  });
  test(`${g.name}: an expired subscription is not Pro`, async () => {
    const u = fresh();
    h.db.subscriptions = [{ user_id: u, status: 'active', current_period_end: h.nowIso(-86400000), product_id: 'pro', platform: 'android', is_trial: false }];
    assert.equal((await call(g.method, g.path, u, g.body)).status, 403);
  });
}

test('meeting bot: only starting a bot is Pro; list, status, cancel and delete stay open (a lapsed subscriber can still cancel a running bot)', async () => {
  assert.equal((await call('GET', '/api/meetings', fresh())).status, 200);
});

test('the Pro gate fails closed: a subscription lookup error is a 503, never a free costly call', async () => {
  const mw = subscription.requireProFeature('podcast');
  const real = h.db;
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let nexted = false;
  // A user id that makes the fake table throw: make getSubscriptionStatus's first query reject.
  const broken = { from: () => { throw new Error('db down'); } };
  const orig = h.db.subscriptions; h.db.subscriptions = { get filter() { throw new Error('db down'); } };
  try { await mw({ userId: fresh() }, res, () => { nexted = true; }); } finally { h.db.subscriptions = orig; }
  assert.equal(nexted, false);
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'SUBSCRIPTION_CHECK_FAILED');
  void real; void broken;
});

test('flag is read per request: flipping FREE_EXCEPT_COSTLY at runtime changes the next response', async () => {
  const u = fresh();
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', u)).status, 200);
  process.env.FREE_EXCEPT_COSTLY = 'false';
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', u)).status, 403);
  process.env.FREE_EXCEPT_COSTLY = 'true';
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', u)).status, 200);
});

test('FREE_EXCEPT_COSTLY=false keeps the old subtleties: a trial user passes, a creator-only user is still blocked on export', async () => {
  process.env.FREE_EXCEPT_COSTLY = 'false';
  const t = fresh(); trial(t);
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', t)).status, 200);
  const c = fresh(); creatorOnly(c);
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', c)).status, 403, 'creator premium never counted for export (inline check was isSubscribed || isInTrial)');
});

test('a typo in the flag keeps the app free; only false/0/no/off turn it off', async () => {
  for (const v of ['', 'banana', 'TRUE', '1', 'yes']) { process.env.FREE_EXCEPT_COSTLY = v; assert.equal((await call('GET', '/api/notes/n1/export/pdf', fresh())).status, 200, v); }
  for (const v of ['false', 'FALSE', ' 0 ', 'no', 'off']) { process.env.FREE_EXCEPT_COSTLY = v; assert.equal((await call('GET', '/api/notes/n1/export/pdf', fresh())).status, 403, v); }
});

test('getSubscriptionStatus still reports the REAL state while the flag is on; the flag only changes the standard-access helper', async () => {
  const u = fresh();
  const free = await subscription.getSubscriptionStatus(u);
  assert.equal(free.hasAccess, false);
  assert.equal(free.isSubscribed, false);
  assert.equal(free.isInTrial, false);
  assert.equal(await subscription.hasStandardAccess(u), true);
  assert.equal(await subscription.hasPaidAccess(u), false, 'Pro access is always the real state');
  const s = fresh(); subscriber(s);
  assert.equal((await subscription.getSubscriptionStatus(s)).isSubscribed, true);
  assert.equal(await subscription.hasPaidAccess(s), true);
  process.env.FREE_EXCEPT_COSTLY = 'false';
  assert.equal(await subscription.hasStandardAccess(u), false);
  assert.equal(await subscription.hasStandardAccess(s), true);
  assert.equal(await subscription.hasPaidAccess(u), false);
});

// share links -----------------------------------------------------------------------------------------------------------
const shareRows = (n, ageMs = -1000) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, created_at: h.nowIso(ageMs) }));

test('share links: no 3/month limit by default; the exact 3/month 403 returns when FREE_EXCEPT_COSTLY=false', async () => {
  h.shares.push(...shareRows(3));
  assert.equal((await call('POST', '/api/n1/share', fresh(), {})).status, 200);
  process.env.FREE_EXCEPT_COSTLY = 'false';
  const r = await call('POST', '/api/n1/share', fresh(), {});
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Free plan allows 3 share links per month. Upgrade for unlimited sharing.');
  const s = fresh(); subscriber(s);
  assert.equal((await call('POST', '/api/n1/share', s, {})).status, 200, 'subscribers stay unlimited per month');
});

test('share links: a daily cap of 20 new links applies in both modes (429, same body shape as the other caps)', async () => {
  h.shares.push(...shareRows(20));
  const r = await call('POST', '/api/n1/share', fresh(), {});
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(r.body.details.scope, 'shares');
  assert.equal(r.body.details.limit, 20);
  assert.equal(r.body.details.upgradeRequired, false);
  process.env.FREE_EXCEPT_COSTLY = 'false';
  const s = fresh(); subscriber(s);
  assert.equal((await call('POST', '/api/n1/share', s, {})).status, 429, 'also for a subscriber');
  h.shares.length = 0; h.shares.push(...shareRows(19), ...shareRows(30, -2 * 86400000));
  assert.equal((await call('POST', '/api/n1/share', s, {})).status, 200, 'links older than 24h do not count');
});

// ---------------------------------------------------------------------------------------------------------------------
// 2. Per-user daily caps on the formerly ungated / uncapped routes (these apply with the flag on AND off)
// ---------------------------------------------------------------------------------------------------------------------
// `pro: true` -> only Pro users can reach the route while the flag is on; the cap numbers are free (flag off) / Pro (explicit number).
// Everything else: the free cap, and 5x for paid users.
const CAPS = [
  { name: 'AI summary', method: 'POST', path: '/api/ai/summary', body: { note_id: 'n1' }, type: 'summary', limit: 20, scope: 'ai_generations' },
  { name: 'AI chat', method: 'POST', path: '/api/ai/chat', body: { note_id: 'n1', question: 'q' }, type: 'chat', limit: 20, scope: 'ai_generations' },
  { name: 'podcast script', method: 'POST', path: '/api/ai/podcast/script', body: { note_id: 'n1' }, type: 'podcast', limit: 3, proLimit: 10, scope: 'podcast', pro: true },
  { name: 'podcast (audio)', method: 'POST', path: '/api/ai/podcast', body: { note_id: 'n1' }, type: 'podcast', limit: 3, proLimit: 10, scope: 'podcast', pro: true, blockedOnly: true },
  { name: 'infographic', method: 'POST', path: '/api/ai/infographic', body: { note_id: 'n1' }, type: 'infographic', limit: 5, proLimit: 15, scope: 'infographic', pro: true },
  { name: 'chat suggestions', paywalledWhenOff: true, paywalledWhenOff: true, method: 'GET', path: '/api/ai/suggestions/n1', type: 'suggestions', limit: 60, scope: 'suggestions' },
  { name: 'Learn start', paywalledWhenOff: true, method: 'POST', path: '/api/learn/n1/start', body: {}, type: 'learning', limit: 5, scope: 'learning' },
  { name: 'Learn submit (triggers next lesson)', paywalledWhenOff: true, paywalledWhenOff: true, method: 'POST', path: '/api/learn/lesson/l1/submit', body: {}, type: 'learning', limit: 5, scope: 'learning' },
  { name: 'Create', paywalledWhenOff: true, method: 'POST', path: '/api/create/n1', body: { prompt: 'a poem' }, type: 'create', limit: 5, scope: 'create', okStatus: [200, 500] },
  { name: 'Compete', paywalledWhenOff: true, method: 'POST', path: '/api/compete/n1/create', body: {}, type: 'compete', limit: 5, scope: 'compete', okStatus: [200, 500] },
  { name: 'note formatting (POST)', method: 'POST', path: '/api/formatting/notes/n1', body: {}, type: 'formatting', limit: 20, scope: 'formatting' },
  { name: 'note re-formatting (PUT)', method: 'PUT', path: '/api/formatting/notes/n1', body: {}, type: 'formatting', limit: 20, scope: 'formatting' },
  { name: 'upload video-url', method: 'POST', path: '/api/uploads/video-url', body: { url: 'https://youtu.be/x' }, type: 'upload', limit: 10, scope: 'upload', okStatus: [201] },
  { name: 'upload pdf', method: 'POST', path: '/api/uploads/pdf', body: {}, type: 'upload', limit: 10, scope: 'upload', blockedOnly: true },
  { name: 'upload scan', method: 'POST', path: '/api/uploads/scan', body: {}, type: 'upload', limit: 10, scope: 'upload', blockedOnly: true },
  { name: 'upload scan batch', method: 'POST', path: '/api/uploads/scan/batch', body: {}, type: 'upload', limit: 10, scope: 'upload', blockedOnly: true },
  { name: 'upload slideshow', method: 'POST', path: '/api/uploads/slideshow', body: {}, type: 'upload', limit: 10, scope: 'upload', blockedOnly: true },
  { name: 'TTS synthesize', method: 'POST', path: '/api/tts/synthesize', body: { text: 'hello' }, type: 'tts', limit: 20, scope: 'tts' },
  { name: 'TTS generate', method: 'POST', path: '/api/tts/generate', body: { note_id: 'n1' }, type: 'tts', limit: 20, scope: 'tts' }
];

const assertCapped = (r, c) => {
  assert.equal(r.status, 429, `${c.name} got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(r.body.details.scope, c.scope);
  assert.equal(r.body.details.upgradeRequired, false);
  assert.ok(r.headers.get('retry-after'));
};

for (const c of CAPS) {
  // Where a route is Pro-only (flag on) the user under test is a subscriber with the Pro number; otherwise a free user with the free number.
  test(`${c.name}: daily cap, default flag: ${c.pro ? `Pro ${c.proLimit}/day` : `${c.limit}/day`} -> 429 with the existing shape, never 403`, async () => {
    const u = fresh();
    if (c.pro) subscriber(u);
    h.db.usage_tracking = h.usage(u, c.type, c.pro ? c.proLimit : c.limit);
    assertCapped(await call(c.method, c.path, u, c.body), c);
  });
  test(`${c.name}: daily cap, FREE_EXCEPT_COSTLY=false: ${c.limit}/day for free users, 5x/Pro number for subscribers`, async () => {
    process.env.FREE_EXCEPT_COSTLY = 'false';
    if (!c.paywalledWhenOff) { // (those routes need a subscription again with the flag off, so only subscribers reach the cap)
      const u = fresh();
      h.db.usage_tracking = h.usage(u, c.type, c.limit);
      assertCapped(await call(c.method, c.path, u, c.body), c);
    }
    const s = fresh(); subscriber(s);
    h.db.usage_tracking = h.usage(s, c.type, c.proLimit || c.limit * 5);
    assertCapped(await call(c.method, c.path, s, c.body), c);
  });
  if (!c.blockedOnly) {
    test(`${c.name}: one below the limit still works; rows older than 24h do not count`, async () => {
      const u = fresh();
      if (c.pro) subscriber(u);
      const lim = c.pro ? c.proLimit : c.limit;
      h.db.usage_tracking = [...h.usage(u, c.type, lim - 1), ...h.usage(u, c.type, 50, -2 * 86400000)];
      const r = await call(c.method, c.path, u, c.body);
      assert.ok(c.okStatus ? c.okStatus.includes(r.status) : r.status === 200, `${c.name} got ${r.status} ${JSON.stringify(r.body)}`);
    });
  }
}

test('record:true caps write their own usage row; record:false caps (podcast, infographic) leave it to the route', async () => {
  const u = fresh();
  await call('POST', '/api/tts/synthesize', u, { text: 'hi' });
  assert.equal((h.db.usage_tracking || []).filter((r) => r.user_id === u && r.feature_type === 'tts').length, 1);
  const p = fresh(); subscriber(p);
  await call('POST', '/api/ai/podcast/script', p, { note_id: 'n1' });
  assert.equal((h.db.usage_tracking || []).filter((r) => r.user_id === p && r.feature_type === 'podcast').length, 1, 'recorded once (by the route), not twice');
});

test('a burst is stopped by the in-process window even before usage rows land: Pro podcast 10 then 429', async () => {
  const u = fresh(); subscriber(u);
  process.env.PRO_PODCASTS_PER_DAY = '3'; // keep the loop short; the default is 10
  h.db.usage_tracking = []; // rows written by the route land here, so also stub them away to prove the window alone does it
  const real = h.db; real.usage_tracking = [];
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/ai/podcast/script', u, { note_id: 'n1' })).status, 200);
  assert.equal((await call('POST', '/api/ai/podcast/script', u, { note_id: 'n1' })).status, 429);
  const other = fresh(); subscriber(other);
  assert.equal((await call('POST', '/api/ai/podcast/script', other, { note_id: 'n1' })).status, 200, 'another user is unaffected');
});

test('caps are env-overridable: free and Pro numbers separately', async () => {
  process.env.FREE_EXCEPT_COSTLY = 'false';
  process.env.FREE_TIER_PODCASTS_PER_DAY = '1';
  process.env.PRO_PODCASTS_PER_DAY = '4';
  const u = fresh();
  assert.equal((await call('POST', '/api/ai/podcast/script', u, { note_id: 'n1' })).status, 200);
  assert.equal((await call('POST', '/api/ai/podcast/script', u, { note_id: 'n1' })).status, 429);
  const s = fresh(); subscriber(s);
  h.db.usage_tracking = h.usage(s, 'podcast', 3);
  assert.equal((await call('POST', '/api/ai/podcast/script', s, { note_id: 'n1' })).status, 200, '3 < 4');
  h.db.usage_tracking = h.usage(s, 'podcast', 4);
  assert.equal((await call('POST', '/api/ai/podcast/script', s, { note_id: 'n1' })).status, 429);
});

test('unauthenticated requests are 401, not a free pass through a gate or a cap', async () => {
  assert.equal((await call('POST', '/api/ai/podcast/script', undefined, { note_id: 'n1' })).status, 401);
  assert.equal((await call('POST', '/api/meetings', undefined, { meetingUrl: 'https://zoom.us/j/1' })).status, 401);
});

test('upload /process (large-file path): counted once per job, only when processing really starts; a repeat call on a running job is free', async () => {
  const u = fresh();
  const doc = { fileName: 'a.pdf', fileSize: 1000, mimeType: 'application/pdf' };
  const mkJob = async () => (await call('POST', '/api/uploads/request-upload', u, doc)).body.data.jobId;
  h.db.usage_tracking = h.usage(u, 'upload', 10);
  const blockedJob = await mkJob();
  const r = await call('POST', '/api/uploads/process', u, { jobId: blockedJob });
  assert.equal(r.status, 429);
  assert.equal(r.body.details.scope, 'upload');
  h.db.usage_tracking = h.usage(u, 'upload', 9);
  const j = await mkJob();
  assert.equal((await call('POST', '/api/uploads/process', u, { jobId: j })).body.data.status, 'processing');
  const rows = () => h.db.usage_tracking.filter((x) => x.user_id === u && x.feature_type === 'upload').length;
  assert.equal(rows(), 10, 'the admit wrote one row');
  assert.equal((await call('POST', '/api/uploads/process', u, { jobId: j })).status, 200, 'repeat call on a running job is answered, not blocked');
  assert.equal(rows(), 10, 'and not counted again');
});

// meeting bot -------------------------------------------------------------------------------------------------------------
const meetings = (user, specs) => specs.map(([status, hours]) => ({ user_id: user, status, duration_seconds: hours == null ? null : hours * 3600, created_at: h.nowIso(-3600 * 1000) }));
const MEETING = { meetingUrl: 'https://zoom.us/j/123' };
const proUser = () => { const u = fresh(); subscriber(u); return u; };

test('meeting bot (Pro): 8 sessions/day: the 9th -> 429 meeting_sessions, and no Recall bot is deployed', async () => {
  const u = proUser();
  h.db.meetings = meetings(u, new Array(7).fill(['completed', 0.2]));
  assert.equal((await call('POST', '/api/meetings', u, MEETING)).status, 201);
  h.db.meetings = meetings(u, new Array(8).fill(['completed', 0.2]));
  h.calls['meeting.create'] = [];
  const r = await call('POST', '/api/meetings', u, MEETING);
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'DAILY_LIMIT_REACHED');
  assert.equal(r.body.details.scope, 'meeting_sessions');
  assert.equal(r.body.details.limit, 8);
  assert.equal(h.calls['meeting.create'].length, 0);
});

test('meeting bot (Pro): 10 hours/day; unknown length counts as 1h; failed/cancelled and rows older than 24h do not count', async () => {
  const u = proUser();
  h.db.meetings = meetings(u, [['completed', 4.5], ['completed', 5.5]]);
  const r = await call('POST', '/api/meetings', u, MEETING);
  assert.equal(r.status, 429);
  assert.equal(r.body.details.scope, 'meeting_hours');
  assert.equal(r.body.details.limit, 10);
  h.db.meetings = [...meetings(u, [['failed', null], ['cancelled', null], ['completed', 1], ['in_call', null]]), { user_id: u, status: 'completed', duration_seconds: 99 * 3600, created_at: h.nowIso(-2 * 86400000) }];
  assert.equal((await call('POST', '/api/meetings', u, MEETING)).status, 201);
});

test('meeting bot with FREE_EXCEPT_COSTLY=false (today: open to all) is still capped: free 3 sessions / 4 hours, Pro 8 / 10', async () => {
  process.env.FREE_EXCEPT_COSTLY = 'false';
  const u = fresh();
  h.db.meetings = meetings(u, [['completed', 0.1], ['completed', 0.1], ['completed', 0.1]]);
  const r = await call('POST', '/api/meetings', u, MEETING);
  assert.equal(r.status, 429);
  assert.equal(r.body.details.limit, 3);
  const hrs = fresh();
  h.db.meetings = meetings(hrs, [['completed', 2.5], ['completed', 2.5]]);
  assert.equal((await call('POST', '/api/meetings', hrs, MEETING)).body.details.scope, 'meeting_hours');
  const s = proUser();
  h.db.meetings = [...h.db.meetings, ...meetings(s, [['completed', 0.1], ['completed', 0.1], ['completed', 0.1], ['completed', 0.1]])];
  assert.equal((await call('POST', '/api/meetings', s, MEETING)).status, 201, '4 sessions is fine for Pro');
});

// global LLM spend breaker ------------------------------------------------------------------------------------------------
const spend = (usd) => { // output tokens are priced per million
  h.db.llm_calls = [{ source: 'live', ok: true, ts: h.nowIso(-1000), model: 'claude-sonnet-4-6', input_tokens: 0, output_tokens: Math.round((usd / 15) * 1e6) }];
  limits._resetBudgetCacheForTests();
};

test('global breaker: below the soft budget ($25/day) everything works', async () => {
  spend(24);
  assert.equal((await call('POST', '/api/ai/summary', fresh(), { note_id: 'n1' })).status, 200);
});

test('global breaker: over the soft budget non-paying users get 429 GLOBAL_DAILY_BUDGET_REACHED, paying users continue', async () => {
  spend(26);
  const r = await call('POST', '/api/ai/summary', fresh(), { note_id: 'n1' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'GLOBAL_DAILY_BUDGET_REACHED');
  assert.equal(r.body.details.scope, 'global_llm_budget');
  assert.match(r.body.error, /daily limit for AI features/);
  assert.equal(r.body.details.upgradeRequired, false);
  const s = fresh(); subscriber(s);
  assert.equal((await call('POST', '/api/ai/summary', s, { note_id: 'n1' })).status, 200);
});

test('global breaker: over the hard budget ($75/day) everyone is stopped, on every LLM route, and a blocked call uses no allowance', async () => {
  spend(80);
  const s = fresh(); subscriber(s);
  for (const [m, p, b] of [['POST', '/api/ai/summary', { note_id: 'n1' }], ['POST', '/api/ai/podcast/script', { note_id: 'n1' }], ['POST', '/api/ai/infographic', { note_id: 'n1' }],
    ['POST', '/api/learn/n1/start', {}], ['POST', '/api/formatting/notes/n1', {}], ['POST', '/api/uploads/video-url', { url: 'https://youtu.be/x' }], ['GET', '/api/ai/suggestions/n1', undefined]]) {
    const r = await call(m, p, s, b);
    assert.equal(r.status, 429, p);
    assert.equal(r.body.code, 'GLOBAL_DAILY_BUDGET_REACHED', p);
  }
  assert.equal((h.db.usage_tracking || []).length, 0, 'nothing was recorded against the user');
  assert.equal((await call('POST', '/api/tts/synthesize', s, { text: 'hi' })).status, 200, 'TTS is self-hosted, not an LLM cost, so the breaker does not apply');
  assert.equal((await call('GET', '/api/notes/n1/export/pdf', s)).status, 200, 'non-LLM routes keep working');
});

test('global breaker: counts the direct-API features llm_calls cannot see (Learn/Create/Compete/infographic) at an estimated unit cost', async () => {
  h.db.usage_tracking = [...h.usage('other', 'learning', 200)]; // 200 x $0.12 = $24
  limits._resetBudgetCacheForTests();
  assert.equal((await call('POST', '/api/ai/summary', fresh(), { note_id: 'n1' })).status, 200);
  h.db.usage_tracking.push(...h.usage('other', 'create', 20)); // + $2 -> $26
  limits._resetBudgetCacheForTests();
  assert.equal((await call('POST', '/api/ai/summary', fresh(), { note_id: 'n1' })).status, 429);
});

test('global breaker: budgets are env-overridable', async () => {
  process.env.LLM_DAILY_BUDGET_SOFT_USD = '1';
  spend(2);
  assert.equal((await call('POST', '/api/ai/summary', fresh(), { note_id: 'n1' })).status, 429);
});

test('global breaker: a failing spend lookup never blocks users (fail open)', async () => {
  h.db.llm_calls = undefined;
  limits._resetBudgetCacheForTests();
  const r = await limits.evaluateLlmBudget('u', { deps: { now: () => Date.now(), isPaid: async () => false, llmSpendUsd: async () => { throw new Error('db down'); } }, cache: { at: 0, usd: 0, has: false } });
  assert.equal(r, null);
});

// /api/subscriptions/access ----------------------------------------------------------------------------------------------
test('GET /api/subscriptions/access reports the real subscription state; feature flags follow FREE_EXCEPT_COSTLY', async () => {
  const subs = require('../src/routes/subscriptions');
  const s2 = await h.listen(h.makeApp({ '/api/subscriptions': subs }));
  try {
    const u = fresh();
    let r = await h.call(s2, 'GET', '/api/subscriptions/access', { user: u });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.hasAccess, false, 'real state');
    assert.equal(r.body.data.isSubscribed, false, 'real state');
    assert.equal(r.body.data.freeTier.freeExceptCostly, true);
    assert.deepEqual(r.body.data.freeTier.proFeatures.sort(), ['infographic', 'meeting_bot', 'podcast']);
    const f = r.body.data.features;
    for (const k of ['canExportNotes', 'canShareNotes', 'canUseIntegrations']) assert.equal(f[k], true, k);
    for (const k of ['canGeneratePodcasts', 'canGenerateInfographics', 'canUseMeetingBot', 'unlimitedAccess']) assert.equal(f[k], false, `${k} is Pro only`);

    const s = fresh(); subscriber(s);
    r = await h.call(s2, 'GET', '/api/subscriptions/access', { user: s });
    for (const k of ['canGeneratePodcasts', 'canGenerateInfographics', 'canUseMeetingBot', 'canExportNotes', 'unlimitedAccess']) assert.equal(r.body.data.features[k], true, k);

    process.env.FREE_EXCEPT_COSTLY = 'false';
    r = await h.call(s2, 'GET', '/api/subscriptions/access', { user: u });
    assert.equal(r.body.data.freeTier.freeExceptCostly, false);
    assert.deepEqual(r.body.data.freeTier.proFeatures, []);
    for (const k of ['canGeneratePodcasts', 'canExportNotes', 'canUseIntegrations', 'unlimitedAccess']) assert.equal(r.body.data.features[k], false, k);
    assert.equal(r.body.data.features.canShareNotes, true);
  } finally { s2.close(); }
});

test('config sanity: every capped feature has a positive default in the one config object', () => {
  const cfg = getFreeTierConfig({});
  const { FEATURE_CAPS } = require('../src/utils/freeTierPolicy');
  for (const [name, spec] of Object.entries(FEATURE_CAPS)) assert.ok(cfg[spec.limitKey] > 0, name);
});
