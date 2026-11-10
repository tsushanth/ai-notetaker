'use strict';
/**
 * Server-driven feature flags. Every flag is OFF unless its environment variable says otherwise, so an unset or
 * misspelled variable hides the feature. Clients read the current values from GET /api/config/features and the server
 * refuses the gated routes while a flag is off.
 *
 *   flag          environment variable     what it gates
 *   phone_calls   FEATURE_PHONE_CALLS      /api/phone (the Phone Call feature)
 *   learn         FEATURE_LEARN            /api/learn (except the worker webhooks) and the /learn page
 *   create        FEATURE_CREATE           /api/create and the /create page
 *   compete       FEATURE_COMPETE          /api/compete and the /compete and /compete-create pages
 *
 * To switch one on: `flyctl secrets set FEATURE_LEARN=1 -a ai-notetaker-backend` (or [env] in fly.toml). Values read
 * as on: 1, true, on, yes. The environment is read at request time, so tests and a restart both see changes.
 */
const FLAG_ENV = Object.freeze({
  phone_calls: 'FEATURE_PHONE_CALLS',
  learn: 'FEATURE_LEARN',
  create: 'FEATURE_CREATE',
  compete: 'FEATURE_COMPETE',
});

const ON = new Set(['1', 'true', 'on', 'yes']);

function isEnabled(flag, env = process.env) {
  const name = FLAG_ENV[flag];
  if (!name) return false;
  return ON.has(String(env[name] || '').trim().toLowerCase());
}

function snapshot(env = process.env) {
  return Object.fromEntries(Object.keys(FLAG_ENV).map((flag) => [flag, isEnabled(flag, env)]));
}

/**
 * Express middleware: lets the request through only while `flag` is on.
 *   page: true  -> plain 404 (it is an HTML page, a browser or WebView should just see "not found")
 *   except      -> a RegExp tested against req.path; matching paths are never gated (worker callbacks)
 */
function requireFeature(flag, { page = false, except = null } = {}) {
  return (req, res, next) => {
    if (except && except.test(req.path)) return next();
    if (isEnabled(flag)) return next();
    if (page) return res.status(404).type('text/plain').send('Not found');
    return res.status(404).json({ success: false, code: 'FEATURE_DISABLED', error: 'This feature is not available.' });
  };
}

module.exports = { FLAG_ENV, isEnabled, snapshot, requireFeature };
