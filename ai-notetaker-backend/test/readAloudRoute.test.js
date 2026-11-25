// POST /api/tts/generate: still-running, failed and welcome-note answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();

const { TtsError } = require('../src/utils/ttsError');
let behaviour;
const full = require.resolve(path.join(__dirname, '..', 'src', 'services', 'ttsService.js'));
require.cache[full] = { id: full, filename: full, loaded: true, exports: {
  generateForNote: (...a) => behaviour(...a), getTTSForNote: async () => null, getVoices: () => [], synthesize: async () => { throw new TtsError('NOTHING_TO_READ'); },
} };
const app = h.makeApp({ '/api/tts': require('../src/routes/tts') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());
test.beforeEach(() => h.resetDb());

const generate = (note_id, headers) => fetch(`http://127.0.0.1:${server.address().port}/api/tts/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': 'u-route', ...headers }, body: JSON.stringify({ note_id }),
}).then(async (r) => ({ status: r.status, body: await r.json(), retryAfter: r.headers.get('retry-after') }));

test('success keeps the response shape the apps read', async () => {
  behaviour = async () => ({ audio_url: 'https://x/a.mp3', voice: 'nova', speed: 1, duration_seconds: 3 });
  const r = await generate('route-ok');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { audio_url: 'https://x/a.mp3', voice: 'nova', speed: 1, duration_seconds: 3 });
});

test('still generating: 503 with Retry-After, and the retry that joins gets the audio without a second job', async () => {
  let release; let calls = 0;
  const gate = new Promise((r) => { release = r; });
  behaviour = async () => { calls += 1; await gate; return { audio_url: 'late', voice: 'nova', speed: 1, duration_seconds: 9 }; };
  const first = await generate('route-slow', { 'x-tts-wait-ms': '20' });
  assert.equal(first.status, 503);
  assert.equal(first.body.code, 'TTS_STILL_GENERATING');
  assert.equal(first.retryAfter, '30');
  const retry = generate('route-slow', { 'x-tts-wait-ms': '2000' });
  setTimeout(release, 30);
  assert.equal((await retry).body.data.audio_url, 'late');
  assert.equal(calls, 1);
});

test('a missing welcome-note copy is a named 404, not a 500', async () => {
  behaviour = async () => { throw new TtsError('NOTE_NOT_FOUND'); };
  const r = await generate('00000000-0000-0000-0000-000000000001');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'LOCAL_ONLY_NOTE');
});

test('provider detail is never echoed to the client', async () => {
  behaviour = async () => { throw new Error('Kokoro secret internal detail'); };
  const r = await generate('route-err');
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /Kokoro|internal/);
});
