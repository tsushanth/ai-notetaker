// Product usage numbers for the admin page: who is using ScribeAI and what they do. Reads aggregates only, never note text.
// The pure helpers take plain arrays so they can be tested without a database; loadStats() is the only part that does I/O.

const DAY = 86_400_000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Counts per UTC day for the last `days` days (oldest first, today included, zero-filled). */
function bucketByDay(items, key, days, now = Date.now(), weight = () => 1) {
  const out = new Map();
  for (let i = days - 1; i >= 0; i--) out.set(day(now - i * DAY), 0);
  for (const it of items) {
    const ts = Date.parse(it[key]);
    if (!Number.isFinite(ts)) continue;
    const d = day(ts);
    if (out.has(d)) out.set(d, out.get(d) + weight(it));
  }
  return [...out.entries()].map(([d, v]) => ({ d, v }));
}

/** { name: count } for a column, sorted descending. */
function countBy(items, key) {
  const m = {};
  for (const it of items) { const k = it[key] == null || it[key] === '' ? 'unknown' : String(it[key]); m[k] = (m[k] || 0) + 1; }
  return Object.entries(m).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

const since = (items, key, ms) => items.filter((i) => Date.parse(i[key]) >= ms);
const distinct = (items, key = 'user_id') => new Set(items.map((i) => i[key]).filter(Boolean));

/** Subscriptions: the table is the truth (users.subscription_tier is not maintained). */
function subscriptionSummary(subs, now = Date.now()) {
  const active = subs.filter((s) => s.status === 'active' && (!s.current_period_end || Date.parse(s.current_period_end) > now));
  const trials = active.filter((s) => s.is_trial);
  const paid = active.filter((s) => !s.is_trial);
  return {
    total: subs.length,
    activePaid: paid.length,
    activeTrials: trials.length,
    expired: subs.filter((s) => s.status === 'expired' || (s.current_period_end && Date.parse(s.current_period_end) <= now)).length,
    byPlatform: countBy(active, 'platform'),
    startedLast30d: since(subs, 'created_at', now - 30 * DAY).length,
  };
}

/** Signed up -> made a note -> generated AI content -> ever subscribed -> paying now. Each step is a count of distinct users. */
function buildFunnel({ signups, noteUsers, aiUsers, everSubscribed, payingNow }) {
  const steps = [
    ['Signed up', signups], ['Created a note', noteUsers], ['Generated AI content', aiUsers], ['Ever started a plan or trial', everSubscribed], ['Paying now', payingNow],
  ];
  return steps.map(([label, n]) => ({ label, n, pct: signups ? Math.round((1000 * n) / signups) / 10 : null }));
}

/** Plain-language items worth a look, newest concern first. Thresholds are deliberately conservative. */
function attentionItems({ recordings, llm, signupsByDay, now = Date.now() }) {
  const items = [];
  if (llm && (llm.status === 'down' || llm.status === 'degraded')) items.push({ level: llm.status === 'down' ? 'down' : 'warn', text: `LLM provider ${llm.status}: ${llm.statusReason}` });
  if (recordings && recordings.last7d >= 10 && recordings.failedRate7d >= 0.25) items.push({ level: 'warn', text: `${Math.round(recordings.failedRate7d * 100)}% of recordings failed in the last 7 days (${recordings.failed7d} of ${recordings.last7d})` });
  const recent = (signupsByDay || []).slice(-3).reduce((a, x) => a + x.v, 0);
  const prior = (signupsByDay || []).slice(-10, -3).reduce((a, x) => a + x.v, 0) / 7 * 3;
  if (prior >= 6 && recent < prior * 0.3) items.push({ level: 'warn', text: `Signups dropped: ${recent} in the last 3 days against about ${Math.round(prior)} expected` });
  return items;
}

async function fetchAll(db, table, columns, apply = (q) => q, { pageSize = 1000, maxRows = 30000 } = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await apply(db.from(table).select(columns)).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadStats({ db, days = 30, now = Date.now() }) {
  const [users, notes, recordings, aiContent, subs] = await Promise.all([
    fetchAll(db, 'users', 'id,created_at'),
    fetchAll(db, 'notes', 'id,user_id,source_type,created_at'),
    fetchAll(db, 'recordings', 'user_id,status,duration,created_at'),
    fetchAll(db, 'ai_content', 'note_id,content_type,created_at'),
    fetchAll(db, 'subscriptions', 'user_id,status,platform,is_trial,current_period_end,created_at'),
  ]);

  const noteOwner = new Map(notes.map((n) => [n.id, n.user_id]));
  const aiWithUser = aiContent.map((a) => ({ ...a, user_id: noteOwner.get(a.note_id) }));
  const t = (ms) => now - ms;
  const active = (ms) => new Set([...distinct(since(notes, 'created_at', t(ms))), ...distinct(since(recordings, 'created_at', t(ms))), ...distinct(since(aiWithUser, 'created_at', t(ms)))]);
  const subSummary = subscriptionSummary(subs, now);
  const payingUsers = distinct(subs.filter((s) => s.status === 'active' && !s.is_trial && (!s.current_period_end || Date.parse(s.current_period_end) > now)));

  const rec7 = since(recordings, 'created_at', t(7 * DAY));
  const rec7Failed = rec7.filter((r) => r.status === 'failed').length;
  const recWindow = since(recordings, 'created_at', now - days * DAY);
  const signupsByDay = bucketByDay(users, 'created_at', Math.min(days, 90), now);

  const recordingsOut = {
    total: recordings.length, failedTotal: recordings.filter((r) => r.status === 'failed').length,
    last7d: rec7.length, failed7d: rec7Failed, failedRate7d: rec7.length ? rec7Failed / rec7.length : 0,
    hoursOfAudio: Math.round((recWindow.reduce((a, r) => a + (Number(r.duration) || 0), 0) / 3600) * 10) / 10,
    byDay: bucketByDay(recordings, 'created_at', Math.min(days, 90), now),
  };

  return {
    generatedAt: new Date(now).toISOString(), days,
    users: { total: users.length, new24h: since(users, 'created_at', t(DAY)).length, new7d: since(users, 'created_at', t(7 * DAY)).length, new30d: since(users, 'created_at', now - 30 * DAY).length, signupsByDay },
    active: { d1: active(DAY).size, d7: active(7 * DAY).size, d30: active(30 * DAY).size },
    notes: { total: notes.length, window: since(notes, 'created_at', now - days * DAY).length, byDay: bucketByDay(notes, 'created_at', Math.min(days, 90), now), bySource: countBy(since(notes, 'created_at', now - days * DAY), 'source_type') },
    ai: { total: aiContent.length, window: since(aiContent, 'created_at', now - days * DAY).length, byType: countBy(since(aiContent, 'created_at', now - days * DAY), 'content_type'), byDay: bucketByDay(aiContent, 'created_at', Math.min(days, 90), now) },
    recordings: recordingsOut,
    subscriptions: subSummary,
    funnel: buildFunnel({ signups: users.length, noteUsers: distinct(notes).size, aiUsers: distinct(aiWithUser).size, everSubscribed: distinct(subs).size, payingNow: payingUsers.size }),
  };
}

module.exports = { loadStats, bucketByDay, countBy, subscriptionSummary, buildFunnel, attentionItems, fetchAll, distinct };
