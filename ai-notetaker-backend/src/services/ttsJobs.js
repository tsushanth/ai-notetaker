/**
 * Read Aloud generation as a job that outlives the request.
 *
 * A long note takes longer than a phone waits for one HTTP answer. The job keeps running after the caller has gone, saves
 * the audio, and ends in exactly one of two ways: a saved file, or one failure report. A second request for the same
 * audio (the apps retry on their own, or the user taps again) joins the running job instead of starting another.
 * Another voice or speed of a note that is already being made waits its turn: side by side they take twice as long, and
 * the older one could finish last and replace the newer saved audio.
 * Jobs live in this process: a request that lands on another machine starts its own, and a shutdown reports them.
 */
const { logger } = require('../utils/logger');
const { reportFailure } = require('../utils/failureReporter');
const { TtsError } = require('../utils/ttsError');

const DEFAULT_WAIT_MS = 100_000; // below the 120 s read timeout of released Android apps
const MAX_WAIT_MS = 280_000;

const jobs = new Map();
const key = (userId, noteId, voice = 'nova', speed = 1.0) => `${userId}|${noteId}|${voice}|${parseFloat(speed) || 1}`;

function report(job, code, workerStatus) {
  return reportFailure('tts_failed', new Error(`Read Aloud failed: ${code}`), {
    code,
    chars: String(job.stats.chars),
    pieces: String(job.stats.pieces),
    seconds: String(Math.round((Date.now() - job.startedAt) / 1000)),
    worker_status: String(workerStatus ?? 'none'),
  });
}

const isRunning = (userId, noteId, voice, speed) => jobs.has(key(userId, noteId, voice, speed));

/** Start (or join) the job. The returned promise resolves to the saved audio or rejects with a TtsError. */
function start(ttsService, userId, noteId, { voice = 'nova', speed = 1.0 } = {}) {
  const k = key(userId, noteId, voice, speed);
  const running = jobs.get(k);
  if (running) return running.promise;
  const note = `${userId}|${noteId}`;
  const ahead = [...jobs.values()].filter((j) => j.note === note).map((j) => j.promise);
  const job = { note, startedAt: Date.now(), stats: { chars: 0, pieces: 0 } };
  jobs.set(k, job);
  job.promise = Promise.allSettled(ahead)
    .then(() => ttsService.generateForNote(userId, noteId, { voice, speed: parseFloat(speed), stats: job.stats }))
    .catch((err) => {
      const e = err instanceof TtsError ? err : new TtsError('INTERNAL', err.message);
      logger.error('TTS generation error', { code: e.code, error: e.message, userId, noteId });
      void report(job, e.code, e.workerStatus);
      throw e;
    })
    .finally(() => jobs.delete(k));
  job.promise.catch(() => {}); // already reported above; nobody may be waiting any more
  return job.promise;
}

/** Wait up to `waitMs` for the job. Resolves { done: false } if it is still running (it keeps running). */
function wait(promise, waitMs) {
  let timer;
  const pending = new Promise((resolve) => { timer = setTimeout(() => resolve({ done: false }), waitMs); });
  return Promise.race([promise.then((result) => ({ done: true, result })), pending]).finally(() => clearTimeout(timer));
}

/** The client may say how long it will wait (newer apps allow more); anything unusable gets the default. */
function waitBudgetMs(header, env = process.env) {
  const asked = Number(header);
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, MAX_WAIT_MS);
  const configured = Number(env.TTS_WAIT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WAIT_MS;
}

/** Called on shutdown: every job still running will be lost, so say so. */
function reportInterrupted() {
  return Promise.all([...jobs.values()].map((job) => report(job, 'INTERRUPTED')));
}

module.exports = { start, wait, isRunning, waitBudgetMs, reportInterrupted, DEFAULT_WAIT_MS, MAX_WAIT_MS };
