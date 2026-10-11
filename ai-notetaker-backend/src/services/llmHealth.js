// Turns rows from public.llm_calls into what the admin page shows. Pure: no I/O, so it can be tested with plain arrays.

const RECENT_MS = 15 * 60_000;      // the window that decides the live status
const PROBE_FRESH_MS = 60 * 60_000; // a probe this recent can stand in when there has been no traffic

/** Nearest-rank percentile of a numeric array (null for an empty one). */
function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

const t = (r) => Date.parse(r.ts);
const pick = (r) => r && { ts: r.ts, source: r.source, ok: r.ok, status: r.status, error_type: r.error_type, error_message: r.error_message, latency_ms: r.latency_ms, model: r.model };

/** 'ok' | 'degraded' | 'down' | 'unknown', with a plain-language reason. */
function liveStatus(rows, now) {
  const recent = rows.filter((r) => now - t(r) <= RECENT_MS);
  if (recent.length) {
    const failed = recent.filter((r) => !r.ok).length;
    const rate = failed / recent.length;
    const p95 = percentile(recent.filter((r) => r.ok && r.latency_ms != null).map((r) => r.latency_ms), 95);
    if (recent.length >= 3 && rate >= 0.5) return { status: 'down', reason: `${failed} of the last ${recent.length} calls in 15 minutes failed` };
    if (failed > 0 && (recent.length < 3 || rate >= 0.1)) return { status: 'degraded', reason: `${failed} of ${recent.length} calls failed in the last 15 minutes` };
    if (p95 != null && p95 > 30_000) return { status: 'degraded', reason: `slow: 95th percentile ${Math.round(p95 / 1000)} s over the last 15 minutes` };
    return { status: 'ok', reason: `${recent.length - failed} of ${recent.length} calls succeeded in the last 15 minutes` };
  }
  const probes = rows.filter((r) => r.source === 'probe' && now - t(r) <= PROBE_FRESH_MS).sort((a, b) => t(b) - t(a));
  if (probes.length) return probes[0].ok ? { status: 'ok', reason: 'no traffic lately; the last probe succeeded' } : { status: 'down', reason: 'no traffic lately and the last probe failed' };
  return { status: 'unknown', reason: 'no calls or probes in the last hour' };
}

function summarize(rows, { now = Date.now(), hours = 24, pricing = {} } = {}) {
  const since = now - hours * 3_600_000;
  const inWindow = rows.filter((r) => t(r) >= since && t(r) <= now + 60_000);
  const sorted = [...inWindow].sort((a, b) => t(b) - t(a)); // newest first
  const ok = inWindow.filter((r) => r.ok);
  const failed = inWindow.filter((r) => !r.ok);
  const live = inWindow.filter((r) => r.source === 'live');
  const latOf = (list) => list.filter((r) => r.ok && r.latency_ms != null).map((r) => r.latency_ms);
  const lat = latOf(live).length ? latOf(live) : latOf(inWindow);

  const models = {};
  let inTok = 0, outTok = 0, cost = 0;
  for (const r of inWindow) {
    const m = (models[r.model || 'unknown'] ||= { model: r.model || 'unknown', calls: 0, failed: 0, lat: [] });
    m.calls++; if (!r.ok) m.failed++; else if (r.latency_ms != null) m.lat.push(r.latency_ms);
    if (r.ok) {
      inTok += r.input_tokens || 0; outTok += r.output_tokens || 0;
      const pr = pricing[r.model];
      if (pr?.input != null) cost += ((r.input_tokens || 0) / 1000) * pr.input + ((r.output_tokens || 0) / 1000) * pr.output;
    }
  }

  const errors = {};
  for (const r of failed) {
    const key = `${r.status ?? 'no response'} ${r.error_type || 'Error'}`;
    const e = (errors[key] ||= { status: r.status ?? null, error_type: r.error_type || 'Error', count: 0, lastTs: r.ts });
    e.count++; if (t(r) > Date.parse(e.lastTs)) e.lastTs = r.ts;
  }

  // Hourly buckets for up to 48 hours, daily beyond that.
  const bucketMs = hours <= 48 ? 3_600_000 : 86_400_000;
  const buckets = new Map();
  for (const r of inWindow) {
    const k = Math.floor(t(r) / bucketMs) * bucketMs;
    const b = buckets.get(k) || { ts: new Date(k).toISOString(), ok: 0, failed: 0 };
    r.ok ? b.ok++ : b.failed++; buckets.set(k, b);
  }

  const { status, reason } = liveStatus(rows, now);
  return {
    hours,
    status, statusReason: reason,
    totals: { calls: inWindow.length, ok: ok.length, failed: failed.length, successRate: inWindow.length ? ok.length / inWindow.length : null, live: live.length, probes: inWindow.length - live.length },
    latency: { p50: percentile(lat, 50), p95: percentile(lat, 95), max: lat.length ? Math.max(...lat) : null },
    tokens: { input: inTok, output: outTok, estCostUsd: Math.round(cost * 10_000) / 10_000 },
    byModel: Object.values(models).map((m) => ({ model: m.model, calls: m.calls, failed: m.failed, p50: percentile(m.lat, 50), p95: percentile(m.lat, 95) })).sort((a, b) => b.calls - a.calls),
    errors: Object.values(errors).sort((a, b) => b.count - a.count),
    series: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b),
    lastSuccess: pick(sorted.find((r) => r.ok)),
    lastFailure: pick(sorted.find((r) => !r.ok)),
    lastProbe: pick(sorted.find((r) => r.source === 'probe')),
  };
}

module.exports = { summarize, percentile, liveStatus, RECENT_MS };
