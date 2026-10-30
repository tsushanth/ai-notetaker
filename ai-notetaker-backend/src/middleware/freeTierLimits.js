/**
 * Abuse backstops for the free STT + AI generation features.
 *
 * - transcriptionGuard: runs before POST /api/recordings/transcribe
 * - aiDailyLimit(): runs in front of every AI generation route (via checkUsageLimits)
 *
 * Both count against a rolling 24 hours, using data that already exists (recordings, usage_tracking) plus an
 * in-process window as a second layer (catches retries and anything the tables miss; resets on restart and is per
 * machine). Over the limit -> HTTP 429 (never 403, so clients do not read it as a paywall) with a clear message.
 * A lookup that fails never blocks the user (fail open, logged): these are backstops, not the product gate.
 */
const { logger } = require('../utils/logger');
const {
  AI_FEATURE_TYPES, DAY_MS, getFreeTierConfig, effectiveLimit, isOverLimit
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

function limitResponse(res, { scope, message, code = 'DAILY_LIMIT_REACHED', status = 429, limit, used, retryAfterSec }) {
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
      const { getSubscriptionStatus } = require('./subscription');
      const s = await getSubscriptionStatus(userId);
      return !!(s.isSubscribed || s.isInTrial || s.isCreator);
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

module.exports = { SlidingWindow, aiDailyLimit, transcriptionGuard, defaultDeps };
