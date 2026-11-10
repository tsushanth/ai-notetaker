const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DEEPGRAM_API_KEY = 'dg-test-key';
process.env.DEEPGRAM_RETRY_BACKOFF_MS = '0';

const logs = [];
const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((l) => [l, (msg, meta) => logs.push({ l, msg, meta })]));
let levelImpl = async () => null;
function stub(rel, exports) {
  const abs = require.resolve(rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}
stub('../src/utils/logger', { logger });
stub('../src/utils/audioLevel', { measureLevel: (b) => levelImpl(b) });

const seam = require('../src/services/stt');
const deepgramClient = require('../src/services/deepgramClient');

// The request the recording pipeline has always sent to Deepgram, written out literally.
const OLD_URL = 'https://api.deepgram.com/v1/listen?model=nova-2&detect_language=true&smart_format=true';
const WORKER = 'https://stt.example.test';
const TOKEN = 'worker-secret-token';
const SPEECH = 'hello from the recording';

const dgBody = ({ text = SPEECH, duration = 12.4, lang = 'en', conf = 0.98 } = {}) => JSON.stringify({
  metadata: { duration },
  results: { channels: [{ detected_language: lang, language_confidence: conf, alternatives: [{ transcript: text }] }] },
});
const workerBody = ({ text = SPEECH, duration = 12.4, lang = 'en', prob = 0.9712 } = {}) => JSON.stringify({
  metadata: { duration, stt_ext: { language: lang, language_probability: prob } },
  results: { channels: [{ detected_language: lang, alternatives: [{ transcript: text }] }] },
});
const respond = (status, body = '{}') => new Response(body, { status });

let calls;
function mockFetch(handler) {
  calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
}
const isWorker = (url) => url.startsWith(WORKER);
const BODY = Buffer.from('audio-bytes');

function reset(env = {}) {
  for (const k of ['STT_PROVIDER', 'READALOUD_STT_URL', 'READALOUD_STT_TOKEN', 'READALOUD_STT_TIMEOUT_MS']) delete process.env[k];
  Object.assign(process.env, env);
  logs.length = 0;
  levelImpl = async () => null;
  seam.resetWarningsForTests();
}
const readaloudEnv = { STT_PROVIDER: 'readaloud', READALOUD_STT_URL: WORKER, READALOUD_STT_TOKEN: TOKEN };
const warnings = () => logs.filter((x) => x.l === 'warn');

test('default: no env var set -> request and result identical to the Deepgram client', async () => {
  reset();
  mockFetch(() => respond(200, dgBody()));
  const viaSeam = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4', durationHintSec: 600 });
  const seamCall = calls[0];
  assert.equal(calls.length, 1);

  mockFetch(() => respond(200, dgBody()));
  const direct = await deepgramClient.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
  const directCall = calls[0];

  assert.equal(seamCall.url, OLD_URL);
  assert.equal(seamCall.url, directCall.url);
  assert.equal(seamCall.init.method, 'POST');
  assert.deepEqual(seamCall.init.headers, { Authorization: 'Token dg-test-key', 'Content-Type': 'audio/mp4' });
  assert.deepEqual(seamCall.init.headers, directCall.init.headers);
  assert.equal(seamCall.init.body, BODY, 'body is the same buffer, passed through untouched');
  assert.equal(seamCall.init.body, directCall.init.body);
  assert.ok(seamCall.init.signal, 'request has a timeout signal');
  assert.deepEqual(Object.keys(seamCall.init).sort(), Object.keys(directCall.init).sort());
  assert.deepEqual(viaSeam, direct);
  assert.deepEqual(viaSeam, { text: SPEECH, durationSec: 12.4, detectedLanguage: 'en', languageConfidence: 0.98, providerStatus: 200, attempts: 1 });
  assert.equal(warnings().length, 0);
});

test('default: explicit STT_PROVIDER=deepgram and an empty value behave the same', async () => {
  for (const v of ['deepgram', ' Deepgram ', '']) {
    reset({ ...readaloudEnv, STT_PROVIDER: v });
    mockFetch(() => respond(200, dgBody()));
    const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mpeg' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, OLD_URL);
    assert.equal(out.text, SPEECH);
  }
});

test('default path keeps the Deepgram retry and error contract', async () => {
  reset();
  mockFetch((u, i, n) => (n === 1 ? respond(503, 'busy') : respond(200, dgBody())));
  const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
  assert.equal(calls.length, 2); assert.equal(out.attempts, 2);

  mockFetch(() => respond(400, 'bad'));
  await assert.rejects(seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' }), (e) => e.code === 'PROVIDER_ERROR' && e.dbMessage === 'PROVIDER_ERROR: Deepgram HTTP 400');
  assert.equal(calls.length, 1);
});

test('unknown STT_PROVIDER value warns once and uses Deepgram', async () => {
  reset({ STT_PROVIDER: 'whisperx', ...{ READALOUD_STT_URL: WORKER, READALOUD_STT_TOKEN: TOKEN } });
  mockFetch(() => respond(200, dgBody()));
  await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
  await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.url === OLD_URL));
  assert.equal(warnings().length, 1);
  assert.match(warnings()[0].msg, /unknown value/);
});

test('readaloud selected without URL or token warns once and uses Deepgram', async () => {
  for (const env of [{ STT_PROVIDER: 'readaloud' }, { STT_PROVIDER: 'readaloud', READALOUD_STT_URL: WORKER }, { STT_PROVIDER: 'readaloud', READALOUD_STT_URL: 'not a url', READALOUD_STT_TOKEN: TOKEN }]) {
    reset(env);
    mockFetch(() => respond(200, dgBody()));
    await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
    await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
    assert.ok(calls.every((c) => c.url === OLD_URL));
    assert.equal(warnings().length, 1);
  }
});

test('readaloud success: one request to the worker, Deepgram-compatible options, bearer token, no Deepgram call', async () => {
  reset({ ...readaloudEnv, READALOUD_STT_URL: `${WORKER}/` });
  mockFetch(() => respond(200, workerBody({ lang: 'en', prob: 0.9712 })));
  const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4', durationHintSec: 600 });
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, `${WORKER}/v1/listen`);
  assert.equal(u.searchParams.get('detect_language'), 'true');
  assert.equal(u.searchParams.get('smart_format'), 'true');
  assert.equal(u.searchParams.get('model'), 'nova-2');
  assert.equal(u.searchParams.get('diarize'), 'false');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'audio/mp4' });
  assert.equal(calls[0].init.body, BODY);
  assert.ok(calls[0].init.signal);
  assert.deepEqual(out, { text: SPEECH, durationSec: 12.4, detectedLanguage: 'en', languageConfidence: 0.97, providerStatus: 200, attempts: 1 });
  assert.equal(warnings().length, 0);
});

test('readaloud 5xx, 4xx, timeout, network error, bad JSON and odd shape all fall back to Deepgram with one warning line', async () => {
  const failures = {
    '503': () => respond(503, 'busy'),
    '401': () => respond(401, 'no'),
    timeout: () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
    network: () => { throw new TypeError('fetch failed'); },
    badjson: () => respond(200, 'not json'),
    shape: () => respond(200, '{"hello":1}'),
  };
  for (const [name, fail] of Object.entries(failures)) {
    reset(readaloudEnv);
    mockFetch((url) => (isWorker(url) ? fail() : respond(200, dgBody({ text: 'from deepgram' }))));
    const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
    assert.equal(out.text, 'from deepgram', name);
    assert.equal(calls.length, 2, name);
    assert.ok(isWorker(calls[0].url) && calls[1].url === OLD_URL, name);
    const w = warnings();
    assert.equal(w.length, 1, name);
    assert.match(w[0].msg, /^STT readaloud failed \(.+\); falling back to deepgram for this request$/);
    assert.ok(!w[0].msg.includes('\n'));
    const logged = JSON.stringify(logs);
    assert.ok(!logged.includes(TOKEN) && !logged.includes(WORKER) && !logged.includes('audio-bytes'), `${name}: no token, URL or audio in logs`);
  }
});

test('readaloud empty transcript for audio that is not silent falls back; unknown level also falls back', async () => {
  for (const level of [{ silent: false, peakDb: -10, meanDb: -30 }, null]) {
    reset(readaloudEnv);
    levelImpl = async () => level;
    mockFetch((url) => (isWorker(url) ? respond(200, workerBody({ text: '  ' })) : respond(200, dgBody({ text: 'from deepgram' }))));
    const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
    assert.equal(out.text, 'from deepgram');
    assert.equal(calls.length, 2);
    assert.match(warnings()[0].msg, /empty transcript for non-silent audio/);
  }
});

test('readaloud empty transcript for silent audio is returned as is, with no Deepgram call', async () => {
  reset(readaloudEnv);
  levelImpl = async () => ({ silent: true, peakDb: -91, meanDb: -91 });
  mockFetch(() => respond(200, workerBody({ text: '' })));
  const out = await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' });
  assert.equal(out.text, '');
  assert.equal(calls.length, 1);
  assert.equal(warnings().length, 0);
});

test('if the worker fails and Deepgram fails too, the Deepgram error reaches the caller', async () => {
  reset(readaloudEnv);
  mockFetch((url) => (isWorker(url) ? respond(500) : respond(400, 'bad')));
  await assert.rejects(seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4' }), { code: 'PROVIDER_ERROR', dbMessage: 'PROVIDER_ERROR: Deepgram HTTP 400' });
});

test('long input (known duration over 55 minutes) goes to Deepgram without touching the worker', async () => {
  reset(readaloudEnv);
  mockFetch(() => respond(200, dgBody()));
  await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4', durationHintSec: seam.LONG_INPUT_SECONDS + 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OLD_URL);
  assert.equal(warnings().length, 0);

  // At exactly the limit, and with no known duration, the worker is still tried.
  for (const hint of [seam.LONG_INPUT_SECONDS, undefined, null]) {
    mockFetch((url) => (isWorker(url) ? respond(200, workerBody()) : respond(200, dgBody())));
    await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4', durationHintSec: hint });
    assert.ok(isWorker(calls[0].url));
  }
});

test('Deepgram receives exactly the arguments it always got; the duration hint stays in the seam', async () => {
  reset();
  const original = deepgramClient.transcribeAudio;
  const seen = [];
  deepgramClient.transcribeAudio = async (args) => { seen.push(args); return { text: 'x', durationSec: 1, detectedLanguage: null, languageConfidence: null, providerStatus: 200, attempts: 1 }; };
  try {
    await seam.transcribeAudio({ body: BODY, mimeType: 'audio/mp4', durationHintSec: 99999 });
  } finally {
    deepgramClient.transcribeAudio = original;
  }
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['body', 'mimeType']);
  assert.equal(seen[0].body, BODY);
  assert.equal(seen[0].mimeType, 'audio/mp4');
});
