// Admin-only product and LLM health. All routes need a valid sign-in (401 otherwise, so the web app can send the user back to
// login) and an allowlisted email (404 otherwise). Read-only except POST /llm-probe, which makes one tiny provider request.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { supabaseAdmin } = require('../config/supabase');
const { PRICING } = require('../config/openai');
const { logger } = require('../utils/logger');
const { getMonitor } = require('../services/llmMonitor');
const { summarize } = require('../services/llmHealth');
const { loadStats, attentionItems, fetchAll } = require('../services/adminStats');

const router = express.Router();
router.use(authenticate, adminOnly);

const clamp = (v, lo, hi, dflt) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || dflt));

async function loadLlm(hours) {
  const from = new Date(Date.now() - Math.max(hours, 1) * 3_600_000).toISOString();
  const rows = await fetchAll(supabaseAdmin, 'llm_calls', 'ts,source,model,ok,status,error_type,error_message,latency_ms,input_tokens,output_tokens', (q) => q.gte('ts', from));
  return summarize(rows, { hours, pricing: PRICING });
}

router.get('/llm-health', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ success: true, data: await loadLlm(clamp(req.query.hours, 1, 720, 24)) });
  } catch (e) {
    logger.error('admin llm-health failed', { error: e.message });
    res.status(500).json({ success: false, error: 'Could not load LLM health' });
  }
});

router.post('/llm-probe', async (req, res) => {
  const monitor = getMonitor();
  if (!monitor) return res.status(503).json({ success: false, error: 'LLM monitor is not running' });
  try {
    const row = await monitor.probe();
    res.json({ success: true, data: { ok: row.ok, latencyMs: row.latency_ms, status: row.status, errorType: row.error_type } });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Probe failed to run' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const data = await loadStats({ db: supabaseAdmin, days: clamp(req.query.days, 7, 90, 30) });
    res.set('Cache-Control', 'no-store').json({ success: true, data });
  } catch (e) {
    logger.error('admin stats failed', { error: e.message });
    res.status(500).json({ success: false, error: 'Could not load stats' });
  }
});

// One call for the page: product usage, LLM health, system checks and what needs attention.
router.get('/overview', async (req, res) => {
  const days = clamp(req.query.days, 7, 90, 30);
  const hours = clamp(req.query.hours, 1, 720, 24);
  const dbStart = Date.now();
  const [statsR, llmR, dbR] = await Promise.allSettled([
    loadStats({ db: supabaseAdmin, days }),
    loadLlm(hours),
    supabaseAdmin.from('notes').select('id', { head: true, count: 'exact' }).limit(1),
  ]);
  const dbOk = dbR.status === 'fulfilled' && !dbR.value.error;
  const stats = statsR.status === 'fulfilled' ? statsR.value : null;
  const llm = llmR.status === 'fulfilled' ? llmR.value : null;
  const checks = [
    { name: 'API', level: 'ok', detail: `up ${Math.round(process.uptime() / 60)} min on this machine` },
    { name: 'Database', level: dbOk ? 'ok' : 'down', detail: dbOk ? 'reachable' : 'query failed', ms: Date.now() - dbStart },
    llm
      ? { name: 'LLM provider (Claude)', level: { ok: 'ok', degraded: 'warn', down: 'down', unknown: 'off' }[llm.status], detail: llm.statusReason, ms: llm.latency.p50 ?? undefined }
      : { name: 'LLM provider (Claude)', level: 'off', detail: 'health data unavailable (is the llm_calls table there?)' },
  ];
  if (!stats) logger.error('admin overview: stats failed', { error: statsR.reason?.message });
  if (!llm) logger.error('admin overview: llm failed', { error: llmR.reason?.message });
  res.set('Cache-Control', 'no-store').json({
    success: true,
    data: { checks, stats, llm, attention: attentionItems({ recordings: stats?.recordings, llm, signupsByDay: stats?.users?.signupsByDay }) },
  });
});

module.exports = router;
