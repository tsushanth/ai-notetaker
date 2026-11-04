import test from 'node:test';
import assert from 'node:assert/strict';
import { coreFeaturesAreFree, featureRows, PREMIUM_PERKS, FREE_FOR_EVERYONE, PODCASTS_GATED } from '../src/lib/freeTier.ts';

const lockedFeatures = { canCreateNotes: false, canUseAI: false, canGeneratePodcasts: false, unlimitedAccess: false };

test('backend says legacy limits are off: notes, transcription and summaries are included even if the per-user flags say no', () => {
  const rows = featureRows({ freeTier: { legacyLimits: false }, features: lockedFeatures });
  for (const key of ['notes', 'transcription', 'summaries']) assert.equal(rows.find((r) => r.key === key)!.included, true, key);
});

test('paid extras stay locked for a free user even when core features are free', () => {
  const rows = featureRows({ freeTier: { legacyLimits: false }, features: lockedFeatures });
  // The three Pro features stay locked while the backend gates them (see PODCASTS_GATED); the freed features are always open.
  for (const key of ['podcasts', 'infographics', 'meetingBot']) assert.equal(rows.find((r) => r.key === key)!.included, !PODCASTS_GATED, key);
  for (const key of ['export', 'learn']) assert.equal(rows.find((r) => r.key === key)!.included, true, key);
});

test('legacy limits on, or an older backend with no freeTier field: the server flags decide', () => {
  for (const freeTier of [{ legacyLimits: true }, undefined, null]) {
    const rows = featureRows({ freeTier, features: lockedFeatures });
    assert.equal(rows.find((r) => r.key === 'summaries')!.included, false);
    const open = featureRows({ freeTier, features: { ...lockedFeatures, canUseAI: true } });
    assert.equal(open.find((r) => r.key === 'summaries')!.included, true);
  }
});

test('coreFeaturesAreFree is false for missing or legacy info', () => {
  assert.equal(coreFeaturesAreFree(null), false);
  assert.equal(coreFeaturesAreFree({}), false);
  assert.equal(coreFeaturesAreFree({ freeTier: { legacyLimits: true } }), false);
  assert.equal(coreFeaturesAreFree({ freeTier: { legacyLimits: false } }), true);
});

test('upgrade copy lists only what is still Pro and never the free features', () => {
  const paid = PREMIUM_PERKS.join(' | ').toLowerCase();
  assert.ok(!/transcri|summar|unlimited notebooks|export|tutor|share/.test(paid));
  assert.ok(/transcription/i.test(FREE_FOR_EVERYONE.join(' ')) && /summaries/i.test(FREE_FOR_EVERYONE.join(' ')));
});
