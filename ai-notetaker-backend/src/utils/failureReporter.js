/**
 * Sends backend failures to the unified app-failure-reporter Worker (dedupes and emails).
 * Fire-and-forget: never throws, never blocks a request. Set FAILURE_REPORTER_DISABLED=1 to silence (tests/dev).
 * Never pass user content (transcripts, note text, emails) as message or context.
 */
const ENDPOINT = process.env.FAILURE_REPORTER_URL || 'https://app-failure-reporter.t-sushanth.workers.dev/v1/report';
const KEY = process.env.FAILURE_REPORTER_KEY || ''; // env only: no built-in fallback (this file is in a public repo)
const APP_VERSION = process.env.FLY_IMAGE_REF || process.env.K_REVISION || process.env.npm_package_version || 'unknown';
const DISABLED = !KEY || process.env.FAILURE_REPORTER_DISABLED === '1' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || (!!process.env.NODE_TEST_CONTEXT && process.env.FAILURE_REPORTER_FORCE !== '1'); // node --test exports NODE_TEST_CONTEXT and sets no NODE_ENV: never post test errors to the production reporter (a test that stubs fetch can set FAILURE_REPORTER_FORCE=1)
if (!KEY && process.env.NODE_ENV === 'production' && !process.env.NODE_TEST_CONTEXT) console.warn('failureReporter: FAILURE_REPORTER_KEY is not set, failure reports are disabled');

async function post(kind, flow, err, context, timeoutMs) {
  if (DISABLED) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Report-Key': KEY },
      body: JSON.stringify({ kind, platform: 'backend', version: APP_VERSION, flow, message: e.message || e.name, stack: e.stack ?? '', context }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { /* reporting must never cause a failure of its own */ }
}

/** Login and signup failures page on their own: the flow is prefixed so the subject stands out from other 5xx noise. */
const isAuthPath = (req) => /^\/api\/auth(\/|$|\?)/.test(req.originalUrl || req.baseUrl || req.path || '');
const flowFor = (req) => (isAuthPath(req) ? 'AUTH ' : '') + `${req.method} ${routeLabel(req)}`;

/** A handled server error (5xx). Path only: never log query strings, they can carry tokens. */
function reportBackendError(req, err, statusCode) {
  if (statusCode < 500) return;
  // Mark the response so the res.finish safety net (reportUnreportedServerError) does not report it twice.
  if (req.res && req.res.locals) req.res.locals.failureReported = true;
  void post('backend_error', isAuthPath(req) ? flowFor(req) : `${req.method} ${req.path ?? ''}`, err, { status: String(statusCode) }, 5000);
}

/** Route pattern (e.g. /api/recordings/:id), never the concrete URL: no ids, no query string. */
function routeLabel(req) {
  const pattern = req.route && req.route.path ? `${req.baseUrl || ''}${typeof req.route.path === 'string' ? req.route.path : ''}` : '';
  return pattern || req.baseUrl || req.path || '';
}

/**
 * Safety net for handlers that answer 5xx directly (res.status(500).json(...)) and so never reach the
 * error middleware. Call from a res 'finish' hook; no-op when errorHandler already reported it.
 * Health endpoints are skipped (the Worker probes them itself).
 */
function reportUnreportedServerError(req, res) {
  if (res.statusCode < 500 || (res.locals && res.locals.failureReported)) return;
  if ((req.originalUrl || '').startsWith('/health')) return;
  if (res.locals) res.locals.failureReported = true;
  void post('backend_error', flowFor(req), new Error(`HTTP ${res.statusCode} returned without an exception`), { status: String(res.statusCode) }, 5000);
}

// key -> { windowStart, count }. Per-process; resets on restart, which only means one extra email.
const counted = new Map();
const COUNTED_WINDOW_MS = 24 * 3600 * 1000;

/**
 * Rate-limited signal for events that are expected to be rare but are not per-request pages
 * (free-tier 429s, rejected uploads). The first event in a window reports immediately; later ones
 * only increment a counter that is attached to the next window's first report (`count_prev_window`).
 * `message` must be a fixed string per class. Returns true when a report was sent.
 */
function reportCounted(flow, message, context = {}, windowMs = COUNTED_WINDOW_MS, now = Date.now()) {
  const key = `${flow}|${message}`;
  const e = counted.get(key);
  if (e && now - e.windowStart < windowMs) { e.count += 1; return false; }
  const prev = e ? e.count : 0;
  counted.set(key, { windowStart: now, count: 1 });
  void post('failure', flow, new Error(message), { ...context, count_prev_window: String(prev) }, 5000);
  return true;
}
function _resetCountedForTests() { counted.clear(); }

/** A background job or flow failed (worker, queue, cron). */
function reportFailure(flow, err, context = {}) {
  void post('failure', flow, err, context, 5000);
}

/** Process is about to die: await this before process.exit so the email actually goes out. */
function reportCrash(flow, err) {
  return post('crash', flow, err, {}, 2500);
}

module.exports = { reportBackendError, reportUnreportedServerError, reportFailure, reportCounted, reportCrash, routeLabel, _resetCountedForTests };
