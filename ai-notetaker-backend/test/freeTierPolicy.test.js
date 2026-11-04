const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyLimitsEnabled, freeExceptCostly, getFreeTierConfig, effectiveLimit, isOverLimit, DEFAULTS, AI_FEATURE_TYPES, FEATURE_CAPS, PRO_FEATURES, UNINSTRUMENTED_UNIT_COST_USD } = require('../src/utils/freeTierPolicy');

test('legacy monthly limits are OFF unless FREE_TIER_LEGACY_LIMITS is exactly "true"', () => {
  assert.equal(legacyLimitsEnabled({}), false);
  for (const v of ['', 'false', '1', 'yes', 'TRUE ']) assert.equal(legacyLimitsEnabled({ FREE_TIER_LEGACY_LIMITS: v }), v.trim().toLowerCase() === 'true');
  assert.equal(legacyLimitsEnabled({ FREE_TIER_LEGACY_LIMITS: 'true' }), true);
});

test('defaults are the documented backstops', () => {
  assert.deepEqual(getFreeTierConfig({}), DEFAULTS);
  assert.equal(DEFAULTS.transcriptionsPerDay, 10);
  assert.equal(DEFAULTS.aiGenerationsPerDay, 20);
  assert.equal(DEFAULTS.audioMinutesPerDay, 90);
  assert.equal(DEFAULTS.maxAudioMinutes, 60);
});

test('the proposed free-plan numbers are what ships', () => {
  const c = getFreeTierConfig({});
  assert.deepEqual(
    [c.podcastsPerDay, c.infographicsPerDay, c.meetingSessionsPerDay, c.meetingHoursPerDay, c.uploadsPerDay, c.learnPerDay, c.createPerDay, c.competePerDay, c.formattingPerDay, c.ttsPerDay, c.sharesPerDay],
    [3, 5, 3, 4, 10, 5, 5, 5, 20, 20, 20]
  );
  assert.deepEqual([c.llmBudgetAlertUsd, c.llmBudgetSoftUsd, c.llmBudgetHardUsd], [10, 25, 75]);
  assert.deepEqual([c.podcastsPerDayPro, c.infographicsPerDayPro, c.meetingSessionsPerDayPro, c.meetingHoursPerDayPro], [10, 15, 8, 10]);
});

test('the Pro-only set is exactly the meeting bot, podcasts and infographics', () => {
  assert.deepEqual(Object.keys(PRO_FEATURES).sort(), ['infographic', 'meeting_bot', 'podcast']);
});

test('FREE_EXCEPT_COSTLY defaults to ON; only false/0/no/off (any case, padded) turn it off', () => {
  assert.equal(freeExceptCostly({}), true);
  for (const v of ['true', 'TRUE', '1', 'yes', '', ' ', 'banana', 'fals']) assert.equal(freeExceptCostly({ FREE_EXCEPT_COSTLY: v }), true, JSON.stringify(v));
  for (const v of ['false', 'FALSE', ' False ', '0', 'no', 'off', 'OFF']) assert.equal(freeExceptCostly({ FREE_EXCEPT_COSTLY: v }), false, JSON.stringify(v));
});

test('every new cap is env-overridable, bad values fall back, and budgets accept decimals', () => {
  const env = {
    FREE_TIER_PODCASTS_PER_DAY: '1', FREE_TIER_INFOGRAPHICS_PER_DAY: '2', FREE_TIER_LEARN_PER_DAY: '3', FREE_TIER_CREATE_PER_DAY: '4', FREE_TIER_COMPETE_PER_DAY: '6',
    FREE_TIER_FORMATTING_PER_DAY: '7', FREE_TIER_UPLOADS_PER_DAY: '8', FREE_TIER_TTS_PER_DAY: '9', FREE_TIER_SUGGESTIONS_PER_DAY: '11', FREE_TIER_SHARES_PER_DAY: '12',
    FREE_TIER_MEETING_SESSIONS_PER_DAY: '13', FREE_TIER_MEETING_HOURS_PER_DAY: '1.5', FREE_TIER_MEETING_ASSUMED_HOURS: '0.5',
    PRO_PODCASTS_PER_DAY: '21', PRO_INFOGRAPHICS_PER_DAY: '22', PRO_MEETING_SESSIONS_PER_DAY: '23', PRO_MEETING_HOURS_PER_DAY: '2.5',
    LLM_DAILY_BUDGET_ALERT_USD: '2.5', LLM_DAILY_BUDGET_SOFT_USD: '5', LLM_DAILY_BUDGET_HARD_USD: '9.75'
  };
  const c = getFreeTierConfig(env);
  assert.deepEqual([c.podcastsPerDay, c.infographicsPerDay, c.learnPerDay, c.createPerDay, c.competePerDay, c.formattingPerDay, c.uploadsPerDay, c.ttsPerDay, c.suggestionsPerDay, c.sharesPerDay, c.meetingSessionsPerDay],
    [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13]);
  assert.deepEqual([c.meetingHoursPerDay, c.meetingAssumedHours, c.llmBudgetAlertUsd, c.llmBudgetSoftUsd, c.llmBudgetHardUsd], [1.5, 0.5, 2.5, 5, 9.75]);
  assert.deepEqual([c.podcastsPerDayPro, c.infographicsPerDayPro, c.meetingSessionsPerDayPro, c.meetingHoursPerDayPro], [21, 22, 23, 2.5]);
  for (const bad of ['0', '-1', 'abc', '']) {
    assert.equal(getFreeTierConfig({ FREE_TIER_PODCASTS_PER_DAY: bad }).podcastsPerDay, 3, bad);
    assert.equal(getFreeTierConfig({ LLM_DAILY_BUDGET_SOFT_USD: bad }).llmBudgetSoftUsd, 25, bad);
  }
});

test('FEATURE_CAPS: each entry points at a real config key and counts its own usage type', () => {
  const c = getFreeTierConfig({});
  for (const [name, spec] of Object.entries(FEATURE_CAPS)) {
    assert.ok(c[spec.limitKey] > 0, name);
    assert.deepEqual(spec.types, [name]);
    assert.ok(!spec.types.some((t) => AI_FEATURE_TYPES.includes(t)), `${name} must not double-count as an AI generation`);
  }
  assert.ok(UNINSTRUMENTED_UNIT_COST_USD.learning > 0 && UNINSTRUMENTED_UNIT_COST_USD.create > 0);
});

test('limits are configurable by env and bad values fall back to the default', () => {
  const cfg = getFreeTierConfig({ FREE_TIER_TRANSCRIPTIONS_PER_DAY: '5', FREE_TIER_AI_GENERATIONS_PER_DAY: '10', FREE_TIER_MAX_AUDIO_MINUTES: '20' });
  assert.equal(cfg.transcriptionsPerDay, 5);
  assert.equal(cfg.aiGenerationsPerDay, 10);
  assert.equal(cfg.maxAudioMinutes, 20);
  for (const bad of ['0', '-3', 'abc', '', ' ']) assert.equal(getFreeTierConfig({ FREE_TIER_TRANSCRIPTIONS_PER_DAY: bad }).transcriptionsPerDay, DEFAULTS.transcriptionsPerDay, bad);
});

test('paid users get the multiplier; isOverLimit is >=', () => {
  const cfg = getFreeTierConfig({});
  assert.equal(effectiveLimit(60, false, cfg), 60);
  assert.equal(effectiveLimit(60, true, cfg), 300);
  assert.equal(isOverLimit(59, 60), false);
  assert.equal(isOverLimit(60, 60), true);
});

test('summary is one of the counted AI generation types', () => {
  assert.ok(AI_FEATURE_TYPES.includes('summary'));
});
