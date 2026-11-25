// Reports outreach-attributed signups and first activations to the shared outreach metrics layer
// (Calldesk: POST /api/outreach/event, contract in the Calldesk repo docs/OUTREACH-METRICS.md).
//
// OFF by default: nothing happens unless OUTREACH_EVENTS_URL is set to the endpoint (https) AND a secret is present
// (OUTREACH_EVENT_SECRET_SCRIBEAI, else the shared OUTREACH_EVENT_SECRET). Only users whose first touch was an outreach link
// (utm_source=outreach with a valid utm_campaign) are ever reported.
//
//  - fire and forget: callers never await the network call; 2 second timeout per attempt; one background retry for network
//    errors, 5xx and 429; every error swallowed;
//  - one log line per outcome with event, campaign slug and HTTP status: never an email, user id or link code;
//  - the email travels only in the signed body; the layer hashes it with its own pepper and never stores it.
const { createHmac } = require('crypto');

const OUTREACH_PRODUCT = 'scribeai';
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TIMEOUT_MS = 2000;
const RETRY_DELAY_MS = 2000;

/** { campaign, linkCode } for a first-touch utm set that came from an outreach link, else null. */
function outreachAttribution(src) {
  if (!src || typeof src !== 'object') return null;
  const source = typeof src.utm_source === 'string' ? src.utm_source.trim().toLowerCase() : '';
  const campaign = typeof src.utm_campaign === 'string' ? src.utm_campaign.trim().toLowerCase() : '';
  if (source !== 'outreach' || !CAMPAIGN_RE.test(campaign)) return null;
  const code = typeof src.utm_content === 'string' ? src.utm_content.trim() : '';
  return { campaign, linkCode: CODE_RE.test(code) ? code : null };
}

let warnedMissingSecret = false;

/** { url, secret } while the feature is on, else null. */
function outreachConfig(env = process.env) {
  const url = String(env.OUTREACH_EVENTS_URL ?? '').trim();
  if (!url || !/^https:\/\/[^\s/]+/i.test(url)) return null;
  const secret = String(env[`OUTREACH_EVENT_SECRET_${OUTREACH_PRODUCT.toUpperCase()}`] || env.OUTREACH_EVENT_SECRET || '').trim();
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('[outreach] OUTREACH_EVENTS_URL is set but no event secret is; outreach events stay off');
    }
    return null;
  }
  return { url, secret };
}

/** Signs and posts one event; resolves to 'sent' | 'skipped' | 'failed' and never rejects. Callers use reportOutreachEvent. */
async function sendOutreachEvent({ event, attribution, email, meta }, deps = {}) {
  const log = deps.log || ((l) => console.log(l));
  try {
    const cfg = outreachConfig(deps.env || process.env);
    if (!cfg) return 'skipped';
    const addr = String(email == null ? '' : email).trim();
    if (!addr || !addr.includes('@')) return 'skipped';
    const fetchImpl = deps.fetchImpl || fetch;
    const now = deps.now || Date.now;
    const body = { product: OUTREACH_PRODUCT, campaign: attribution.campaign, event, email: addr, ts: new Date(now()).toISOString() };
    if (attribution.linkCode) body.link_code = attribution.linkCode;
    if (meta) body.meta = meta;
    const raw = JSON.stringify(body);

    const attempt = async () => {
      const ts = String(Math.floor(now() / 1000));
      const sig = 'v1=' + createHmac('sha256', cfg.secret).update(`${ts}.${raw}`).digest('hex');
      try {
        const res = await fetchImpl(cfg.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-outreach-product': OUTREACH_PRODUCT, 'x-outreach-timestamp': ts, 'x-outreach-signature': sig },
          body: raw,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return { status: res.status };
      } catch (e) {
        return { error: (e && e.name) || 'error' };
      }
    };
    const retryable = (r) => 'error' in r || r.status >= 500 || r.status === 429;

    let r = await attempt();
    if (retryable(r)) {
      await new Promise((resolve) => { const t = setTimeout(resolve, deps.retryDelayMs == null ? RETRY_DELAY_MS : deps.retryDelayMs); if (t.unref) t.unref(); });
      r = await attempt();
    }
    log(`[outreach] ${event} campaign=${attribution.campaign} ${'status' in r ? `status=${r.status}` : `error=${r.error}`}`);
    return 'status' in r && r.status >= 200 && r.status < 300 ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Fire and forget. Returns immediately; does nothing while the feature is off. */
function reportOutreachEvent(input, deps = {}) {
  if (!outreachConfig(deps.env || process.env)) return;
  sendOutreachEvent(input, deps).catch(() => undefined);
}

const MAX_SEEN = 20000;
const seen = new Set();
/** Test hook. */
function resetOutreachActivationCache() { seen.clear(); }

/**
 * Activation: `lookup(userId)` resolves { attribution, email } for an outreach user, or null. Fire and forget. At most one
 * lookup per user per process; the metrics layer also keeps one `activated` row per user and campaign.
 */
function reportActivationForUser(userId, lookup, deps = {}) {
  if (!userId || !outreachConfig(deps.env || process.env) || seen.has(userId)) return;
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(userId);
  (async () => {
    try {
      const found = await lookup(userId);
      if (!found || !found.attribution || !found.email) return;
      await sendOutreachEvent({ event: 'activated', attribution: found.attribution, email: found.email, meta: { milestone: 'first_transcription_or_summary' } }, deps);
    } catch {
      // swallowed on purpose: activation reporting must never affect a request
    }
  })();
}

/**
 * The optional `signup_source` object a sign-up request may carry ({ utm_source, utm_campaign, utm_content }), reduced to what is
 * stored on the account: { outreach: { campaign, code } } for an outreach first touch, else null. Nothing else is kept.
 */
function outreachAppMetadata(signupSource) {
  const a = outreachAttribution(signupSource);
  return a ? { outreach: { campaign: a.campaign, code: a.linkCode } } : null;
}

/** Reads the stored attribution back from an auth user's app_metadata. */
function attributionFromAppMetadata(appMetadata) {
  const o = appMetadata && appMetadata.outreach;
  if (!o || typeof o !== 'object') return null;
  return outreachAttribution({ utm_source: 'outreach', utm_campaign: o.campaign, utm_content: o.code });
}

module.exports = {
  OUTREACH_PRODUCT, outreachAttribution, outreachConfig, sendOutreachEvent, reportOutreachEvent, reportActivationForUser,
  resetOutreachActivationCache, outreachAppMetadata, attributionFromAppMetadata,
};
