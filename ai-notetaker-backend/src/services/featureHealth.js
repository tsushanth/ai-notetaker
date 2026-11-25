/**
 * The one scheduled check over public.feature_health: for every feature, did the people who tried it get what they asked
 * for? Hourly; one report per failing feature per day. Limits, paywalls and sign-in refusals are not counted as attempts.
 */
const { logger } = require('../utils/logger');
const { reportFailure, heartbeat } = require('../utils/failureReporter');

const HOUR = 3600_000;
const CFG = { intervalMs: HOUR, firstPassMs: 5 * 60_000, cooldownMs: 24 * HOUR, minWeek: 3, minDay: 5, minDayOkRate: 0.5 };

/** rows: the feature_health view. Returns [{feature, code, attempts, ok}]. */
function evaluate(rows) {
  const out = [];
  for (const r of rows || []) {
    const week = { attempts: Number(r.attempts_7d) || 0, ok: Number(r.ok_7d) || 0 };
    const day = { attempts: Number(r.attempts_24h) || 0, ok: Number(r.ok_24h) || 0 };
    if (week.attempts >= CFG.minWeek && week.ok === 0) out.push({ feature: r.feature, code: 'NO_SUCCESS_7D', ...week });
    else if (day.attempts >= CFG.minDay && day.ok / day.attempts < CFG.minDayOkRate) out.push({ feature: r.feature, code: 'LOW_SUCCESS_24H', ...day });
  }
  return out;
}

const lastReported = new Map();

async function checkFeatureHealth({ db, now = Date.now() } = {}) {
  try {
    const client = db || require('../config/supabase').supabaseAdmin;
    const { data, error } = await client.from('feature_health').select('*');
    if (error) { logger.warn('Feature health check could not read feature_health', { error: error.message }); return null; }
    const failing = evaluate(data);
    for (const f of failing) {
      const key = `${f.feature}|${f.code}`;
      if (lastReported.has(key) && now - lastReported.get(key) < CFG.cooldownMs) continue;
      lastReported.set(key, now);
      void reportFailure('feature_health', new Error(`Feature failing (${f.code}): ${f.feature}`), { code: f.code, attempts: String(f.attempts), ok: String(f.ok) });
    }
    heartbeat('feature-health');
    return failing;
  } catch (e) {
    logger.error('Feature health check threw', { error: e.message });
    return null;
  }
}

let timer = null;
function startFeatureHealth(env = process.env) {
  if (timer || env.FEATURE_HEALTH_DISABLED === '1' || env.NODE_ENV === 'test' || env.NODE_ENV === 'development') return false;
  setTimeout(() => { void checkFeatureHealth(); }, CFG.firstPassMs).unref();
  timer = setInterval(() => { void checkFeatureHealth(); }, CFG.intervalMs);
  timer.unref();
  return true;
}

module.exports = { evaluate, checkFeatureHealth, startFeatureHealth, CFG };
