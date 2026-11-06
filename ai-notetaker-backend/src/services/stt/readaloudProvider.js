const { parseResult } = require('../deepgramClient');

/**
 * Self-hosted speech-to-text worker, Deepgram-compatible `POST /v1/listen`.
 *
 * Request options mirror the Deepgram request in deepgramClient.js: automatic language detection
 * and smart formatting, one channel, no speaker labels. Auth is a static bearer token. The worker
 * answers in the Deepgram response shape, so deepgramClient.parseResult reads it; the language
 * probability lives under metadata.stt_ext there rather than on the channel, so it is lifted here.
 *
 * Every failure is thrown as a ReadaloudError with a short `reason` (no audio, token or URL in
 * it); the caller decides what to do (the seam falls back to Deepgram).
 */

const DEFAULT_TIMEOUT_MS = 30_000;

class ReadaloudError extends Error {
  constructor(reason, { status = null } = {}) {
    super(`readaloud stt: ${reason}`);
    this.name = 'ReadaloudError';
    this.reason = reason;
    this.status = status;
  }
}

function listenUrl(baseUrl) {
  return `${String(baseUrl).replace(/\/+$/, '')}/v1/listen?model=nova-2&detect_language=true&smart_format=true&diarize=false`;
}

function timeoutMs(env = process.env) {
  const n = Number(env.READALOUD_STT_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_TIMEOUT_MS;
}

function readConfig(env = process.env) {
  const url = (env.READALOUD_STT_URL || '').trim();
  const token = (env.READALOUD_STT_TOKEN || '').trim();
  if (!url || !token) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  } catch (e) {
    return null;
  }
  return { url, token };
}

async function transcribe({ body, mimeType }, cfg, env = process.env) {
  let res;
  try {
    res = await fetch(listenUrl(cfg.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': mimeType },
      body,
      signal: AbortSignal.timeout(timeoutMs(env)),
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ReadaloudError('timeout');
    throw new ReadaloudError(`network error (${(e && (e.cause?.code || e.name)) || 'unknown'})`);
  }

  if (!res.ok) {
    await res.text().catch(() => '');
    throw new ReadaloudError(`HTTP ${res.status}`, { status: res.status });
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new ReadaloudError('unreadable response', { status: res.status });
  }
  if (!json || typeof json !== 'object' || !json.results) {
    throw new ReadaloudError('unexpected response shape', { status: res.status });
  }

  const parsed = parseResult(json);
  if (parsed.languageConfidence == null) {
    const p = Number(json?.metadata?.stt_ext?.language_probability);
    if (Number.isFinite(p)) parsed.languageConfidence = Math.round(p * 100) / 100;
  }
  return { ...parsed, providerStatus: res.status, attempts: 1 };
}

module.exports = { transcribe, readConfig, listenUrl, ReadaloudError, DEFAULT_TIMEOUT_MS };
