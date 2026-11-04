// What is free vs Pro on the web. Pure functions, no React, so they can be tested with `node --test`.
//
// Free for everyone: notes, voice recording and transcription, AI summaries, chat, quizzes, flashcards, mind maps, export,
// Learn / Create / Compete, integrations and share links (per-user daily limits apply).
// Pro: podcasts, infographics, the meeting bot, and higher daily limits.
// The copy here is checked against the backend gates by test/planCopy.test.ts. The backend reports `freeTier.legacyLimits`; when it is true (the
// FREE_TIER_LEGACY_LIMITS switch) or absent (an older backend) the old per-user flags from the server decide.

/**
 * Whether the backend gates podcasts, infographics and the meeting bot behind Pro (requireProFeature in the backend).
 * test/planCopy.test.ts fails if this constant and the backend disagree, so changing that gate forces the copy to change with it.
 */
export const PODCASTS_GATED = true;

export interface AccessFeatures {
  canCreateNotes: boolean;
  canUseAI: boolean;
  canGeneratePodcasts: boolean;
  canGenerateInfographics?: boolean; // absent on an older backend: fall back to the podcast flag (same Pro gate)
  canUseMeetingBot?: boolean;
  unlimitedAccess: boolean;
}

export interface AccessInfo {
  hasAccess?: boolean;
  freeTier?: { legacyLimits?: boolean } | null;
  features: AccessFeatures;
}

export interface FeatureRow {
  key: 'notes' | 'transcription' | 'summaries' | 'export' | 'learn' | 'podcasts' | 'infographics' | 'meetingBot';
  label: string;
  included: boolean;
  free: boolean; // true = part of the free plan
}

/** True when STT, summaries and note creation are free for everyone (backend says legacy limits are off). */
export function coreFeaturesAreFree(access: Pick<AccessInfo, 'freeTier'> | null | undefined): boolean {
  return !!access && !!access.freeTier && access.freeTier.legacyLimits === false;
}

/** The rows shown under "Your Features" in Settings. Free rows first, then the three Pro features. */
export function featureRows(access: AccessInfo): FeatureRow[] {
  const free = coreFeaturesAreFree(access);
  const notes = free || access.features.canCreateNotes;
  const ai = free || access.features.canUseAI;
  const pod = access.features.canGeneratePodcasts;
  return [
    { key: 'notes', label: 'Create Notes', included: notes, free: true },
    { key: 'transcription', label: 'Voice Transcription', included: ai, free: true },
    { key: 'summaries', label: 'AI Summaries, Chat and Quizzes', included: ai, free: true },
    { key: 'export', label: 'Export and Share Links', included: true, free: true },
    { key: 'learn', label: 'Learn, Create and Compete', included: true, free: true },
    { key: 'podcasts', label: 'Podcasts (Pro)', included: PODCASTS_GATED ? pod : true, free: !PODCASTS_GATED },
    { key: 'infographics', label: 'Infographics (Pro)', included: PODCASTS_GATED ? (access.features.canGenerateInfographics ?? pod) : true, free: !PODCASTS_GATED },
    { key: 'meetingBot', label: 'Meeting Bot (Pro)', included: PODCASTS_GATED ? (access.features.canUseMeetingBot ?? pod) : true, free: !PODCASTS_GATED },
  ];
}

/** Copy for the upgrade screen: what is free for everyone. */
export const FREE_FOR_EVERYONE = [
  'Voice recording and transcription',
  'AI summaries',
  'AI chat',
  'Quizzes and flashcards',
  'Mind maps',
  'Export to PDF and Word',
  'Learn, Create and Compete',
  'Integrations',
  'Share links',
  'Creating notes',
];

// Backend gates: podcasts, infographics and the meeting bot (requireProFeature in routes/ai.js and routes/meetings.js), plus higher
// per-user daily limits for Pro. Everything else is free.
export const PREMIUM_PERKS = [
  'Audio podcasts from your notes',
  'Infographics',
  'Meeting bot that joins and records your calls',
  'Higher daily limits',
];

/** Homepage FAQ answer for "Is there a free plan?", built from the lists above so it cannot drift from them. */
export function freePlanAnswer(): string {
  const free = 'Taking notes, recording and transcribing voice, AI summaries, chat, quizzes, flashcards, mind maps, export, Learn, Create and Compete, integrations and share links are free.';
  const premium = ['podcasts', 'infographics', 'the meeting bot', 'higher daily limits'];
  const last = premium.pop();
  return `Yes. ${free} Pro adds ${premium.join(', ')} and ${last}.`;
}
