/**
 * Abuse backstops for the free STT + AI generation features.
 *
 * - transcriptionGuard: runs before POST /api/recordings/transcribe
 * - aiDailyLimit(): runs in front of every AI generation route (via checkUsageLimits)
 * - featureDailyCap(feature): podcast, infographic, Learn, Create, Compete, formatting, uploads, TTS (FEATURE_CAPS)
 * - meetingBotGuard(): runs before POST /api/meetings (Recall.ai bot sessions and hours)
 * - llmSpendBreaker(): global rolling-24h LLM spend breaker (429 for everyone above a budget)
 *
 * Both count against a rolling 24 hours, using data that already exists (recordings, usage_tracking) plus an
 * in-process window as a second layer (catches retries and anything the tables miss; resets on restart and is per
 * machine). Over the limit -> HTTP 429 (never 403, so clients do not read it as a paywall) with a clear message.
 * A lookup that fails never blocks the user (fail open, logged): these are backstops, not the product gate.
 */
const { logger } = require('../utils/logger');
const {
  AI_FEATURE_TYPES, FEATURE_CAPS, UNINSTRUMENTED_UNIT_COST_USD, DAY_MS, getFreeTierConfig, effectiveLimit, isOverLimit
} = require('../utils/freeTierPolicy');

class SlidingWindow {
  constructor() { this.hits = new Map(); this.calls = 0; }
  prune(arr, now) { while (arr.length && now - arr[0] >= DAY_MS) arr.shift(); }
  /** Would one more hit stay within `limit`? Returns { allowed, retryAfterSec }. Does not record. */
  peek(key, limit, now = Date.now()) {
    const arr = this.hits.get(key) || [];
    this.prune(arr, now);
    if (arr.length < limit) return { allowed: true, used: arr.length };
    return { allowed: false, used: arr.length, retryAfterSec: Math.max(1, Math.ceil((arr[0] + DAY_MS - now) / 1000)) };
  }
  record(key, now = Date.now()) {
    const arr = this.hits.get(key) || [];
    this.prune(arr, now);
    arr.push(now);
    this.hits.set(key, arr);
    if (++this.calls % 500 === 0) this.sweep(now);
  }
  sweep(now = Date.now()) {
    for (const [k, arr] of this.hits) { this.prune(arr, now); if (!arr.length) this.hits.delete(k); }
  }
}

// One window per scope for the whole process, so every AI route shares the same per-user count.
const sharedAiWindow = new SlidingWindow();
const sharedSttWindow = new SlidingWindow();
const sharedFeatureWindows = new Map();
const featureWindow = (name) => {
  if (!sharedFeatureWindows.has(name)) sharedFeatureWindows.set(name, new SlidingWindow());
  return sharedFeatureWindows.get(name);
};
// Global spend lookups are cached for a minute so the breaker costs one query per minute per machine, not one per request.
const BUDGET_CACHE_MS = 60 * 1000;
const sharedBudgetCache = { at: 0, usd: 0, has: false, inflight: null };
const LLM_CALLS_PAGE = 1000;
const LLM_CALLS_MAX_PAGES = 20; // reading more than this many rows returns Infinity, which the breaker treats as unknown

function limitResponse(res, { scope, message, code = 'DAILY_LIMIT_REACHED', status = 429, limit, used, retryAfterSec }) {
  // Counted (first per scope per day emails, the rest only bump a counter): with a handful of users a limit hit is news.
  try { require('../utils/failureReporter').reportCounted('free_tier_limit', `Free-tier limit reached: ${String(scope)}`, { scope: String(scope), limit: String(limit), code: String(code) }); } catch { /* never block the response */ }
  if (retryAfterSec) res.set('Retry-After', String(retryAfterSec));
  return res.status(status).json({
    success: false,
    error: message,
    code,
    details: { scope, limit, used, retryAfterSeconds: retryAfterSec || null, upgradeRequired: false }
  });
}

const sinceIso = (now) => new Date(now - DAY_MS).toISOString();

/** Default dependencies: real Supabase. Required lazily so tests can inject fakes without any env. */
function defaultDeps() {
  const { supabaseAdmin } = require('../config/supabase');
  return {
    now: () => Date.now(),
    async isPaid(userId) {
      const { getSubscriptionStatus, isProStatus } = require('./subscription');
      return isProStatus(await getSubscriptionStatus(userId));
    },
    async countAiUsage(userId, since) {
      const { count, error } = await supabaseAdmin
        .from('usage_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('feature_type', AI_FEATURE_TYPES)
        .gte('created_at', since);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async countUsage(userId, types, since) {
      const { count, error } = await supabaseAdmin
        .from('usage_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('feature_type', types)
        .gte('created_at', since);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async recordUsage(userId, featureType, metadata) {
      const { recordUsage } = require('./subscription');
      return recordUsage(userId, featureType, metadata);
    },
    async recentMeetings(userId, since) {
      const { data, error } = await supabaseAdmin
        .from('meetings')
        .select('status, duration_seconds')
        .eq('user_id', userId)
        .gte('created_at', since)
        .limit(500);
      if (error) throw new Error(error.message);
      return data || [];
    },
    /** Estimated global LLM spend since `since`: llm_calls rows priced from tokens + per-call estimates for uninstrumented types. */
    async llmSpendUsd(since) {
      const { costOf } = require('../utils/llmUsage');
      let usd = 0;
      for (let page = 0; ; page++) {
        if (page >= LLM_CALLS_MAX_PAGES) return Number.POSITIVE_INFINITY;
        const { data, error } = await supabaseAdmin
          .from('llm_calls')
          .select('model, input_tokens, output_tokens')
          .eq('source', 'live')
          .eq('ok', true)
          .gte('ts', since)
          .order('ts', { ascending: true })
          .range(page * LLM_CALLS_PAGE, (page + 1) * LLM_CALLS_PAGE - 1);
        if (error) throw new Error(error.message);
        for (const r of data || []) usd += costOf(r.model, { input_tokens: r.input_tokens, output_tokens: r.output_tokens }).usd;
        if (!data || data.length < LLM_CALLS_PAGE) break;
      }
      for (const [type, unit] of Object.entries(UNINSTRUMENTED_UNIT_COST_USD)) {
        const { count, error } = await supabaseAdmin
          .from('usage_tracking')
          .select('*', { count: 'exact', head: true })
          .eq('feature_type', type)
          .gte('created_at', since);
        if (error) throw new Error(error.message);
        usd += (count || 0) * unit;
      }
      return usd;
    },
    async getRecording(userId, recordingId) {
      const { data, error } = await supabaseAdmin
        .from('recordings')
        .select('id, status, duration, file_size')
        .eq('id', recordingId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async recentRecordings(userId, since) {
      const { data, error } = await supabaseAdmin
        .from('recordings')
        .select('duration, status')
        .eq('user_id', userId)
        .gte('created_at', since)
        .in('status', ['processing', 'completed', 'failed'])
        .limit(1000);
      if (error) throw new Error(error.message);
      return data || [];
    }
  };
}

async function safe(label, userId, fn, fallback) {
  try { return await fn(); } catch (e) {
    logger.warn(`free-tier limit lookup failed (${label}); allowing`, { userId, error: e.message });
    return fallback;
  }
}

/**
 * Daily cap on AI generations (summary, quiz, flashcards, chat, mindmap, diagram) per user.
 * `deps`/`window` are injectable for tests.
 */
function aiDailyLimit({ deps, window = sharedAiWindow, env = process.env } = {}) {
  return async (req, res, next) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const d = deps || defaultDeps();
    const cfg = getFreeTierConfig(env);
    const now = d.now();
    const base = cfg.aiGenerationsPerDay;

    const used = await safe('ai-usage', userId, () => d.countAiUsage(userId, sinceIso(now)), 0);
    const mem = window.peek(`ai:${userId}`, effectiveLimit(base, true, cfg), now);
    let blocked = isOverLimit(used, base) || mem.used >= base;
    let limit = base;
    if (blocked && await safe('tier', userId, () => d.isPaid(userId), false)) {
      limit = effectiveLimit(base, true, cfg);
      blocked = isOverLimit(used, limit) || !mem.allowed;
    }
    if (blocked) {
      logger.info('AI daily limit reached', { userId, used: Math.max(used, mem.used), limit });
      return limitResponse(res, {
        scope: 'ai_generations',
        message: `You have reached today's limit of ${limit} AI generations. It resets on a rolling 24-hour basis, so please try again later.`,
        limit, used: Math.max(used, mem.used), retryAfterSec: mem.retryAfterSec || 3600
      });
    }
    window.record(`ai:${userId}`, now);
    next();
  };
}

/**
 * Guard for POST /api/recordings/transcribe: daily transcription count, daily audio minutes, and the longest
 * single recording. An already-completed recording is returned from the database at no cost, so it is never limited.
 */
function transcriptionGuard({ deps, window = sharedSttWindow, env = process.env } = {}) {
  return async (req, res, next) => {
    const userId = req.userId;
    const recordingId = req.body && req.body.recording_id;
    if (!userId || !recordingId) return next(); // the route answers 401/400 itself
    const d = deps || defaultDeps();
    const cfg = getFreeTierConfig(env);
    const now = d.now();

    const recording = await safe('recording', userId, () => d.getRecording(userId, recordingId), null);
    if (recording && recording.status === 'completed') return next();

    const paidLimits = (base) => effectiveLimit(base, true, cfg);
    let paid = null;
    const isPaid = async () => (paid === null ? (paid = await safe('tier', userId, () => d.isPaid(userId), false)) : paid);

    // 1. Longest single recording (only known if the row carries a duration).
    const durSec = Number(recording && recording.duration);
    if (Number.isFinite(durSec) && durSec > cfg.maxAudioMinutes * 60) {
      const limit = (await isPaid()) ? paidLimits(cfg.maxAudioMinutes) : cfg.maxAudioMinutes;
      if (durSec > limit * 60) {
        return limitResponse(res, {
          scope: 'audio_length', code: 'AUDIO_TOO_LONG', status: 422,
          message: `This recording is longer than the ${limit}-minute limit for transcription. Please split it into shorter recordings.`,
          limit, used: Math.round(durSec / 60)
        });
      }
    }

    // 2. Daily count and daily audio minutes.
    const rows = await safe('recent-recordings', userId, () => d.recentRecordings(userId, sinceIso(now)), []);
    const usedCount = rows.length;
    const usedMinutes = Math.round(rows.reduce((s, r) => s + (Number(r.duration) || 0), 0) / 60);
    const mem = window.peek(`stt:${userId}`, paidLimits(cfg.transcriptionsPerDay), now);

    const check = (paidUser) => {
      const cLimit = paidUser ? paidLimits(cfg.transcriptionsPerDay) : cfg.transcriptionsPerDay;
      const mLimit = paidUser ? paidLimits(cfg.audioMinutesPerDay) : cfg.audioMinutesPerDay;
      if (isOverLimit(Math.max(usedCount, mem.used), cLimit)) {
        return { scope: 'transcriptions', limit: cLimit, used: Math.max(usedCount, mem.used),
          message: `You have reached today's limit of ${cLimit} voice transcriptions. It resets on a rolling 24-hour basis, so please try again later.` };
      }
      if (isOverLimit(usedMinutes, mLimit)) {
        return { scope: 'audio_minutes', limit: mLimit, used: usedMinutes,
          message: `You have reached today's limit of ${mLimit} minutes of transcribed audio. It resets on a rolling 24-hour basis, so please try again later.` };
      }
      return null;
    };

    let hit = check(false);
    if (hit && (await isPaid())) hit = check(true);
    if (hit) {
      logger.info('Transcription daily limit reached', { userId, scope: hit.scope, used: hit.used, limit: hit.limit });
      return limitResponse(res, { ...hit, retryAfterSec: mem.retryAfterSec || 3600 });
    }
    window.record(`stt:${userId}`, now);
    next();
  };
}

/** Shared by every per-feature cap: the 429 body for "you used today's allowance". */
function capBlock(scope, message, limit, used, retryAfterSec) {
  return { scope, message, limit, used, retryAfterSec: retryAfterSec || 3600 };
}

/**
 * Global LLM spend breaker. Returns null when the call may go ahead, else a block descriptor.
 * Spend is an estimate over the last 24 hours (see defaultDeps.llmSpendUsd). Above the alert level the owner is emailed
 * (once a day); above the soft level only paying users continue; above the hard level nobody does.
 *
 * The lookup is shared and cached for a minute: concurrent callers wait for one in-flight query (single flight), and a lookup
 * that fails, or that finds too many rows to read, is remembered as "unknown" for the same minute instead of being retried on
 * every request. Unknown means fail open (never block on a broken backstop) plus an alert; the per-user caps still apply.
 */
async function evaluateLlmBudget(userId, { deps, env = process.env, cache = sharedBudgetCache } = {}) {
  const d = deps || defaultDeps();
  const cfg = getFreeTierConfig(env);
  const now = d.now();
  if (!cache.has || now - cache.at >= BUDGET_CACHE_MS) {
    if (!cache.inflight) {
      cache.inflight = (async () => {
        let usd = await safe('llm-spend', userId, () => d.llmSpendUsd(sinceIso(now)), null);
        if (usd !== null && !Number.isFinite(usd)) {
          // Too many calls to total up. Not a verdict either way: alert, and treat as unknown.
          try { require('../utils/failureReporter').reportCounted('llm_budget', 'LLM spend could not be totalled (too many calls in the last 24h)', {}); } catch { /* never block */ }
          usd = null;
        }
        cache.at = now; cache.usd = usd; cache.has = true;
      })().finally(() => { cache.inflight = null; });
    }
    await cache.inflight;
  }
  const usd = cache.usd;
  if (usd === null || usd === undefined) return null;
  if (usd >= cfg.llmBudgetAlertUsd) {
    try { require('../utils/failureReporter').reportCounted('llm_budget', 'LLM spend over the daily alert level (last 24h)', { usd: usd.toFixed(2), alert: String(cfg.llmBudgetAlertUsd), soft: String(cfg.llmBudgetSoftUsd), hard: String(cfg.llmBudgetHardUsd) }); } catch { /* never block */ }
  }
  let blocked = usd >= cfg.llmBudgetHardUsd;
  if (!blocked && usd >= cfg.llmBudgetSoftUsd) blocked = !(await safe('tier', userId, () => d.isPaid(userId), false));
  if (!blocked) return null;
  logger.warn('Global LLM daily budget reached', { userId, usd: usd.toFixed(2) });
  return { code: 'GLOBAL_DAILY_BUDGET_REACHED', scope: 'global_llm_budget', limit: null, used: null, retryAfterSec: 3600,
    message: 'ScribeAI has reached its daily limit for AI features. Your notes and recordings are safe; please try again later today or tomorrow.' };
}

/**
 * One feature's per-user daily cap. Returns null when allowed (the attempt is recorded in the in-process window and, for
 * record:true features, in usage_tracking), else a block descriptor. Attempts count, so a failing request cannot be retried
 * in a loop to burn money. Paid users get the 5x multiplier.
 */
async function evaluateFeatureCap(feature, userId, { deps, window, env = process.env } = {}) {
  const spec = FEATURE_CAPS[feature];
  if (!spec) throw new Error(`unknown capped feature: ${feature}`);
  const d = deps || defaultDeps();
  const cfg = getFreeTierConfig(env);
  const now = d.now();
  const base = cfg[spec.limitKey];
  // Pro users: an explicit Pro number where the feature has one (podcast 10, infographic 15), else the paid multiplier.
  const proLimit = spec.proLimitKey ? cfg[spec.proLimitKey] : effectiveLimit(base, true, cfg);
  const win = window || featureWindow(feature);
  const key = `${feature}:${userId}`;

  const used = await safe(`${feature}-usage`, userId, () => d.countUsage(userId, spec.types, sinceIso(now)), 0);
  const mem = win.peek(key, Math.max(base, proLimit), now);
  let blocked = isOverLimit(used, base) || mem.used >= base;
  let limit = base;
  if (blocked && await safe('tier', userId, () => d.isPaid(userId), false)) {
    limit = proLimit;
    blocked = isOverLimit(used, limit) || mem.used >= limit;
  }
  if (blocked) {
    logger.info('Feature daily limit reached', { userId, feature, used: Math.max(used, mem.used), limit });
    return capBlock(feature, `You have reached today's limit of ${limit} ${spec.label}. It resets on a rolling 24-hour basis, so please try again later.`,
      limit, Math.max(used, mem.used), mem.retryAfterSec);
  }
  win.record(key, now);
  if (spec.record) await safe(`${feature}-record`, userId, () => d.recordUsage(userId, spec.types[0], { via: 'daily_cap' }), null);
  return null;
}

function sendBlock(res, block, defaultCode = 'DAILY_LIMIT_REACHED') {
  return limitResponse(res, { scope: block.scope, message: block.message, code: block.code || defaultCode, limit: block.limit, used: block.used, retryAfterSec: block.retryAfterSec });
}

/** Middleware: global LLM budget only. `cache` is injectable for tests. */
function llmSpendBreaker({ deps, env = process.env, cache } = {}) {
  return async (req, res, next) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const block = await evaluateLlmBudget(userId, { deps, env, cache });
    if (block) return sendBlock(res, block);
    next();
  };
}

/**
 * Middleware: daily cap for `feature` (a key of FEATURE_CAPS). LLM features also pass through the global breaker first,
 * so a tripped breaker does not use up a user's own allowance.
 */
function featureDailyCap(feature, { deps, window, env = process.env, cache } = {}) {
  if (!FEATURE_CAPS[feature]) throw new Error(`unknown capped feature: ${feature}`);
  return async (req, res, next) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (FEATURE_CAPS[feature].llm) {
      const budget = await evaluateLlmBudget(userId, { deps, env, cache });
      if (budget) return sendBlock(res, budget);
    }
    const block = await evaluateFeatureCap(feature, userId, { deps, window, env });
    if (block) return sendBlock(res, block);
    next();
  };
}

/** Same check as featureDailyCap for code that is not an Express middleware. Sends the 429 and returns false when blocked. */
async function admitFeature(feature, req, res, opts = {}) {
  let allowed = false;
  await featureDailyCap(feature, opts)(req, res, () => { allowed = true; });
  return allowed;
}

/**
 * Background formatting after note creation is not a request, so it cannot answer 429: it is simply skipped when the user is
 * over the formatting cap or the global budget is tripped (the note is saved unformatted and can be formatted manually later).
 */
async function admitAutoFormatting(userId, { deps, window, env = process.env, cache } = {}) {
  try {
    if (await evaluateLlmBudget(userId, { deps, env, cache })) return false;
    return (await evaluateFeatureCap('formatting', userId, { deps, window, env })) === null;
  } catch (e) {
    logger.warn('auto-format cap check failed; allowing', { userId, error: e.message });
    return true;
  }
}

/**
 * Guard for POST /api/meetings (Recall.ai bot): meeting sessions per day and meeting hours per day. Finished meetings count
 * their real length, meetings of unknown length count `meetingAssumedHours`. Failed and cancelled meetings are not counted.
 */
function meetingBotGuard({ deps, window = featureWindow('meeting'), env = process.env } = {}) {
  return async (req, res, next) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const d = deps || defaultDeps();
    const cfg = getFreeTierConfig(env);
    const now = d.now();
    const rows = await safe('meetings', userId, () => d.recentMeetings(userId, sinceIso(now)), []);
    const live = rows.filter((r) => !['failed', 'cancelled'].includes(String(r.status)));
    const sessions = live.length;
    const hours = live.reduce((s, r) => s + (Number(r.duration_seconds) > 0 ? Number(r.duration_seconds) / 3600 : cfg.meetingAssumedHours), 0);
    const key = `meeting:${userId}`;
    const mem = window.peek(key, Math.max(cfg.meetingSessionsPerDay, cfg.meetingSessionsPerDayPro), now);

    const check = (paidUser) => {
      const sLimit = paidUser ? cfg.meetingSessionsPerDayPro : cfg.meetingSessionsPerDay;
      const hLimit = paidUser ? cfg.meetingHoursPerDayPro : cfg.meetingHoursPerDay;
      if (isOverLimit(Math.max(sessions, mem.used), sLimit)) {
        return capBlock('meeting_sessions', `You have reached today's limit of ${sLimit} meeting-bot sessions. It resets on a rolling 24-hour basis, so please try again later.`, sLimit, Math.max(sessions, mem.used), mem.retryAfterSec);
      }
      if (hours >= hLimit) {
        return capBlock('meeting_hours', `You have reached today's limit of ${hLimit} hours of meeting-bot recording. It resets on a rolling 24-hour basis, so please try again later.`, hLimit, Math.round(hours * 10) / 10, mem.retryAfterSec);
      }
      return null;
    };
    let hit = check(false);
    if (hit && await safe('tier', userId, () => d.isPaid(userId), false)) hit = check(true);
    if (hit) {
      logger.info('Meeting bot daily limit reached', { userId, scope: hit.scope, used: hit.used, limit: hit.limit });
      return sendBlock(res, hit);
    }
    window.record(key, now);
    next();
  };
}

module.exports = {
  SlidingWindow, aiDailyLimit, transcriptionGuard, defaultDeps,
  featureDailyCap, admitFeature, admitAutoFormatting, meetingBotGuard, llmSpendBreaker,
  evaluateFeatureCap, evaluateLlmBudget, sendBlock, capBlock,
  _resetBudgetCacheForTests() { sharedBudgetCache.has = false; sharedBudgetCache.at = 0; sharedBudgetCache.usd = 0; sharedBudgetCache.inflight = null; }
};
