/**
 * Scheduled-job endpoints: only the shared secret CRON_SECRET_TOKEN opens them, sent as "Authorization: Bearer <token>"
 * or "x-cron-token: <token>". Scheduler marker headers (x-cloudscheduler, x-appengine-cron) prove nothing here: on this
 * host any caller can set them. With no secret configured the endpoints are closed.
 */
const { adminSecretMatches } = require('./adminSecret');
const { logger } = require('../utils/logger');

function cronAuth(req, res, next) {
  const expected = process.env.CRON_SECRET_TOKEN;
  if (!expected) return res.status(503).json({ success: false, error: 'Scheduled jobs are disabled (CRON_SECRET_TOKEN is not configured)' });
  const header = String(req.headers.authorization || '');
  const provided = req.headers['x-cron-token'] || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (adminSecretMatches(provided, expected)) return next();
  logger.warn('Unauthorized cron request', { path: req.baseUrl + req.path });
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

module.exports = { cronAuth };
