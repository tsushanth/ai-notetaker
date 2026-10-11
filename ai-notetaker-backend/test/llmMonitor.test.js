const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecorder, instrument, probeOnce } = require('../src/services/llmMonitor');

const mkRecorder = (extra = {}) => {
  const inserted = [];
  let clock = 1_000_000;
  const rec = createRecorder({ insert: async (rows) => { inserted.push(...rows); }, now: () => (clock += 5), batch: 1000, ...extra });
  return { rec, inserted };
};
const fakeClient = (impl) => ({ messages: { create: impl } });

test('a successful call is recorded with model, latency and token counts, and the caller gets the very same result', async () => {
  const { rec, inserted } = mkRecorder();
  const result = { model: 'claude-sonnet-4-6', usage: { input_tokens: 120, output_tokens: 40 }, content: [{ text: 'SECRET COMPLETION' }] };
  const client = fakeClient(async () => result);
  instrument(client, rec);
  const got = await client.messages.create({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'SECRET PROMPT' }] });
  assert.equal(got, result);
  await new Promise((r) => setImmediate(r));
  await rec.flush();
  assert.equal(inserted.length, 1);
  const row = inserted[0];
  assert.deepEqual([row.ok, row.model, row.input_tokens, row.output_tokens, row.source], [true, 'claude-sonnet-4-6', 120, 40, 'live']);
  assert.ok(row.latency_ms >= 0);
  assert.equal(JSON.stringify(inserted).includes('SECRET'), false, 'no prompt or completion text is ever stored');
});

test('a failed call is recorded with status, type and a trimmed message, and the caller still sees the original error', async () => {
  const { rec, inserted } = mkRecorder();
  const err = Object.assign(new Error('Overloaded ' + 'x'.repeat(500)), { status: 529, error: { error: { type: 'overloaded_error' } } });
  const client = fakeClient(async () => { throw err; });
  instrument(client, rec);
  await assert.rejects(() => client.messages.create({ model: 'm' }), (e) => e === err);
  await new Promise((r) => setImmediate(r));
  await rec.flush();
  const row = inserted[0];
  assert.deepEqual([row.ok, row.status, row.error_type], [false, 529, 'overloaded_error']);
  assert.ok(row.error_message.length <= 200);
});

test('a synchronous throw is recorded and rethrown', async () => {
  const { rec, inserted } = mkRecorder();
  const client = fakeClient(() => { throw Object.assign(new TypeError('bad params'), {}); });
  instrument(client, rec);
  assert.throws(() => client.messages.create({}), /bad params/);
  await rec.flush();
  assert.equal(inserted[0].ok, false); assert.equal(inserted[0].error_type, 'TypeError');
});

test('the SDK promise is returned untouched, so helper methods on it keep working, and a rejection raises no unhandled error', async () => {
  const { rec } = mkRecorder();
  const p = Promise.reject(Object.assign(new Error('nope'), { status: 401 }));
  p.withResponse = () => 'helper';
  const client = fakeClient(() => p);
  instrument(client, rec);
  const out = client.messages.create({});
  assert.equal(out, p); assert.equal(out.withResponse(), 'helper');
  await assert.rejects(out);
});

test('a failing database write drops the batch and never throws into the request path', async () => {
  const logs = [];
  const rec = createRecorder({ insert: async () => { throw new Error('db down'); }, log: (m) => logs.push(m), batch: 1000 });
  rec.record({ ok: true }); rec.record({ ok: false });
  await rec.flush();
  assert.equal(rec.pending(), 0);
  assert.match(logs[0], /dropped/);
});

test('the buffer is capped and the oldest rows go first', () => {
  const rec = createRecorder({ insert: async () => {}, maxBuffer: 3, batch: 1000 });
  for (let i = 0; i < 5; i++) rec.record({ n: i });
  assert.equal(rec.pending(), 3);
});

test('reaching the batch size flushes without waiting for the timer', async () => {
  const inserted = [];
  const rec = createRecorder({ insert: async (rows) => { inserted.push(...rows); }, batch: 2 });
  rec.record({ n: 1 }); assert.equal(inserted.length, 0);
  rec.record({ n: 2 }); await rec.flush(); await new Promise((r) => setImmediate(r));
  assert.equal(inserted.length, 2);
});

test('a probe is recorded as source "probe", for success and failure, and a failure does not throw', async () => {
  const { rec, inserted } = mkRecorder();
  const okRow = await probeOnce({ original: async () => ({ model: 'm', usage: { input_tokens: 5, output_tokens: 1 } }), recorder: rec, model: 'm' });
  const badRow = await probeOnce({ original: async () => { throw Object.assign(new Error('rate'), { status: 429 }); }, recorder: rec, model: 'm' });
  assert.deepEqual([okRow.source, okRow.ok, badRow.source, badRow.ok, badRow.status], ['probe', true, 'probe', false, 429]);
  assert.equal(inserted.length, 2);
});
