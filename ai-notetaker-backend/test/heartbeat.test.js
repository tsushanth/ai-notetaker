const test = require('node:test');
const assert = require('node:assert/strict');
process.env.FAILURE_REPORTER_KEY = 'test-key';
process.env.FAILURE_REPORTER_FORCE = '1';
delete process.env.FAILURE_REPORTER_DISABLED;

test('heartbeat posts the metric the reporter watches, at most once every few minutes per job', async () => {
  const sent = [];
  global.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), key: init.headers['X-Report-Key'] }); return new Response(null, { status: 204 }); };
  const { heartbeat } = require('../src/utils/failureReporter');
  assert.equal(await heartbeat('meeting-sweeper', 0), true);
  assert.equal(await heartbeat('meeting-sweeper', 60_000), false);
  assert.equal(await heartbeat('llm-probe', 60_000), true);
  assert.equal(await heartbeat('meeting-sweeper', 300_000), true);
  assert.match(sent[0].url, /\/v1\/usage$/);
  assert.deepEqual(sent[0].body, { metric: 'heartbeat.meeting-sweeper', value: 1 });
  assert.equal(sent[0].key, 'test-key');
});
