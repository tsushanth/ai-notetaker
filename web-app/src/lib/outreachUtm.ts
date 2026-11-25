// First-touch outreach attribution, kept in this browser only.
//
// A link from an outreach email (https://calldesk.tech/o/<campaign>/<code>) lands here with
// ?utm_source=outreach&utm_medium=email&utm_campaign=<campaign>&utm_content=<code>. We keep utm_source, utm_campaign and
// utm_content (nothing else) in localStorage for 30 days, first touch wins, and send them as `signup_source` with the sign-up
// and Google sign-in calls. First-party storage only, no cookie, no third-party script. Pure functions with an injected
// storage and clock so they can be tested on their own.

export const OUTREACH_STORAGE_KEY = 'outreach_first_touch';
export const OUTREACH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Same shapes the backend accepts (ai-notetaker-backend src/utils/outreachEvents.js).
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface SignupSource {
  utm_source: 'outreach';
  utm_campaign: string;
  utm_content?: string;
}

interface Stored extends SignupSource {
  ts: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The outreach params in a URL query string, validated, or null when this is not an outreach link. */
export function parseOutreachParams(search: string): SignupSource | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if ((params.get('utm_source') || '').trim().toLowerCase() !== 'outreach') return null;
  const campaign = (params.get('utm_campaign') || '').trim().toLowerCase();
  if (!CAMPAIGN_RE.test(campaign)) return null;
  const code = (params.get('utm_content') || '').trim();
  return CODE_RE.test(code)
    ? { utm_source: 'outreach', utm_campaign: campaign, utm_content: code }
    : { utm_source: 'outreach', utm_campaign: campaign };
}

function readStored(storage: StorageLike, now: number): Stored | null {
  try {
    const raw = storage.getItem(OUTREACH_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored> | null;
    if (!v || typeof v !== 'object' || typeof v.ts !== 'number' || now - v.ts > OUTREACH_TTL_MS || v.ts > now + 60_000) {
      storage.removeItem(OUTREACH_STORAGE_KEY);
      return null;
    }
    const parsed = parseOutreachParams(
      new URLSearchParams({ utm_source: String(v.utm_source ?? ''), utm_campaign: String(v.utm_campaign ?? ''), utm_content: String(v.utm_content ?? '') }).toString(),
    );
    if (!parsed) {
      storage.removeItem(OUTREACH_STORAGE_KEY);
      return null;
    }
    return { ...parsed, ts: v.ts };
  } catch {
    return null;
  }
}

/**
 * Stores the first outreach touch found in `search`. Keeps an existing, unexpired touch (first touch wins).
 * Returns true when something was stored. Never throws.
 */
export function captureOutreachTouch(search: string, storage: StorageLike | null = defaultStorage(), now: number = Date.now()): boolean {
  try {
    if (!storage) return false;
    const touch = parseOutreachParams(search);
    if (!touch) return false;
    if (readStored(storage, now)) return false;
    const value: Stored = { ...touch, ts: now };
    storage.setItem(OUTREACH_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The stored first touch as the `signup_source` body field, or undefined when there is none (or it expired). Never throws. */
export function getSignupSource(storage: StorageLike | null = defaultStorage(), now: number = Date.now()): SignupSource | undefined {
  try {
    if (!storage) return undefined;
    const s = readStored(storage, now);
    if (!s) return undefined;
    return { utm_source: s.utm_source, utm_campaign: s.utm_campaign, ...(s.utm_content ? { utm_content: s.utm_content } : {}) };
  } catch {
    return undefined;
  }
}

/** Forgets the stored touch once an account has been created with it. Never throws. */
export function clearOutreachTouch(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(OUTREACH_STORAGE_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}
