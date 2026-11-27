/**
 * Released Android apps treat every answer that is not 2xx as "Failed to process video", including "still writing the
 * transcript" (409 TRANSCRIPT_PENDING). For them the request is kept open until the work ends: 201 and a space at once,
 * a space often enough that the app's 60 second read timeout never passes, then the normal JSON body (leading white space
 * is still valid JSON). The status is already sent, so a failure cuts the connection, which the app reports as a failure.
 * A client that handles 409 TRANSCRIPT_PENDING itself says so with the header "x-accepts-pending: 1".
 */
const { logger } = require('./logger');

const BEAT_MS = 15_000;

/** True for a client that would show "still writing" as a failure. */
const showsPendingAsFailure = (req) => /okhttp/i.test(String(req.get('user-agent') || '')) && !req.get('x-accepts-pending');

async function answerWhenDone(res, work, { beatMs = BEAT_MS } = {}) {
  res.status(201);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-transform');
  const beat = () => { if (!res.writableEnded && !res.destroyed) res.write(' '); };
  beat();
  const timer = setInterval(beat, beatMs);
  res.once('close', () => clearInterval(timer));
  try {
    const data = await work();
    if (!res.destroyed) res.end(JSON.stringify({ success: true, data }));
  } catch (error) {
    res.locals.outcome = error.publicCode === 'TRANSCRIPT_PENDING' ? 'pending'
      : (error.statusCode || 500) < 500 ? 'client_error' : 'server_error';
    logger.warn('Held request ended without a result', { code: error.publicCode || error.statusCode || 'INTERNAL' });
    res.destroy();
  } finally {
    clearInterval(timer);
  }
}

module.exports = { answerWhenDone, showsPendingAsFailure, BEAT_MS };
