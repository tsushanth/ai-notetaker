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

test('backend: export, AI tutor and unlimited share links are the Premium gates the copy relies on', () => {
  assert.match(backend('routes/exports.js'), /requireExportAccess[\s\S]*PREMIUM_REQUIRED/);
  assert.match(backend('routes/learning.js'), /!status\.isSubscribed && !status\.isInTrial[\s\S]*PREMIUM_REQUIRED/);
  assert.match(backend('routes/sharing.js'), /FREE_SHARES_PER_MONTH = 3/);
});

test('PODCASTS_GATED matches the backend: the podcast and infographic gate is currently switched off', () => {
  const src = backend('middleware/subscription.js');
  const m = src.match(/const requireSubscriptionForPodcast = async \(req, res, next\) => \{([\s\S]*?)\n  try \{/);
  assert.ok(m, 'requireSubscriptionForPodcast not found');
  const gateOff = /^\s*(\/\/[^\n]*\n\s*)*return next\(\);/.test(m[1]);
  assert.equal(PODCASTS_GATED, !gateOff, 'update PODCASTS_GATED in lib/freeTier.ts to match requireSubscriptionForPodcast');
});

test('PREMIUM_PERKS lists only what is gated: no quizzes, flashcards, chat or summaries', () => {
  const text = PREMIUM_PERKS.join(' | ').toLowerCase();
  assert.ok(!/quiz|flashcard|chat|summar|transcri/.test(text), text);
  assert.ok(/export/.test(text) && /tutor/.test(text) && /share/.test(text), text);
});

test('podcasts appear in the Premium list exactly when the backend gates them', () => {
  assert.equal(PREMIUM_PERKS.some((p) => /podcast/i.test(p)), PODCASTS_GATED);
});

test('the free list names what really is free', () => {
  const text = FREE_FOR_EVERYONE.join(' | ').toLowerCase();
  for (const word of ['transcription', 'summaries', 'quizzes', 'flashcards', 'chat']) assert.ok(text.includes(word), word);
});

test('the homepage FAQ answer comes from the same lists and never sells a free feature as Premium', () => {
  const answer = freePlanAnswer();
  const [free, premium] = answer.split('Premium adds');
  assert.ok(premium, 'answer should have a Premium part');
  for (const word of ['quizzes', 'flashcards', 'chat', 'summaries']) {
    assert.ok(free.toLowerCase().includes(word), `${word} should be in the free part`);
    assert.ok(!premium.toLowerCase().includes(word), `${word} must not be in the Premium part`);
  }
  assert.match(premium, /export/i);
  assert.equal(/podcast/i.test(premium), PODCASTS_GATED);
  assert.ok(web('app/page.tsx').includes('freePlanAnswer()'), 'the homepage must use freePlanAnswer()');
});

test('Settings "Your Features" does not lock podcasts while the backend lets everyone generate them', () => {
  const access = { freeTier: { legacyLimits: false }, features: { canCreateNotes: true, canUseAI: true, canGeneratePodcasts: false, unlimitedAccess: false } };
  const podcasts = featureRows(access).find((r) => r.key === 'podcasts')!;
  assert.equal(podcasts.included, !PODCASTS_GATED);
  assert.equal(podcasts.free, !PODCASTS_GATED);
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
