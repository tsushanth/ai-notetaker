const test = require('node:test');
const assert = require('node:assert/strict');

// Regression: plain `node --test` sets neither NODE_ENV=test nor FAILURE_REPORTER_DISABLED, and the reporter has a
// built-in production URL and key, so a stray report call in any test used to email the owner a fake error.
test('under node --test the reporter never posts to the production endpoint', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'sanity: running under the node test runner');
  delete process.env.NODE_ENV;
  delete process.env.FAILURE_REPORTER_DISABLED;
  delete process.env.FAILURE_REPORTER_FORCE;
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (...a) => { calls.push(a); return { ok: true }; };
  try {
    const fr = require('../src/utils/failureReporter');
    fr.reportFailure('x', new Error('must not leave the process'));
    fr.reportCrash(new Error('must not leave the process either'));
    await new Promise((r) => setTimeout(r, 20));
  } finally { globalThis.fetch = real; }
  assert.equal(calls.length, 0, 'no network call to the reporter');
});
