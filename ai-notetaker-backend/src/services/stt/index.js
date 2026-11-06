const deepgram = require('../deepgramClient');
const readaloud = require('./readaloudProvider');
const { logger } = require('../../utils/logger');
const { measureLevel } = require('../../utils/audioLevel');

/**
 * Speech-to-text seam used by the recording pipeline.
 *
 *   STT_PROVIDER=deepgram   (default, also used for an unset, empty or unknown value)
 *   STT_PROVIDER=readaloud  self-hosted worker (READALOUD_STT_URL, READALOUD_STT_TOKEN)
 *
 * With the default provider this module calls deepgramClient.transcribeAudio with the same
 * arguments it always got, so the request and the result are unchanged. With `readaloud`, any
 * failure of the worker (timeout, network error, HTTP error, unreadable body, or an empty
 * transcript for audio that is not silent) falls back to Deepgram for that request.
 */

// Inputs longer than this go straight to Deepgram. The worker has a fixed time budget per request
// that includes the upload, and it refuses audio over a few hours; a margin below an hour keeps
// long recordings on the path that is known to handle them. The duration is only known when the
// caller passes `durationHintSec`; an upload with no known length is sent to the worker, and the
// worker's own time limit plus the attempt timeout below bound how long it can hold the request
// before the fallback runs.
const LONG_INPUT_SECONDS = 55 * 60;

const warned = new Set();
function warnOnce(key, message, meta) {
  if (warned.has(key)) return;
  warned.add(key);
  logger.warn(message, meta);
}

function selectProvider(env = process.env) {
  const raw = (env.STT_PROVIDER || '').trim().toLowerCase();
  if (raw === '' || raw === 'deepgram') return 'deepgram';
  if (raw === 'readaloud') return 'readaloud';
  warnOnce(`unknown:${raw}`, 'STT_PROVIDER has an unknown value; using deepgram', { value: raw.slice(0, 40) });
  return 'deepgram';
}

function callDeepgram(opts) {
  const { durationHintSec, ...rest } = opts; // routing hint only; Deepgram gets what it always got
  return deepgram.transcribeAudio(rest);
}

/**
 * @param {{ body: Buffer, mimeType: string, durationHintSec?: number|null,
 *           backoffMs?: number, attemptTimeoutMs?: number, sleep?: Function }} opts
 * @returns {Promise<{text, durationSec, detectedLanguage, languageConfidence, providerStatus, attempts}>}
 */
async function transcribeAudio(opts) {
  if (selectProvider() !== 'readaloud') return callDeepgram(opts);

  const hint = Number(opts.durationHintSec);
  if (Number.isFinite(hint) && hint > LONG_INPUT_SECONDS) return callDeepgram(opts);

  const cfg = readaloud.readConfig();
  if (!cfg) {
    warnOnce('readaloud-config', 'STT_PROVIDER=readaloud but READALOUD_STT_URL or READALOUD_STT_TOKEN is missing or invalid; using deepgram');
    return callDeepgram(opts);
  }

  let reason;
  let status = null;
  try {
    const out = await readaloud.transcribe({ body: opts.body, mimeType: opts.mimeType }, cfg);
    if (out.text && out.text.trim().length > 0) return out;
    // Empty transcript. If the audio really is silent, that is the answer; otherwise ask Deepgram.
    const level = await measureLevel(opts.body);
    if (level && level.silent) return out;
    reason = 'empty transcript for non-silent audio';
    status = out.providerStatus;
  } catch (e) {
    reason = e instanceof readaloud.ReadaloudError ? e.reason : `unexpected ${(e && e.name) || 'error'}`;
    status = e instanceof readaloud.ReadaloudError ? e.status : null;
  }

  logger.warn(`STT readaloud failed (${reason}); falling back to deepgram for this request`, {
    reason,
    providerStatus: status,
    fileBytes: opts.body ? opts.body.length : null,
  });
  return callDeepgram(opts);
}

function resetWarningsForTests() {
  warned.clear();
}

module.exports = { transcribeAudio, selectProvider, LONG_INPUT_SECONDS, resetWarningsForTests };
