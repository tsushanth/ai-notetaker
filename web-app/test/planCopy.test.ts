import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FREE_FOR_EVERYONE, PREMIUM_PERKS, PODCASTS_GATED, featureRows, freePlanAnswer } from '../src/lib/freeTier.ts';
import { CHECKOUT_PLANS, savingsPercent, savingsHeadline } from '../src/lib/plans.ts';

// Plan copy must say what the backend really gates. These tests read the backend source, so when a gate changes
// there (a route becomes free or paid) the copy test fails and the copy has to be updated with it.

const here = dirname(fileURLToPath(import.meta.url));
const backend = (p: string) => readFileSync(join(here, '..', '..', 'ai-notetaker-backend', 'src', p), 'utf8');
const web = (p: string) => readFileSync(join(here, '..', 'src', p), 'utf8');

/** The declaration line of a route, so its middleware chain can be inspected. */
function routeLine(file: string, method: string, path: string): string {
  const line = backend(file).split('\n').find((l) => l.includes(`router.${method}('${path}'`));
  assert.ok(line, `route ${method.toUpperCase()} ${path} not found in ${file}`);
  return line;
}

test('backend: summary, quiz, flashcards and chat are free (daily backstop only, no subscription gate)', () => {
  for (const path of ['/summary', '/quiz', '/flashcards', '/chat']) {
    const line = routeLine('routes/ai.js', 'post', path);
    assert.ok(line.includes('checkUsageLimits('), `${path} should use the daily backstop`);
    assert.doesNotMatch(line, /\brequireSubscription(ForPodcast)?\b/, `${path} must not be subscription-gated`);
  }
});

test('backend: export, Learn, Create, Compete, integrations and share links are free (gated only while FREE_EXCEPT_COSTLY is switched off)', () => {
  const sub = backend('middleware/subscription.js');
  assert.match(sub, /async function hasStandardAccess[\s\S]*?if \(freeExceptCostly\(env\)\) return true;/);
  for (const file of ['routes/exports.js', 'routes/learning.js', 'routes/createContent.js', 'routes/compete.js', 'routes/integrations.js', 'routes/sharing.js']) {
    const src = backend(file);
    assert.match(src, /hasStandardAccess/, `${file} must use the flag-aware helper`);
    assert.doesNotMatch(src, /status\.isSubscribed/, `${file} must not check the subscription inline`);
  }
});

test('PODCASTS_GATED matches the backend: podcasts, infographics and the meeting bot are behind requireProFeature', () => {
  const ai = backend('routes/ai.js');
  const meetings = backend('routes/meetings.js');
  const gated = [
    routeLine('routes/ai.js', 'post', '/podcast').includes("requireProFeature('podcast')"),
    routeLine('routes/ai.js', 'post', '/podcast/script').includes("requireProFeature('podcast')"),
    routeLine('routes/ai.js', 'post', '/infographic').includes("requireProFeature('infographic')"),
    /router\.post\(\s*'\/',\s*[^]*?requireProFeature\('meeting_bot'\)/.test(meetings)
  ];
  assert.ok(ai.includes('requireProFeature') && meetings.includes('requireProFeature'));
  assert.equal(PODCASTS_GATED, gated.every(Boolean), 'update PODCASTS_GATED in lib/freeTier.ts to match the backend Pro gates');
  assert.ok(gated.every((g) => g === gated[0]), 'the three Pro features are gated together');
});

test('the Pro-only set in the backend is exactly podcasts, infographics and the meeting bot', () => {
  const policy = backend('utils/freeTierPolicy.js');
  const m = policy.match(/const PRO_FEATURES = \{([^}]*)\}/);
  assert.ok(m, 'PRO_FEATURES not found');
  assert.deepEqual([...m[1].matchAll(/(\w+):/g)].map((x) => x[1]).sort(), ['infographic', 'meeting_bot', 'podcast']);
});

test('PREMIUM_PERKS lists only Pro features: podcasts, infographics, meeting bot, higher limits', () => {
  const text = PREMIUM_PERKS.join(' | ').toLowerCase();
  for (const word of ['podcast', 'infographic', 'meeting bot', 'higher daily limits']) assert.ok(text.includes(word), word);
  assert.ok(!/quiz|flashcard|chat|summar|transcri|export|tutor|learn|share|integration/.test(text), text);
});

test('the free list names what really is free', () => {
  const text = FREE_FOR_EVERYONE.join(' | ').toLowerCase();
  for (const word of ['transcription', 'summaries', 'quizzes', 'flashcards', 'chat', 'mind maps', 'export', 'learn, create and compete', 'integrations', 'share links']) assert.ok(text.includes(word), word);
  assert.ok(!/podcast|infographic|meeting bot/.test(text), text);
});

test('the homepage FAQ answer comes from the same lists and never sells a free feature as Pro', () => {
  const answer = freePlanAnswer();
  const [free, pro] = answer.split('Pro adds');
  assert.ok(pro, 'answer should have a Pro part');
  for (const word of ['quizzes', 'flashcards', 'chat', 'summaries', 'mind maps', 'export', 'learn', 'integrations', 'share links']) {
    assert.ok(free.toLowerCase().includes(word), `${word} should be in the free part`);
    assert.ok(!pro.toLowerCase().includes(word), `${word} must not be in the Pro part`);
  }
  for (const word of ['podcasts', 'infographics', 'meeting bot', 'higher daily limits']) assert.ok(pro.toLowerCase().includes(word), word);
  assert.ok(web('app/page.tsx').includes('freePlanAnswer()'), 'the homepage must use freePlanAnswer()');
});

test('Settings "Your Features" locks podcasts, infographics and the meeting bot for free users and opens them for Pro', () => {
  const freeUser = { freeTier: { legacyLimits: false }, features: { canCreateNotes: true, canUseAI: true, canGeneratePodcasts: false, canGenerateInfographics: false, canUseMeetingBot: false, unlimitedAccess: false } };
  const pro = { ...freeUser, features: { ...freeUser.features, canGeneratePodcasts: true, canGenerateInfographics: true, canUseMeetingBot: true } };
  for (const key of ['podcasts', 'infographics', 'meetingBot']) {
    assert.equal(featureRows(freeUser).find((r) => r.key === key)!.included, !PODCASTS_GATED, `${key} (free user)`);
    assert.equal(featureRows(pro).find((r) => r.key === key)!.included, true, `${key} (Pro)`);
  }
  for (const key of ['export', 'learn']) assert.equal(featureRows(freeUser).find((r) => r.key === key)!.included, true, key);
  // An older backend that does not send the new flags: the podcast flag decides for all three (same gate).
  const old = { freeTier: { legacyLimits: false }, features: { canCreateNotes: true, canUseAI: true, canGeneratePodcasts: true, unlimitedAccess: false } };
  for (const key of ['infographics', 'meetingBot']) assert.equal(featureRows(old).find((r) => r.key === key)!.included, true, key);
});

test('the homepage only promises what the web upload page accepts (PDF)', () => {
  assert.match(web('app/(dashboard)/notes/new/upload/page.tsx'), /type !== 'application\/pdf'/);
  assert.doesNotMatch(web('app/page.tsx'), /slide ?deck|powerpoint|word document/i);
});

test('savings percentages come from the displayed prices, never a hardcoded number', () => {
  assert.equal(savingsPercent('$48.99', '$69.99'), 30);
  assert.equal(savingsPercent('$6.99', '$9.99'), 30);
  assert.equal(savingsPercent('$9.99', '$9.99'), 0);
  assert.equal(savingsPercent('n/a', '$9.99'), null);
  for (const plan of CHECKOUT_PLANS) assert.ok(savingsPercent(plan.price, plan.appStorePrice)! >= 30, plan.id);
  assert.equal(savingsHeadline(CHECKOUT_PLANS), 'Save 30% compared to App Store prices');
  assert.equal(savingsHeadline([{ id: 'x', name: 'x', price: '$9.99', appStorePrice: '$9.99' }]), null);
  assert.doesNotMatch(web('app/(checkout)/subscription/page.tsx'), /Save \d+%/);
});

test('the Settings fallback plans carry no unverifiable "Save N%" claim', () => {
  assert.doesNotMatch(web('app/(dashboard)/settings/page.tsx'), /Save \d+%/);
});
