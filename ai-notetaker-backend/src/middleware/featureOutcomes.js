/**
 * One row per user request: which feature, how it ended, the status and how long it took. Written when the response is
 * done AND when the caller gives up before that (a phone that stopped waiting never produces a 'finish' event, so slow
 * failures used to leave no trace). public.feature_outcomes + view feature_health (scripts/feature-outcomes-migration.sql)
 * let one query cover every feature; services/featureHealth.js runs it.
 *
 * Stored: route pattern (ids replaced), outcome, status, duration, client kind, account id. Never bodies or query strings.
 * Rows are buffered and written in batches; a failed write (including a missing table) drops the batch and nothing else.
 */
const { createRecorder } = require('../services/llmMonitor');
const { reportCounted } = require('../utils/failureReporter');

const TRACKED = /^\/(api|v1\/webhooks)\//;
const IGNORED = /^\/api\/(analytics|config|alerts|admin)(\/|$)/;
const ABANDONED_REPORT_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id, token or code rather than a route word. */
const looksLikeId = (s) => UUID.test(s) || /^\d+$/.test(s) || (s.length >= 12 && /\d/.test(s)) || s.length > 32;

/** "POST /api/ai/summary", "GET /api/notes/:id". */
function featureName(method, url) {
  const path = String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
  return `${method} ${path.split('/').map((s) => (looksLikeId(s) ? ':id' : s)).join('/')}`.slice(0, 120);
}

/** ok | pending | denied | limit | client_error | server_error | abandoned */
function outcomeOf({ status, abandoned, declared }) {
  if (declared) return declared;
  if (abandoned) return 'abandoned';
  if (status < 400) return 'ok';
  if (status === 401 || status === 402 || status === 403) return 'denied';
  if (status === 429) return 'limit';
  return status < 500 ? 'client_error' : 'server_error';
}

function clientKind(userAgent) {
  const ua = String(userAgent || '');
  if (/okhttp/i.test(ua)) return 'android';
  if (/CFNetwork|Darwin/i.test(ua)) return 'ios';
  if (/Mozilla/i.test(ua)) return 'web';
  return 'other';
}

function defaultInsert() {
  return async (rows) => {
    const { supabaseAdmin } = require('../config/supabase');
    const { error } = await supabaseAdmin.from('feature_outcomes').insert(rows);
    if (error) throw new Error(error.message);
  };
}

let lastLogged = 0;
function createFeatureOutcomes({ insert, now = Date.now, log = (m) => console.warn(`[feature-outcomes] ${m}`), env = process.env } = {}) {
  const enabled = env.FEATURE_OUTCOMES_DISABLED !== '1';
  const recorder = createRecorder({
    insert: insert || defaultInsert(),
    now,
    // A missing table would otherwise log every flush.
    log: (m) => { if (now() - lastLogged > 3600_000) { lastLogged = now(); log(m.replace('llm_calls', 'feature_outcomes')); } },
  });

  function middleware(req, res, next) {
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (!enabled || req.method === 'OPTIONS' || !TRACKED.test(path) || IGNORED.test(path)) return next();
    const started = now();
    res.once('close', () => {
      try {
        const abandoned = !res.writableFinished;
        // An unknown address (scanners) is not a feature.
        if (!abandoned && res.statusCode === 404 && !req.route) return;
        const feature = featureName(req.method, path);
        const status = res.headersSent ? res.statusCode : null;
        const duration = Math.max(0, now() - started);
        const outcome = outcomeOf({ status: res.statusCode, abandoned, declared: res.locals?.outcome });
        recorder.record({
          ts: new Date(started).toISOString(),
          feature,
          outcome,
          status,
          duration_ms: duration,
          client: clientKind(req.headers['user-agent']),
          // Not for the deletion request itself: the account it names is gone.
          user_id: feature.endsWith('/delete-account') ? null : (UUID.test(req.userId || '') ? req.userId : null),
        });
        if (outcome === 'abandoned' && duration >= ABANDONED_REPORT_MS) {
          reportCounted('request_abandoned', `Client gave up waiting: ${feature}`, { seconds: String(Math.round(duration / 1000)) });
        }
      } catch (e) { log(`could not record a request: ${e.message}`); }
    });
    next();
  }

  const timer = setInterval(() => recorder.flush(), 10_000);
  timer.unref?.();
  return { middleware, recorder, flush: () => recorder.flush() };
}

let shared = null;
const featureOutcomes = () => (shared ||= createFeatureOutcomes());

module.exports = { featureOutcomes, createFeatureOutcomes, featureName, outcomeOf, clientKind };
