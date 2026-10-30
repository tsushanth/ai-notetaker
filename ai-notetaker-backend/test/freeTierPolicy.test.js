const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyLimitsEnabled, getFreeTierConfig, effectiveLimit, isOverLimit, DEFAULTS, AI_FEATURE_TYPES } = require('../src/utils/freeTierPolicy');

test('legacy monthly limits are OFF unless FREE_TIER_LEGACY_LIMITS is exactly "true"', () => {
  assert.equal(legacyLimitsEnabled({}), false);
  for (const v of ['', 'false', '1', 'yes', 'TRUE ']) assert.equal(legacyLimitsEnabled({ FREE_TIER_LEGACY_LIMITS: v }), v.trim().toLowerCase() === 'true');
  assert.equal(legacyLimitsEnabled({ FREE_TIER_LEGACY_LIMITS: 'true' }), true);
});

test('defaults are the documented backstops', () => {
  assert.deepEqual(getFreeTierConfig({}), DEFAULTS);
  assert.equal(DEFAULTS.transcriptionsPerDay, 30);
  assert.equal(DEFAULTS.aiGenerationsPerDay, 60);
  assert.equal(DEFAULTS.maxAudioMinutes, 60);
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
