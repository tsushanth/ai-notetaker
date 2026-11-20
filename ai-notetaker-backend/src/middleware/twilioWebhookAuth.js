/**
 * Twilio webhook authentication (X-Twilio-Signature).
 * Scheme (https://www.twilio.com/docs/usage/security#validating-requests): base64(HMAC-SHA1(AuthToken, fullUrlTwilioRequested + POST params
 * sorted by name, concatenated name+value)). The URL is the one Twilio called, which for us is built from BACKEND_URL/SERVICE_URL in
 * twilioService.js, so we try that plus the Host header (proxy-safe) with and without the /v1 prefix.
 *
 * PHASE 1 (default): verify and LOG (header names only, no query string), count via the failure reporter, but still call next().
 * These callbacks drive live calls; a URL mismatch behind the Fly proxy would otherwise break calls.
 *   flyctl logs -a ai-notetaker-backend | grep twilioWebhookAuth
 *   outcome "ok"                              => genuine signed Twilio callback verified for that route
 *   outcome "failed", reason "no_signature_header"   => unsigned (forged or not from Twilio)
 *   outcome "failed", reason "signature_mismatch"    => signed but did not match any candidate URL (forgery, or URL reconstruction differs from BACKEND_URL)
 * Enforce by setting TWILIO_WEBHOOK_ENFORCE=1 only after every real callback for every route logs "ok". Enforced failures get 403.
 */
const Twilio = require('twilio');
const { logger } = require('../utils/logger');
const { reportCounted } = require('../utils/failureReporter');

function candidateUrls(req, baseUrl) {
  const p = req.originalUrl;
  const urls = new Set();
  if (baseUrl) urls.add(`${String(baseUrl).replace(/\/+$/, '')}${p}`);
  const fwd = req.headers['x-forwarded-host'];
  const host = (Array.isArray(fwd) ? fwd[0] : fwd) || req.headers.host;
  if (host) {
    urls.add(`https://${host}${p}`);
    if (p.startsWith('/v1/')) urls.add(`https://${host}${p.slice(3)}`);
    else urls.add(`https://${host}/v1${p}`);
  }
  return [...urls];
}

function verifyTwilioRequest(req, authToken, baseUrl) {
  if (!authToken) return { ok: false, reason: 'auth_token_not_configured' };
  const sig = req.headers['x-twilio-signature'];
  const signature = Array.isArray(sig) ? sig[0] : sig;
  if (!signature) return { ok: false, reason: 'no_signature_header' };
  const params = req.body && typeof req.body === 'object' ? req.body : {};
  for (const url of candidateUrls(req, baseUrl)) {
    try { if (Twilio.validateRequest(authToken, signature, url, params)) return { ok: true }; } catch { /* next candidate */ }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

function twilioWebhookAuth(opts = {}) {
  const getToken = opts.authToken || (() => process.env.TWILIO_AUTH_TOKEN || undefined);
  const getBase = opts.baseUrl || (() => process.env.BACKEND_URL || process.env.SERVICE_URL || undefined);
  const isEnforced = opts.enforce || (() => process.env.TWILIO_WEBHOOK_ENFORCE === '1');
  return (req, res, next) => {
    const verdict = verifyTwilioRequest(req, getToken(), getBase());
    const route = String(req.originalUrl || '').split('?')[0];
    const enforce = isEnforced();
    if (verdict.ok) {
      logger.info('twilioWebhookAuth', { route, outcome: 'ok', enforced: enforce });
      return next();
    }
    logger.warn('twilioWebhookAuth', { route, outcome: 'failed', reason: verdict.reason, enforced: enforce, headers: Object.keys(req.headers).sort().join(',') });
    reportCounted('webhook_twilio', `Twilio webhook not verified: ${verdict.reason}`, { reason: verdict.reason, route, enforced: String(enforce) });
    if (enforce) return res.status(403).type('text/plain').send('Forbidden');
    return next();
  };
}

module.exports = { twilioWebhookAuth, verifyTwilioRequest, candidateUrls };
