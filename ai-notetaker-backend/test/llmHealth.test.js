const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, percentile, liveStatus } = require('../src/services/llmHealth');

const NOW = Date.parse('2026-10-10T12:00:00Z');
const min = (m) => new Date(NOW - m * 60_000).toISOString();
const row = (m, over = {}) => ({ ts: min(m), source: 'live', model: 'claude-sonnet-4-6', ok: true, status: null, error_type: null, error_message: null, latency_ms: 1000, input_tokens: 100, output_tokens: 50, ...over });
const bad = (m, over = {}) => row(m, { ok: false, status: 529, error_type: 'overloaded_error', error_message: 'Overloaded', latency_ms: 200, input_tokens: null, output_tokens: null, ...over });

test('percentile uses nearest rank and is null for no data', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([10, 1, 5, 3], 95), 10);
});

test('all recent calls succeeding is ok', () => {
  const s = liveStatus([row(1), row(2), row(3), row(5)], NOW);
  assert.equal(s.status, 'ok');
});

test('half or more of at least three recent calls failing is down', () => {
  assert.equal(liveStatus([bad(1), bad(2), row(3)], NOW).status, 'down');
  assert.equal(liveStatus([bad(1), bad(2), bad(3), row(4)], NOW).status, 'down');
});

test('a smaller share of failures is degraded, not down', () => {
  const rows = [bad(1), ...Array.from({ length: 7 }, (_, i) => row(2 + i))]; // 1 of 8 = 12.5%
  assert.equal(liveStatus(rows, NOW).status, 'degraded');
});

test('one failure among fewer than three calls is degraded, never down (small samples are noisy)', () => {
  assert.equal(liveStatus([bad(1)], NOW).status, 'degraded');
  assert.equal(liveStatus([bad(1), row(2)], NOW).status, 'degraded');
});

test('under 10 percent failures is still ok', () => {
  const rows = [bad(1), ...Array.from({ length: 19 }, (_, i) => row(2 + (i % 12)))]; // 5%
  assert.equal(liveStatus(rows, NOW).status, 'ok');
});

test('very slow successes are degraded', () => {
  const rows = [row(1, { latency_ms: 45_000 }), row(2, { latency_ms: 44_000 }), row(3, { latency_ms: 46_000 })];
  assert.equal(liveStatus(rows, NOW).status, 'degraded');
});

test('calls older than 15 minutes do not decide the live status; a fresh probe stands in', () => {
  assert.equal(liveStatus([bad(30), bad(40), bad(50), row(20, { source: 'probe' })], NOW).status, 'ok');
  assert.equal(liveStatus([row(20, { source: 'probe', ok: false, status: 401 })], NOW).status, 'down');
});

test('nothing recent at all is unknown', () => {
  assert.equal(liveStatus([row(300)], NOW).status, 'unknown');
  assert.equal(liveStatus([], NOW).status, 'unknown');
});

test('summarize: totals, success rate, latency, tokens and cost for the window only', () => {
  const rows = [row(1, { latency_ms: 1000 }), row(2, { latency_ms: 3000 }), bad(3), row(60 * 30) /* 30 h ago, outside 24 h */];
  const s = summarize(rows, { now: NOW, hours: 24, pricing: { 'claude-sonnet-4-6': { input: 0.003, output: 0.015 } } });
  assert.deepEqual([s.totals.calls, s.totals.ok, s.totals.failed], [3, 2, 1]);
  assert.ok(Math.abs(s.totals.successRate - 2 / 3) < 1e-9);
  assert.deepEqual([s.latency.p50, s.latency.max], [1000, 3000]);
  assert.deepEqual([s.tokens.input, s.tokens.output], [200, 100]);
  assert.equal(s.tokens.estCostUsd, 0.0021); // 200/1000*0.003 + 100/1000*0.015
});

test('summarize: errors are grouped by status and type, most frequent first, with the last time seen', () => {
  const rows = [bad(5), bad(10), bad(1, { status: 429, error_type: 'rate_limit_error' }), bad(20, { status: null, error_type: 'APIConnectionError' })];
  const s = summarize(rows, { now: NOW, hours: 1 });
  assert.deepEqual(s.errors.map((e) => [e.status, e.error_type, e.count]), [[529, 'overloaded_error', 2], [429, 'rate_limit_error', 1], [null, 'APIConnectionError', 1]]);
  assert.equal(s.errors[0].lastTs, min(5));
});

test('summarize: last success, last failure and last probe come from the newest matching rows', () => {
  const rows = [row(30), row(5), bad(9), bad(2, { error_message: 'newest failure' }), row(7, { source: 'probe', latency_ms: 700 })];
  const s = summarize(rows, { now: NOW, hours: 24 });
  assert.equal(s.lastSuccess.ts, min(5));
  assert.equal(s.lastFailure.error_message, 'newest failure');
  assert.deepEqual([s.lastProbe.source, s.lastProbe.latency_ms], ['probe', 700]);
});

test('summarize: per-model breakdown and hourly series', () => {
  const rows = [row(10), row(20, { model: 'claude-haiku-4-5-20251001' }), bad(30, { model: 'claude-haiku-4-5-20251001' }), row(90)];
  const s = summarize(rows, { now: NOW, hours: 24 });
  const haiku = s.byModel.find((m) => m.model === 'claude-haiku-4-5-20251001');
  assert.deepEqual([haiku.calls, haiku.failed], [2, 1]);
  assert.equal(s.series.reduce((a, b) => a + b.ok + b.failed, 0), 4);
  assert.ok(s.series.length >= 2);
});

test('summarize: latency uses live traffic when there is any, so a probe does not skew it', () => {
  const rows = [row(5, { latency_ms: 2000 }), row(6, { source: 'probe', latency_ms: 90_000 })];
  assert.equal(summarize(rows, { now: NOW, hours: 24 }).latency.max, 2000);
});

test('summarize: an empty window gives null rates and no crash', () => {
  const s = summarize([], { now: NOW, hours: 24 });
  assert.deepEqual([s.totals.calls, s.totals.successRate, s.latency.p50, s.status], [0, null, null, 'unknown']);
});
