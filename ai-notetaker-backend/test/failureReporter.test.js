const test = require('node:test');
const assert = require('node:assert/strict');

// Reporter enabled for this file (it is disabled when NODE_ENV=test); fetch is replaced so nothing leaves the machine.
process.env.NODE_ENV = 'production';
process.env.FAILURE_REPORTER_FORCE = '1'; // the reporter is also off under the node test runner; this file stubs fetch itself
const sent = [];
global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; };
process.env.FAILURE_REPORTER_KEY = 'test-report-key'; // the key comes from the environment only
const fr = require('../src/utils/failureReporter');
const flush = () => new Promise((r) => setImmediate(r));

test('reportCounted: first event reports, repeats in the window only count, next window carries the count', async () => {
  fr._resetCountedForTests();
  const t0 = 1_000_000;
  assert.equal(fr.reportCounted('f', 'Fixed message', { a: '1' }, 1000, t0), true);
  assert.equal(fr.reportCounted('f', 'Fixed message', { a: '1' }, 1000, t0 + 10), false);
  assert.equal(fr.reportCounted('f', 'Fixed message', { a: '1' }, 1000, t0 + 20), false);
  assert.equal(fr.reportCounted('f', 'Fixed message', { a: '1' }, 1000, t0 + 2000), true);
  await flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].kind, 'failure');
  assert.equal(sent[0].context.count_prev_window, '0');
  assert.equal(sent[1].context.count_prev_window, '3');
});

test('reportCounted: different messages are independent classes', () => {
  fr._resetCountedForTests();
  assert.equal(fr.reportCounted('f', 'A', {}, 1000, 5), true);
  assert.equal(fr.reportCounted('f', 'B', {}, 1000, 5), true);
});

test('reportUnreportedServerError: pages a direct 5xx once, uses the route pattern, skips 4xx, health and already-reported', async () => {
  sent.length = 0;
  const req = { method: 'POST', originalUrl: '/api/recordings/abc-123?token=secret', baseUrl: '/api/recordings', route: { path: '/:id' }, path: '/abc-123' };
  const res = { statusCode: 500, locals: {} };
  fr.reportUnreportedServerError(req, res);
  fr.reportUnreportedServerError(req, res); // second call: already flagged
  fr.reportUnreportedServerError(req, { statusCode: 404, locals: {} });
  fr.reportUnreportedServerError({ ...req, originalUrl: '/health' }, { statusCode: 503, locals: {} });
  fr.reportUnreportedServerError(req, { statusCode: 500, locals: { failureReported: true } });
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'backend_error');
  assert.equal(sent[0].flow, 'POST /api/recordings/:id');
  assert.ok(!JSON.stringify(sent[0]).includes('abc-123'));
  assert.ok(!JSON.stringify(sent[0]).includes('secret'));
});

test('reportBackendError flags the response so the safety net does not double-report', async () => {
  sent.length = 0;
  const res = { statusCode: 500, locals: {} };
  const req = { method: 'GET', path: '/x', res };
  fr.reportBackendError(req, new Error('boom'), 500);
  fr.reportUnreportedServerError({ ...req, originalUrl: '/x' }, res);
  await flush();
  assert.equal(sent.length, 1);
});

test('reportFailure/reportCounted never throw when fetch rejects', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  fr._resetCountedForTests();
  assert.doesNotThrow(() => fr.reportCounted('f', 'x', {}));
  assert.doesNotThrow(() => fr.reportFailure('f', new Error('x')));
  await flush();
});
