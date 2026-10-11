const test = require('node:test');
const assert = require('node:assert/strict');
const { labelMethods } = require('../src/utils/llmFeatures');
const { createLlmUsage } = require('../src/utils/llmUsage');

test('labelMethods runs the named methods inside a feature label, keeps `this`, return values and async behaviour, and skips unknown names', async () => {
  const seen = [];
  const withFeature = (f, fn) => { seen.push(f); return fn(); };
  class Svc { constructor() { this.n = 2; } async summary(x) { return x * this.n; } sync() { return 'ok'; } }
  const svc = labelMethods(new Svc(), { summary: 'summary', sync: 'sync', missing: 'nope' }, withFeature);
  assert.equal(await svc.summary(21), 42); assert.equal(svc.sync(), 'ok');
  assert.deepEqual(seen, ['summary', 'sync']);
});

test('end to end: a labelled method makes the instrumented client report that feature, with tokens and cost', async () => {
  const sent = [];
  const llm = createLlmUsage({ app: 'scribeai', key: 'k', url: 'https://w.test', flushMs: 0, now: () => Date.parse('2026-10-11T12:00:00Z'), fetch: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true, status: 204 }; } });
  const client = { messages: { create: async () => ({ model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 100 } }) } };
  llm.instrument(client);
  const svc = labelMethods({ async quiz() { return client.messages.create({ model: 'claude-sonnet-4-6' }); } }, { quiz: 'quiz' }, (f, fn) => llm.withFeature(f, fn));
  await svc.quiz(); await new Promise((r) => setImmediate(r)); await llm.flush();
  const item = sent[0].items[0];
  assert.deepEqual([item.feature, item.model, item.input_tokens, item.output_tokens], ['quiz', 'claude-sonnet-4-6', 1000, 100]);
  assert.ok(Math.abs(item.cost_usd - (1000 * 3 + 100 * 15) / 1e6) < 1e-9);
});
