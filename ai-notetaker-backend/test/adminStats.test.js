const test = require('node:test');
const assert = require('node:assert/strict');
const { bucketByDay, countBy, subscriptionSummary, buildFunnel, attentionItems, loadStats } = require('../src/services/adminStats');

const NOW = Date.parse('2026-10-10T12:00:00Z');
const dayAgo = (d, h = 0) => new Date(NOW - d * 86_400_000 - h * 3_600_000).toISOString();

test('bucketByDay is zero-filled, oldest first, ends today, and ignores rows outside the window or with bad dates', () => {
  const out = bucketByDay([{ t: dayAgo(0) }, { t: dayAgo(0, 1) }, { t: dayAgo(2) }, { t: dayAgo(40) }, { t: 'garbage' }], 't', 5, NOW);
  assert.deepEqual(out.map((x) => x.d), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  assert.deepEqual(out.map((x) => x.v), [0, 0, 1, 0, 2]);
});

test('countBy sorts descending and names missing values "unknown"', () => {
  assert.deepEqual(countBy([{ s: 'a' }, { s: 'b' }, { s: 'b' }, { s: null }, {}], 's'), [{ name: 'b', n: 2 }, { name: 'a', n: 1 }, { name: 'unknown', n: 2 }].sort((x, y) => y.n - x.n));
});

test('subscriptionSummary separates paying, trialing and expired, and does not count a lapsed period as active', () => {
  const future = new Date(NOW + 86_400_000).toISOString(); const past = new Date(NOW - 86_400_000).toISOString();
  const subs = [
    { status: 'active', is_trial: false, platform: 'ios', current_period_end: future, created_at: dayAgo(3) },
    { status: 'active', is_trial: true, platform: 'ios', current_period_end: future, created_at: dayAgo(1) },
    { status: 'active', is_trial: false, platform: 'android', current_period_end: past, created_at: dayAgo(60) }, // lapsed though marked active
    { status: 'expired', is_trial: false, platform: 'ios', current_period_end: past, created_at: dayAgo(90) },
  ];
  const s = subscriptionSummary(subs, NOW);
  assert.deepEqual([s.activePaid, s.activeTrials, s.expired, s.startedLast30d], [1, 1, 2, 2]);
  assert.deepEqual(s.byPlatform, [{ name: 'ios', n: 2 }]);
});

test('buildFunnel keeps each step as a share of signups and survives zero signups', () => {
  const f = buildFunnel({ signups: 200, noteUsers: 50, aiUsers: 20, everSubscribed: 10, payingNow: 2 });
  assert.deepEqual(f.map((s) => s.pct), [100, 25, 10, 5, 1]);
  assert.equal(buildFunnel({ signups: 0, noteUsers: 0, aiUsers: 0, everSubscribed: 0, payingNow: 0 })[1].pct, null);
});

test('attentionItems flags a down provider, a high recording failure rate and a signup drop, and stays quiet otherwise', () => {
  const calm = attentionItems({ recordings: { last7d: 40, failed7d: 2, failedRate7d: 0.05 }, llm: { status: 'ok' }, signupsByDay: Array.from({ length: 10 }, () => ({ v: 3 })) });
  assert.deepEqual(calm, []);
  const noisy = attentionItems({ recordings: { last7d: 40, failed7d: 20, failedRate7d: 0.5 }, llm: { status: 'down', statusReason: 'x' }, signupsByDay: [...Array.from({ length: 7 }, () => ({ v: 4 })), { v: 0 }, { v: 0 }, { v: 0 }] });
  assert.equal(noisy.length, 3); assert.equal(noisy[0].level, 'down');
  assert.deepEqual(attentionItems({ recordings: { last7d: 5, failed7d: 5, failedRate7d: 1 }, llm: null, signupsByDay: [] }), [], 'too few recordings to judge');
});

test('loadStats joins AI content to its note owner, so AI users are people and not notes', async () => {
  const tables = {
    users: [{ id: 'u1', created_at: dayAgo(1) }, { id: 'u2', created_at: dayAgo(2) }, { id: 'u3', created_at: dayAgo(50) }],
    notes: [{ id: 'n1', user_id: 'u1', source_type: 'pdf', created_at: dayAgo(1) }, { id: 'n2', user_id: 'u2', source_type: 'video', created_at: dayAgo(3) }],
    recordings: [{ user_id: 'u1', status: 'completed', duration: 3600, created_at: dayAgo(1) }, { user_id: 'u2', status: 'failed', duration: 0, created_at: dayAgo(2) }],
    ai_content: [{ note_id: 'n1', content_type: 'summary', created_at: dayAgo(1) }, { note_id: 'n1', content_type: 'quiz', created_at: dayAgo(1) }],
    subscriptions: [{ user_id: 'u1', status: 'active', platform: 'ios', is_trial: false, current_period_end: new Date(NOW + 86_400_000).toISOString(), created_at: dayAgo(5) }],
  };
  const db = { from: (t) => ({ select: () => ({ range: async (a, b) => ({ data: tables[t].slice(a, b + 1), error: null }) }) }) };
  const s = await loadStats({ db, days: 30, now: NOW });
  assert.equal(s.users.total, 3); assert.equal(s.users.new7d, 2); assert.equal(s.users.new30d, 2);
  assert.deepEqual(s.funnel.map((x) => x.n), [3, 2, 1, 1, 1]);
  assert.deepEqual(s.active, { d1: 1, d7: 2, d30: 2 });
  assert.equal(s.recordings.hoursOfAudio, 1); assert.equal(s.recordings.failed7d, 1);
  assert.equal(s.ai.byType.length, 2);
});

test('loadStats pages through tables of more than one page', async () => {
  const many = Array.from({ length: 2300 }, (_, i) => ({ id: `u${i}`, created_at: dayAgo(1) }));
  const db = { from: (t) => ({ select: () => ({ range: async (a, b) => ({ data: (t === 'users' ? many : []).slice(a, b + 1), error: null }) }) }) };
  assert.equal((await loadStats({ db, days: 7, now: NOW })).users.total, 2300);
});

test('a database error surfaces with the table name instead of returning partial numbers', async () => {
  const db = { from: (t) => ({ select: () => ({ range: async () => (t === 'notes' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }) }) }) };
  await assert.rejects(() => loadStats({ db, days: 7, now: NOW }), /notes: boom/);
});
