/**
 * Recall.ai webhook verification (Svix scheme).
 *
 * Recall delivers webhooks through Svix. Headers are `webhook-id`, `webhook-timestamp`, `webhook-signature`
 * (workspace verification secret, accounts created on/after 2025-12-15 and all real-time endpoints) or the
 * legacy `svix-id`, `svix-timestamp`, `svix-signature` (per-endpoint secret, older accounts). The signature
 * header is a space-separated list of `v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${rawBody}`; the key
 * is the base64-decoded part of the `whsec_...` secret after the prefix.
 * Source: https://docs.recall.ai/docs/authenticating-requests-from-recallai
 *
 * The old check here looked for `x-recall-signature` / `x-webhook-signature` (a hex HMAC Recall never sends)
 * and returned TRUE whenever the header or the secret was missing, so the endpoint was unauthenticated.
 *
 * This module only decides; the route decides what to do with a failure (phase 1 logs and accepts, phase 2
 * rejects). It never throws and never returns secret material.
 */
const crypto = require('crypto');

const TOLERANCE_SECONDS = 5 * 60;
const PREFIXES = ['webhook', 'svix'];

function headerValue(headers, name) {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Names (never values) of the signature-related headers present on the request. */
function presentSignatureHeaderNames(headers = {}) {
  const names = [];
  for (const p of PREFIXES) {
    for (const suffix of ['id', 'timestamp', 'signature']) {
      if (headerValue(headers, `${p}-${suffix}`)) names.push(`${p}-${suffix}`);
    }
  }
  for (const legacy of ['x-recall-signature', 'x-webhook-signature']) {
    if (headerValue(headers, legacy)) names.push(legacy);
  }
  return names;
}

function keyFromSecret(secret) {
  const b64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(b64, 'base64');
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * @param {object} p
 * @param {Buffer|string} p.rawBody  exact bytes received (not re-serialised JSON)
 * @param {object} p.headers         lower-cased request headers
 * @param {string[]} p.secrets       candidate whsec_ secrets (empty/undefined entries ignored)
 * @param {number} [p.nowMs]
 * @returns {{ok: boolean, reason?: string, scheme?: string, headerNames: string[]}}
 */
function verifyRecallWebhook({ rawBody, headers = {}, secrets = [], nowMs = Date.now() }) {
  const headerNames = presentSignatureHeaderNames(headers);
  const keys = secrets.filter(Boolean);
  if (keys.length === 0) return { ok: false, reason: 'no_secret', headerNames };

  let sawPartial = false;
  let sawStale = false;
  for (const prefix of PREFIXES) {
    const id = headerValue(headers, `${prefix}-id`);
    const timestamp = headerValue(headers, `${prefix}-timestamp`);
    const signature = headerValue(headers, `${prefix}-signature`);
    if (!id && !timestamp && !signature) continue;
    if (!id || !timestamp || !signature) { sawPartial = true; continue; }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) { sawStale = true; continue; }

    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
    const toSign = `${id}.${timestamp}.${body}`;
    const provided = String(signature).split(' ')
      .map((s) => s.split(','))
      .filter(([version, sig]) => version === 'v1' && sig)
      .map(([, sig]) => sig);

    for (const secret of keys) {
      let key;
      try { key = keyFromSecret(secret); } catch { continue; }
      if (key.length === 0) continue;
      const expected = crypto.createHmac('sha256', key).update(toSign, 'utf8').digest('base64');
      if (provided.some((sig) => safeEqual(sig, expected))) return { ok: true, scheme: prefix, headerNames };
    }
    return { ok: false, reason: 'bad_signature', scheme: prefix, headerNames };
  }
  if (sawStale) return { ok: false, reason: 'stale_timestamp', headerNames };
  if (sawPartial) return { ok: false, reason: 'partial_headers', headerNames };
  return { ok: false, reason: 'no_signature_headers', headerNames };
}

module.exports = { verifyRecallWebhook, presentSignatureHeaderNames, TOLERANCE_SECONDS };
