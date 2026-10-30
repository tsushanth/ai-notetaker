/**
 * Free-tier policy (pure, no I/O).
 *
 * Voice transcription (STT), AI summaries and the other note-based AI generations are free for
 * everyone. The old "3 notes / 5 AI generations per month" limits are OFF unless
 * FREE_TIER_LEGACY_LIMITS=true. Abuse backstops (per-user daily limits) are always on and
 * configurable through env vars; see getFreeTierConfig().
 */

// usage_tracking.feature_type values that count as one AI generation (same list the old monthly cap used).
const AI_FEATURE_TYPES = ['summary', 'quiz', 'flashcards', 'chat', 'mindmap', 'diagram'];

const DEFAULTS = {
  transcriptionsPerDay: 30,
  aiGenerationsPerDay: 60,
  audioMinutesPerDay: 240,   // total transcribed audio per rolling 24h (the real Deepgram cost cap)
  maxAudioMinutes: 60,       // longest single recording a free user may transcribe
  paidMultiplier: 5          // subscribers / trial / creators get this many times the free limits
};

const DAY_MS = 24 * 60 * 60 * 1000;

function legacyLimitsEnabled(env = process.env) {
  return String(env.FREE_TIER_LEGACY_LIMITS || '').trim().toLowerCase() === 'true';
}

function positiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getFreeTierConfig(env = process.env) {
  return {
    transcriptionsPerDay: positiveInt(env.FREE_TIER_TRANSCRIPTIONS_PER_DAY, DEFAULTS.transcriptionsPerDay),
    aiGenerationsPerDay: positiveInt(env.FREE_TIER_AI_GENERATIONS_PER_DAY, DEFAULTS.aiGenerationsPerDay),
    audioMinutesPerDay: positiveInt(env.FREE_TIER_AUDIO_MINUTES_PER_DAY, DEFAULTS.audioMinutesPerDay),
    maxAudioMinutes: positiveInt(env.FREE_TIER_MAX_AUDIO_MINUTES, DEFAULTS.maxAudioMinutes),
    paidMultiplier: positiveInt(env.FREE_TIER_PAID_MULTIPLIER, DEFAULTS.paidMultiplier)
  };
}

/** Limit for a user: base limit, times the multiplier for paid users. */
function effectiveLimit(base, isPaid, cfg) {
  return isPaid ? base * cfg.paidMultiplier : base;
}

/** true when `used` has reached `limit`. */
function isOverLimit(used, limit) {
  return Number(used) >= limit;
}

module.exports = {
  AI_FEATURE_TYPES,
  DEFAULTS,
  DAY_MS,
  legacyLimitsEnabled,
  getFreeTierConfig,
  effectiveLimit,
  isOverLimit
};
