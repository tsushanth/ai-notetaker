// What is free vs paid on the web. Pure functions, no React, so they can be tested with `node --test`.
//
// Free for everyone: creating notes, recording and transcribing voice, AI summaries.
// Premium adds the rest (see PREMIUM_PERKS). The backend reports `freeTier.legacyLimits`; when it is true (the
// FREE_TIER_LEGACY_LIMITS switch) or absent (an older backend) the old per-user flags from the server decide.

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
    { key: 'podcasts', label: 'Podcasts', included: access.features.canGeneratePodcasts, free: false },
    { key: 'premium', label: 'Premium Extras', included: access.features.unlimitedAccess, free: false },
  ];
}

/** Copy for the upgrade screen: only what Premium adds on top of the free plan. */
export const FREE_FOR_EVERYONE = [
  'Voice recording and transcription',
  'AI summaries',
  'Creating notes',
];

export const PREMIUM_PERKS = [
  'Quizzes & flashcards',
  'AI chat assistant',
  'Audio podcasts from notes',
  'Export to PDF and Word',
  'AI tutor and learning sessions',
];
