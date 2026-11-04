/**
 * Free-tier policy (pure, no I/O).
 *
 * Voice transcription (STT), AI summaries and the other note-based AI generations are free for
 * everyone. The old "3 notes / 5 AI generations per month" limits are OFF unless
 * FREE_TIER_LEGACY_LIMITS=true. Abuse backstops (per-user daily limits) are always on and
 * configurable through env vars; see getFreeTierConfig().
 *
 * FREE_EXCEPT_COSTLY (default ON, read per request): ScribeAI is free for everyone EXCEPT three costly features that need
 * Pro (a subscription, trial or creator premium): the Recall meeting bot, podcasts and infographics. Every other feature
 * (export, Learn, Create, Compete, integrations, share links, note formatting, chat suggestions ...) is free.
 * FREE_EXCEPT_COSTLY=false reopens the three costly routes to everyone (the old no-op gate) and brings back the old subscriber /
 * trial checks on the freed features. It does NOT switch off the new per-user daily caps or the global spend breaker below:
 * those apply in BOTH modes, they are what keeps "free" affordable.
 */

// usage_tracking.feature_type values that count as one AI generation (same list the old monthly cap used).
const AI_FEATURE_TYPES = ['summary', 'quiz', 'flashcards', 'chat', 'mindmap', 'diagram'];

// Pro-only while FREE_EXCEPT_COSTLY is on. key -> label used in the paywall response.
const PRO_FEATURES = { meeting_bot: 'Meeting bot', podcast: 'Podcast generation', infographic: 'Infographic generation' };

/**
 * Per-feature daily caps beyond the AI-generation and transcription guards. `types` are the usage_tracking.feature_type
 * values counted; `limitKey` is the getFreeTierConfig() field; `record` = the middleware writes the usage row itself
 * (false when the route already records it); `llm` = the call spends LLM money, so the global breaker applies.
 */
const FEATURE_CAPS = {
  podcast:     { types: ['podcast'],     limitKey: 'podcastsPerDay', proLimitKey: 'podcastsPerDayPro', label: 'podcasts',            record: false, llm: true },
  infographic: { types: ['infographic'], limitKey: 'infographicsPerDay', proLimitKey: 'infographicsPerDayPro', label: 'infographics',        record: false, llm: true },
  learning:    { types: ['learning'],    limitKey: 'learnPerDay',        label: 'Learn lessons',       record: true,  llm: true },
  create:      { types: ['create'],      limitKey: 'createPerDay',       label: 'Create generations',  record: true,  llm: true },
  compete:     { types: ['compete'],     limitKey: 'competePerDay',      label: 'challenges',          record: true,  llm: true },
  suggestions: { types: ['suggestions'], limitKey: 'suggestionsPerDay', label: 'chat suggestion requests', record: true, llm: true },
  formatting:  { types: ['formatting'],  limitKey: 'formattingPerDay',   label: 'note formatting runs', record: true,  llm: true },
  upload:      { types: ['upload'],      limitKey: 'uploadsPerDay',      label: 'uploads',             record: true,  llm: true },
  tts:         { types: ['tts'],         limitKey: 'ttsPerDay',          label: 'text-to-speech requests', record: true, llm: false }
};

// Per-user limits are per rolling 24 hours. Every value is env-overridable (see getFreeTierConfig).
const DEFAULTS = {
  transcriptionsPerDay: 30,  // unchanged from before this work
  aiGenerationsPerDay: 60,   // unchanged from before this work
  audioMinutesPerDay: 240,   // total transcribed audio per rolling 24h (the real Deepgram cost cap)
  maxAudioMinutes: 60,       // longest single recording a free user may transcribe
  paidMultiplier: 5,         // subscribers / trial / creators get this many times the free limits
  // Pro features: the free numbers apply only when FREE_EXCEPT_COSTLY=false (then everyone may use them); Pro users get the *Pro numbers.
  podcastsPerDay: 3,
  infographicsPerDay: 5,
  podcastsPerDayPro: 10,
  infographicsPerDayPro: 15,
  meetingSessionsPerDayPro: 8,
  meetingHoursPerDayPro: 10,
  learnPerDay: 5,
  createPerDay: 5,
  competePerDay: 5,
  formattingPerDay: 20,      // manual + automatic note formatting (16k-token Sonnet calls)
  uploadsPerDay: 10,         // pdf + video-url + slideshow + scan + scan batch + large-file process
  ttsPerDay: 20,
  suggestionsPerDay: 60,     // GET /api/ai/suggestions (small model calls, one per note chat open)
  sharesPerDay: 20,          // new share links per day (the 3/month rule for non-subscribers still applies when FREE_EXCEPT_COSTLY=false)
  meetingSessionsPerDay: 3,  // Recall.ai meeting bots started per day
  meetingHoursPerDay: 4,     // meeting-bot hours per day (finished meetings count their real length)
  meetingAssumedHours: 1,    // hours assumed for a meeting whose length is not known yet
  llmBudgetAlertUsd: 10,     // global spend over the last 24h that sends an alert
  llmBudgetSoftUsd: 25,      // global spend over the last 24h at which new non-paying users' LLM calls get 429
  llmBudgetHardUsd: 75       // global spend over the last 24h at which every LLM call gets 429
};

// Estimated USD per call for LLM work that does NOT go through the instrumented SDK client (so llm_calls never sees it):
// Learn, Create, Compete and the infographic prompt call api.anthropic.com directly. Used only by the global spend breaker.
const UNINSTRUMENTED_UNIT_COST_USD = { learning: 0.12, create: 0.10, compete: 0.08, infographic: 0.20 };

const DAY_MS = 24 * 60 * 60 * 1000;

function legacyLimitsEnabled(env = process.env) {
  return String(env.FREE_TIER_LEGACY_LIMITS || '').trim().toLowerCase() === 'true';
}

/**
 * FREE_EXCEPT_COSTLY: default ON. Only an explicit false/0/no/off turns it off (a typo or empty value keeps the app free,
 * so a bad secret can never silently re-lock features). Read on every call, so flipping the secret needs only a restart.
 */
function freeExceptCostly(env = process.env) {
  const v = String(env.FREE_EXCEPT_COSTLY ?? '').trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(v);
}

function positiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function positiveNumber(raw, fallback) {
  const n = Number.parseFloat(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getFreeTierConfig(env = process.env) {
  return {
    transcriptionsPerDay: positiveInt(env.FREE_TIER_TRANSCRIPTIONS_PER_DAY, DEFAULTS.transcriptionsPerDay),
    aiGenerationsPerDay: positiveInt(env.FREE_TIER_AI_GENERATIONS_PER_DAY, DEFAULTS.aiGenerationsPerDay),
    audioMinutesPerDay: positiveInt(env.FREE_TIER_AUDIO_MINUTES_PER_DAY, DEFAULTS.audioMinutesPerDay),
    maxAudioMinutes: positiveInt(env.FREE_TIER_MAX_AUDIO_MINUTES, DEFAULTS.maxAudioMinutes),
    paidMultiplier: positiveInt(env.FREE_TIER_PAID_MULTIPLIER, DEFAULTS.paidMultiplier),
    podcastsPerDay: positiveInt(env.FREE_TIER_PODCASTS_PER_DAY, DEFAULTS.podcastsPerDay),
    infographicsPerDay: positiveInt(env.FREE_TIER_INFOGRAPHICS_PER_DAY, DEFAULTS.infographicsPerDay),
    podcastsPerDayPro: positiveInt(env.PRO_PODCASTS_PER_DAY, DEFAULTS.podcastsPerDayPro),
    infographicsPerDayPro: positiveInt(env.PRO_INFOGRAPHICS_PER_DAY, DEFAULTS.infographicsPerDayPro),
    meetingSessionsPerDayPro: positiveInt(env.PRO_MEETING_SESSIONS_PER_DAY, DEFAULTS.meetingSessionsPerDayPro),
    meetingHoursPerDayPro: positiveNumber(env.PRO_MEETING_HOURS_PER_DAY, DEFAULTS.meetingHoursPerDayPro),
    learnPerDay: positiveInt(env.FREE_TIER_LEARN_PER_DAY, DEFAULTS.learnPerDay),
    createPerDay: positiveInt(env.FREE_TIER_CREATE_PER_DAY, DEFAULTS.createPerDay),
    competePerDay: positiveInt(env.FREE_TIER_COMPETE_PER_DAY, DEFAULTS.competePerDay),
    formattingPerDay: positiveInt(env.FREE_TIER_FORMATTING_PER_DAY, DEFAULTS.formattingPerDay),
    uploadsPerDay: positiveInt(env.FREE_TIER_UPLOADS_PER_DAY, DEFAULTS.uploadsPerDay),
    ttsPerDay: positiveInt(env.FREE_TIER_TTS_PER_DAY, DEFAULTS.ttsPerDay),
    suggestionsPerDay: positiveInt(env.FREE_TIER_SUGGESTIONS_PER_DAY, DEFAULTS.suggestionsPerDay),
    sharesPerDay: positiveInt(env.FREE_TIER_SHARES_PER_DAY, DEFAULTS.sharesPerDay),
    meetingSessionsPerDay: positiveInt(env.FREE_TIER_MEETING_SESSIONS_PER_DAY, DEFAULTS.meetingSessionsPerDay),
    meetingHoursPerDay: positiveNumber(env.FREE_TIER_MEETING_HOURS_PER_DAY, DEFAULTS.meetingHoursPerDay),
    meetingAssumedHours: positiveNumber(env.FREE_TIER_MEETING_ASSUMED_HOURS, DEFAULTS.meetingAssumedHours),
    llmBudgetAlertUsd: positiveNumber(env.LLM_DAILY_BUDGET_ALERT_USD, DEFAULTS.llmBudgetAlertUsd),
    llmBudgetSoftUsd: positiveNumber(env.LLM_DAILY_BUDGET_SOFT_USD, DEFAULTS.llmBudgetSoftUsd),
    llmBudgetHardUsd: positiveNumber(env.LLM_DAILY_BUDGET_HARD_USD, DEFAULTS.llmBudgetHardUsd)
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
  FEATURE_CAPS,
  UNINSTRUMENTED_UNIT_COST_USD,
  DEFAULTS,
  freeExceptCostly,
  PRO_FEATURES,
  DAY_MS,
  legacyLimitsEnabled,
  getFreeTierConfig,
  effectiveLimit,
  isOverLimit
};
