const test = require('node:test');
const assert = require('node:assert/strict');

// The reporter must work from the environment only: no key built into the (public) source, and it must stay silent without one.
process.env.NODE_ENV = 'production';
process.env.FAILURE_REPORTER_FORCE = '1';
const REPORTER = require.resolve('../src/utils/failureReporter');
const load = (key) => {
  delete require.cache[REPORTER];
  if (key === undefined) delete process.env.FAILURE_REPORTER_KEY; else process.env.FAILURE_REPORTER_KEY = key;
  return require('../src/utils/failureReporter');
};
const flush = () => new Promise((r) => setImmediate(r));

test('no FAILURE_REPORTER_KEY: reporting is off and nothing leaves the process', async () => {
  const calls = [];
  global.fetch = async (...a) => { calls.push(a); return { ok: true }; };
  const fr = load(undefined);
  fr.reportFailure('f', new Error('x'));
  fr.reportUnreportedServerError({ method: 'GET', originalUrl: '/api/x', path: '/x' }, { statusCode: 500, locals: {} });
  await fr.reportCrash('c', new Error('y'));
  await flush();
  assert.equal(calls.length, 0);
});

test('the key sent is the one from the environment', async () => {
  const calls = [];
  global.fetch = async (url, opts) => { calls.push(opts.headers['X-Report-Key']); return { ok: true }; };
  const fr = load('env-supplied-key');
  fr.reportFailure('f', new Error('x'));
  await flush();
  assert.deepEqual(calls, ['env-supplied-key']);
});

test('the source file contains no built-in report key', () => {
  const src = require('node:fs').readFileSync(REPORTER, 'utf8');
  assert.doesNotMatch(src, /afr_[0-9a-f]{8}/);
});

test('5xx on login and signup routes are labelled AUTH so they stand out; other routes are unchanged', async () => {
  const sent = [];
  global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; };
  const fr = load('k');
  fr.reportUnreportedServerError({ method: 'POST', originalUrl: '/api/auth/google', baseUrl: '/api/auth', route: { path: '/google' }, path: '/google' }, { statusCode: 500, locals: {} });
  fr.reportBackendError({ method: 'POST', originalUrl: '/api/auth/login', baseUrl: '/api/auth', route: { path: '/login' }, path: '/login', res: { locals: {} } }, new Error('boom'), 500);
  fr.reportUnreportedServerError({ method: 'POST', originalUrl: '/api/recordings/abc', baseUrl: '/api/recordings', route: { path: '/:id' }, path: '/abc' }, { statusCode: 500, locals: {} });
  fr.reportBackendError({ method: 'GET', originalUrl: '/api/notes', baseUrl: '/api/notes', path: '/', res: { locals: {} } }, new Error('x'), 500);
  await flush();
  assert.equal(sent[0].flow, 'AUTH POST /api/auth/google');
  assert.equal(sent[1].flow, 'AUTH POST /api/auth/login');
  assert.equal(sent[2].flow, 'POST /api/recordings/:id');
  assert.equal(sent[3].flow, 'GET /');
});
