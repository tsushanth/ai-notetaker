const { AppError } = require('../middleware/errorHandler');

/**
 * Deepgram pre-recorded transcription client shared by the recording pipeline.
 *
 * Language: the request used to be pinned to `language=en`, so audio in any other language came
 * back empty or garbled. We now send `detect_language=true` with the same `nova-2` model. Per the
 * Deepgram language-detection docs, detection overrides `language`, English audio is still
 * transcribed by nova-2 (nothing else changes for it), and for a detected language nova-2 does not
 * cover Deepgram falls back through Nova-3 -> Nova-2 -> Nova-1 -> Enhanced -> Base. The response
 * carries `results.channels[n].detected_language` and `language_confidence` (0-1; ignore it for
 * languages outside the 35 supported ones). Every field is read defensively because it can be
 * absent.
 */

const LISTEN_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&detect_language=true&smart_format=true';

// Per attempt and overall budget. The Android client waits up to 120-300 s, so a retry has to fit.
const ATTEMPT_TIMEOUT_MS = 60_000;
const TOTAL_BUDGET_MS = 115_000;
const MIN_ATTEMPT_MS = 10_000;
const RETRY_BACKOFF_MS = Number.isFinite(Number(process.env.DEEPGRAM_RETRY_BACKOFF_MS)) && process.env.DEEPGRAM_RETRY_BACKOFF_MS !== undefined
  ? Number(process.env.DEEPGRAM_RETRY_BACKOFF_MS) : 1_500; // env override exists for tests
const MAX_ATTEMPTS = 2; // first try + one retry

/**
 * Error carrying a short machine-readable code (stored in recordings.error_message) and the
 * HTTP status/message the client sees. `dbMessage` is what is written to the recording row.
 */
class TranscriptionError extends AppError {
  constructor(code, message, statusCode = 500, { dbMessage, providerStatus = null, retryable = false } = {}) {
    super(message, statusCode);
    this.code = code;
    this.dbMessage = dbMessage || `${code}: ${message}`;
    this.providerStatus = providerStatus;
    this.retryable = retryable;
  }
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function isTimeoutError(err) {
  return err && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function parseResult(json) {
  const channel = json?.results?.channels?.[0];
  const rawDuration = Number(json?.metadata?.duration);
  const rawConfidence = Number(channel?.language_confidence);
  const language = channel?.detected_language;
  return {
    text: channel?.alternatives?.[0]?.transcript || '',
    durationSec: Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : null,
    detectedLanguage: typeof language === 'string' && language ? language : null,
    languageConfidence: Number.isFinite(rawConfidence) ? Math.round(rawConfidence * 100) / 100 : null,
  };
}

/**
 * Send audio to Deepgram. Retries once, after a short backoff, on network errors, timeouts,
 * HTTP 429 and HTTP 5xx. Never retries other 4xx responses.
 *
 * @param {{ body: Buffer, mimeType: string, backoffMs?: number, attemptTimeoutMs?: number,
 *           sleep?: (ms:number)=>Promise<void> }} opts
 * @returns {Promise<{text, durationSec, detectedLanguage, languageConfidence, providerStatus, attempts}>}
 */
async function transcribeAudio({ body, mimeType, backoffMs = RETRY_BACKOFF_MS, attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, sleep }) {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new TranscriptionError('PROVIDER_ERROR', 'Transcription provider is not configured', 500);
  }
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    const timeoutMs = Math.min(attemptTimeoutMs, Math.max(remaining, MIN_ATTEMPT_MS));
    try {
      const res = await fetch(LISTEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': mimeType,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        // Drain the body so the connection is released; do not put it in the error (not needed).
        await res.text().catch(() => '');
        throw new TranscriptionError(
          'PROVIDER_ERROR',
          `Failed to transcribe recording: transcription provider returned ${res.status}`,
          500,
          { dbMessage: `PROVIDER_ERROR: Deepgram HTTP ${res.status}`, providerStatus: res.status, retryable: isTransientStatus(res.status) }
        );
      }

      let json;
      try {
        json = await res.json();
      } catch (e) {
        throw new TranscriptionError(
          'PROVIDER_ERROR',
          'Failed to transcribe recording: unreadable response from transcription provider',
          500,
          { dbMessage: 'PROVIDER_ERROR: Deepgram returned an unreadable response', providerStatus: res.status }
        );
      }
      return { ...parseResult(json), providerStatus: res.status, attempts: attempt };
    } catch (err) {
      let e = err;
      if (!(e instanceof TranscriptionError)) {
        if (isTimeoutError(e)) {
          e = new TranscriptionError(
            'PROVIDER_TIMEOUT',
            'Failed to transcribe recording: transcription provider timed out',
            500,
            { dbMessage: `PROVIDER_TIMEOUT: Deepgram did not answer within ${Math.round(timeoutMs / 1000)}s`, retryable: true }
          );
        } else {
          // fetch() network failure (DNS, reset, TLS ...)
          e = new TranscriptionError(
            'PROVIDER_ERROR',
            'Failed to transcribe recording: could not reach transcription provider',
            500,
            { dbMessage: `PROVIDER_ERROR: network error calling Deepgram (${e.cause?.code || e.name || 'unknown'})`, retryable: true }
          );
        }
      }
      e.attempts = attempt;
      lastError = e;
      const budgetLeft = TOTAL_BUDGET_MS - (Date.now() - startedAt) - backoffMs;
      if (!e.retryable || attempt >= MAX_ATTEMPTS || budgetLeft < MIN_ATTEMPT_MS) break;
      await wait(backoffMs);
    }
  }
  throw lastError;
}

module.exports = { transcribeAudio, TranscriptionError, LISTEN_URL, parseResult };
