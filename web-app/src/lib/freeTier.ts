// What is free vs paid on the web. Pure functions, no React, so they can be tested with `node --test`.
//
// Free for everyone: creating notes, recording and transcribing voice, AI summaries, quizzes, flashcards and AI chat
// (only per-user daily abuse backstops apply). Premium adds the rest (see PREMIUM_PERKS).
// The copy here is checked against the backend gates by test/planCopy.test.ts. The backend reports `freeTier.legacyLimits`; when it is true (the
// FREE_TIER_LEGACY_LIMITS switch) or absent (an older backend) the old per-user flags from the server decide.

/**
 * Whether the backend currently gates podcasts and infographics behind Premium. Today it does not:
 * requireSubscriptionForPodcast in the backend returns next() immediately ("temporarily disabled"), so every user
 * can generate them. test/planCopy.test.ts fails if this constant and the backend disagree, so re-enabling that
 * gate forces the copy to change with it.
 */
export const PODCASTS_GATED = false;

export interface AccessFeatures {
  canCreateNotes: boolean;
  canUseAI: boolean;
  canGeneratePodcasts: boolean;
  unlimitedAccess: boolean;
}

export interface AccessInfo {
  hasAccess?: boolean;
  freeTier?: { legacyLimits?: boolean } | null;
  features: AccessFeatures;
}

export interface FeatureRow {
  key: 'notes' | 'transcription' | 'summaries' | 'podcasts' | 'premium';
  label: string;
  included: boolean;
  free: boolean; // true = part of the free plan
}

/** True when STT, summaries and note creation are free for everyone (backend says legacy limits are off). */
export function coreFeaturesAreFree(access: Pick<AccessInfo, 'freeTier'> | null | undefined): boolean {
  return !!access && !!access.freeTier && access.freeTier.legacyLimits === false;
}

/** The rows shown under "Your Features" in Settings. */
export function featureRows(access: AccessInfo): FeatureRow[] {
  const free = coreFeaturesAreFree(access);
  const notes = free || access.features.canCreateNotes;
  const ai = free || access.features.canUseAI;
  return [
    { key: 'notes', label: 'Create Notes', included: notes, free: true },
    { key: 'transcription', label: 'Voice Transcription', included: ai, free: true },
    { key: 'summaries', label: 'AI Summaries', included: ai, free: true },
    { key: 'podcasts', label: 'Podcasts', included: PODCASTS_GATED ? access.features.canGeneratePodcasts : true, free: !PODCASTS_GATED },
    { key: 'premium', label: 'Premium Extras', included: access.features.unlimitedAccess, free: false },
  ];
}

/** Copy for the upgrade screen: only what Premium adds on top of the free plan. */
export const FREE_FOR_EVERYONE = [
  'Voice recording and transcription',
  'AI summaries',
  'Quizzes and flashcards',
  'AI chat',
  'Creating notes',
];

// Backend gates: exports (routes/exports.js), AI tutor (routes/learning.js), share links beyond 3 a month
// (routes/sharing.js). Podcasts join this list only if PODCASTS_GATED becomes true.
export const PREMIUM_PERKS = [
  'Export to PDF and Word',
  'AI tutor and learning sessions',
  'Unlimited share links (the free plan allows 3 a month)',
  ...(PODCASTS_GATED ? ['Audio podcasts from notes'] : []),
];

/** Homepage FAQ answer for "Is there a free plan?", built from the lists above so it cannot drift from them. */
export function freePlanAnswer(): string {
  const free = 'Taking notes, recording and transcribing voice, AI summaries, quizzes, flashcards and AI chat are free.';
  const premium = ['export to PDF and Word', 'the AI tutor and learning sessions', 'unlimited share links', ...(PODCASTS_GATED ? ['podcasts'] : [])];
  const last = premium.pop();
  return `Yes. ${free} Premium adds ${premium.length ? `${premium.join(', ')} and ${last}` : last}.`;
}
