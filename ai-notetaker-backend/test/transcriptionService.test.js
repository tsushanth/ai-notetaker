const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DEEPGRAM_API_KEY = 'test-key';
process.env.DEEPGRAM_RETRY_BACKOFF_MS = '0';

// ---- stubs injected before the service is loaded (no Supabase/Anthropic/network needed) ----
const logs = [];
const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((l) => [l, (msg, meta) => logs.push({ l, msg, meta })]));
const reports = [];
let db;
let downloadImpl;
const notes = [];

function stub(rel, exports) {
  const abs = require.resolve(rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}
stub('../src/utils/logger', { logger });
stub('../src/config/supabase', { supabase: {}, supabaseAdmin: { from: (t) => db.from(t) } });
stub('../src/utils/failureReporter', { reportFailure: (...a) => { reports.push(a); }, reportBackendError() {}, reportCrash() {} });
stub('../src/config/openai', { MODELS: {} });
stub('../src/services/noteService', { createNote: async (uid, n) => { notes.push({ uid, n }); return { id: 'note-1' }; } });
stub('../src/services/storageService', { downloadFile: (p) => downloadImpl(p) });

const service = require('../src/services/transcriptionService');
const { AppError } = require('../src/middleware/errorHandler');

const SECRET = 'my private dentist appointment is on tuesday';
const REC_ID = 'rec-123';

function makeDb(recording, { failUpdates = 0 } = {}) {
  const updates = [];
  let failures = failUpdates;
  return {
    updates,
    from() {
      let mode = 'select';
      const b = {
        select: () => b,
        eq: () => b,
        update: (patch) => { mode = 'update'; updates.push(patch); return b; },
        single: () => Promise.resolve(mode === 'select'
          ? (recording ? { data: recording, error: null } : { data: null, error: { message: 'nf' } })
          : { data: {}, error: null }),
        then: (res, rej) => Promise.resolve(
          mode === 'update' && patchFails() ? { error: { message: 'db down' } } : { error: null }
        ).then(res, rej),
      };
      function patchFails() { if (failures > 0 && updates[updates.length - 1]?.status === 'failed') { failures--; return true; } return false; }
      return b;
    },
  };
}

const baseRecording = (over = {}) => ({ id: REC_ID, user_id: 'u1', status: 'uploaded', storage_path: 'u1/a.m4a', format: 'm4a', file_size: 241664, title: 'T', file_url: 'http://x', ...over });
const dgBody = ({ text = SECRET, duration = 12.4, lang = 'en', conf = 0.98, omitLang = false } = {}) => JSON.stringify({
  metadata: { duration },
  results: { channels: [{ ...(omitLang ? {} : { detected_language: lang, language_confidence: conf }), alternatives: [{ transcript: text }] }] },
});
const respond = (status, body = '{}') => new Response(body, { status });

let fetchCalls;
function mockFetch(...steps) {
  fetchCalls = [];
  global.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    const step = steps[Math.min(fetchCalls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  };
}

function setup(recording = baseRecording(), opts) {
  logs.length = 0; notes.length = 0; reports.length = 0;
  db = makeDb(recording, opts);
  downloadImpl = async () => Buffer.from('audio-bytes');
}
const lastUpdate = () => db.updates[db.updates.length - 1];
const outcomeLog = () => logs.find((x) => x.msg === 'transcription_outcome')?.meta;

test('English audio: same result shape, note and row as before; request uses nova-2 + detection, not pinned en', async () => {
  setup();
  mockFetch(respond(200, dgBody()));
  const out = await service.transcribeRecording('u1', REC_ID);
  assert.deepEqual(out, { recording_id: REC_ID, transcription: SECRET, duration: 12, status: 'completed', note_id: 'note-1' });
  assert.equal(notes[0].n.content, SECRET);
  assert.deepEqual(lastUpdate(), { transcription: SECRET, duration: 12, status: 'completed', note_id: 'note-1' });
  const { url, init } = fetchCalls[0];
  assert.match(url, /model=nova-2/); assert.match(url, /detect_language=true/); assert.match(url, /smart_format=true/);
  assert.doesNotMatch(url, /language=en/);
  assert.equal(init.headers.Authorization, 'Token test-key'); assert.equal(init.headers['Content-Type'], 'audio/mp4');
  assert.ok(init.signal, 'request has a timeout signal');
  assert.equal(fetchCalls.length, 1);
});

test('non-English audio is transcribed and the detected language is logged, not an error', async () => {
  setup();
  mockFetch(respond(200, dgBody({ text: 'hallo welt', lang: 'de', conf: 0.9712 })));
  const out = await service.transcribeRecording('u1', REC_ID);
  assert.equal(out.status, 'completed'); assert.equal(out.transcription, 'hallo welt');
  const o = outcomeLog();
  assert.equal(o.outcome, 'completed'); assert.equal(o.detectedLanguage, 'de'); assert.equal(o.languageConfidence, 0.97);
  assert.equal(o.fileSize, Buffer.from('audio-bytes').length); assert.equal(o.providerStatus, 200); assert.equal(o.durationSec, 12.4);
});

test('missing detection/metadata fields are tolerated', async () => {
  setup();
  mockFetch(respond(200, JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'hi' }] }] } })));
  const out = await service.transcribeRecording('u1', REC_ID);
  assert.equal(out.status, 'completed'); assert.equal(out.duration, 0);
  assert.equal(outcomeLog().detectedLanguage, null);
});

test('empty transcript: 422 + same user message, row failed, duration kept, NO_SPEECH facts in error_message', async () => {
  setup();
  downloadImpl = async () => Buffer.alloc(241664);
  mockFetch(respond(200, dgBody({ text: '', duration: 12.2, lang: 'ar', conf: 0.91 })));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), (e) => {
    assert.ok(e instanceof AppError); assert.equal(e.statusCode, 422); assert.equal(e.message, 'No speech detected in the recording'); return true;
  });
  assert.deepEqual(lastUpdate(), { status: 'failed', error_message: 'NO_SPEECH: audio 12s, detected language ar (confidence 0.91), file 236 KB', duration: 12 });
  assert.equal(notes.length, 0);
  assert.equal(outcomeLog().outcome, 'failed'); assert.equal(outcomeLog().errorCode, 'NO_SPEECH');
});

test('empty transcript with no detection info says unknown', async () => {
  setup();
  mockFetch(respond(200, JSON.stringify({ metadata: { duration: 0.4 }, results: { channels: [{ alternatives: [{ transcript: '  ' }] }] } })));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 422 });
  assert.match(lastUpdate().error_message, /^NO_SPEECH: audio 0\.4s, detected language unknown, file /);
  assert.equal(lastUpdate().duration, 0);
});

test('transient 503 then success retries exactly once and completes', async () => {
  setup();
  mockFetch(respond(503, 'busy'), respond(200, dgBody()));
  const out = await service.transcribeRecording('u1', REC_ID);
  assert.equal(out.status, 'completed'); assert.equal(fetchCalls.length, 2);
  assert.equal(outcomeLog().attempts, 2);
});

test('429 is retried; a second 503 gives PROVIDER_ERROR after exactly two calls', async () => {
  setup();
  mockFetch(respond(429), respond(503));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  assert.equal(fetchCalls.length, 2);
  assert.equal(lastUpdate().status, 'failed'); assert.equal(lastUpdate().error_message, 'PROVIDER_ERROR: Deepgram HTTP 503');
});

test('400 is not retried and is recorded as PROVIDER_ERROR', async () => {
  setup();
  mockFetch(respond(400, 'bad audio'));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(lastUpdate(), { status: 'failed', error_message: 'PROVIDER_ERROR: Deepgram HTTP 400' });
  assert.equal(outcomeLog().providerStatus, 400);
});

test('network error is retried once; success after it completes', async () => {
  setup();
  mockFetch(new TypeError('fetch failed'), respond(200, dgBody()));
  assert.equal((await service.transcribeRecording('u1', REC_ID)).status, 'completed');
  assert.equal(fetchCalls.length, 2);
});

test('provider timeout (both tries) gives PROVIDER_TIMEOUT and a failed row', async () => {
  setup();
  mockFetch(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  assert.equal(fetchCalls.length, 2);
  assert.equal(lastUpdate().status, 'failed'); assert.match(lastUpdate().error_message, /^PROVIDER_TIMEOUT: /);
});

test('storage failure -> DOWNLOAD_FAILED, empty file -> EMPTY_FILE, both leave the row failed, neither calls Deepgram', async () => {
  setup(); mockFetch(respond(200, dgBody()));
  downloadImpl = async () => { throw new AppError('Failed to download file', 500); };
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500, message: 'Failed to download file' });
  assert.match(lastUpdate().error_message, /^DOWNLOAD_FAILED: Failed to download file/); assert.equal(lastUpdate().status, 'failed');

  setup(); downloadImpl = async () => Buffer.alloc(0);
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  assert.match(lastUpdate().error_message, /^EMPTY_FILE: /);
  assert.equal(fetchCalls.length, 0);
});

test('unexpected error after transcription (note creation) still ends failed with error_message', async () => {
  setup(); mockFetch(respond(200, dgBody()));
  const noteSvc = require('../src/services/noteService');
  const orig = noteSvc.createNote; noteSvc.createNote = async () => { throw new Error('db exploded'); };
  try {
    await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  } finally { noteSvc.createNote = orig; }
  assert.equal(lastUpdate().status, 'failed'); assert.equal(lastUpdate().error_message, 'INTERNAL_ERROR: db exploded'); assert.equal(lastUpdate().duration, 12);
});

test('if writing the failure fails once, it is retried so the row does not stay processing', async () => {
  setup(baseRecording(), { failUpdates: 1 }); mockFetch(respond(400));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 });
  assert.equal(db.updates.filter((u) => u.status === 'failed').length, 2);
});

test('recording not found: 404 and no row is touched', async () => {
  setup(null); mockFetch(respond(200, dgBody()));
  await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 404 });
  assert.equal(db.updates.length, 0);
});

test('already completed recordings are returned without calling Deepgram', async () => {
  setup(baseRecording({ status: 'completed', transcription: 'x', duration: 3, note_id: 'n' })); mockFetch(respond(200, dgBody()));
  assert.equal((await service.transcribeRecording('u1', REC_ID)).transcription, 'x');
  assert.equal(fetchCalls.length, 0);
});

test('no temp file is written for the recording (success and failure)', async () => {
  const leftover = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`audio_${REC_ID}`));
  setup(); mockFetch(respond(200, dgBody())); await service.transcribeRecording('u1', REC_ID); assert.deepEqual(leftover(), []);
  setup(); mockFetch(respond(503)); await assert.rejects(service.transcribeRecording('u1', REC_ID)); assert.deepEqual(leftover(), []);
});

test('no transcript text reaches any log line or the stored error_message, on success or failure', async () => {
  setup(); mockFetch(respond(200, dgBody())); await service.transcribeRecording('u1', REC_ID);
  assert.ok(!JSON.stringify(logs).includes('dentist'), 'success logs');
  setup(); mockFetch(respond(200, dgBody({ text: '' })));
  await assert.rejects(service.transcribeRecording('u1', REC_ID));
  assert.ok(!JSON.stringify(logs).includes('dentist'));
  setup(); mockFetch(respond(500, SECRET)); // provider echoing text in an error body must not be stored/logged
  await assert.rejects(service.transcribeRecording('u1', REC_ID));
  assert.ok(!JSON.stringify(logs).includes('dentist')); assert.ok(!JSON.stringify(db.updates).includes('dentist'));
});

test('failure reporter: called once per failed recording with a stable message, the right code and only non-content context', async () => {
  const cases = [
    ['NO_SPEECH', () => mockFetch(respond(200, dgBody({ text: '', lang: 'ar', conf: 0.9 })))],
    ['PROVIDER_ERROR', () => mockFetch(respond(400, SECRET))],
    ['PROVIDER_TIMEOUT', () => mockFetch(Object.assign(new Error('t'), { name: 'TimeoutError' }))],
    ['DOWNLOAD_FAILED', () => { mockFetch(respond(200, dgBody())); downloadImpl = async () => { throw new AppError('Failed to download file', 500); }; }],
    ['EMPTY_FILE', () => { mockFetch(respond(200, dgBody())); downloadImpl = async () => Buffer.alloc(0); }],
  ];
  for (const [code, arrange] of cases) {
    setup(); arrange();
    await assert.rejects(service.transcribeRecording('u1', REC_ID));
    assert.equal(reports.length, 1, code);
    const [flow, err, ctx] = reports[0];
    assert.equal(flow, 'recording_failed'); assert.equal(err.message, `Recording ${code}`); assert.equal(ctx.code, code);
    assert.deepEqual(Object.keys(ctx).sort(), ['audio_seconds', 'code', 'detected_language', 'file_kb', 'provider_status', 'source']);
    assert.ok(Object.values(ctx).every((v) => typeof v === 'string'));
    assert.equal(ctx.source, 'upload');
    const dump = JSON.stringify(reports) + err.stack;
    assert.ok(!dump.includes('dentist') && !dump.includes('u1') && !dump.includes(REC_ID), `no content/ids for ${code}`);
  }
  setup(); mockFetch(respond(200, dgBody({ text: '', duration: 12.2, lang: 'ar', conf: 0.9 })));
  await assert.rejects(service.transcribeRecording('u1', REC_ID));
  assert.deepEqual(reports[0][2], { code: 'NO_SPEECH', source: 'upload', audio_seconds: '12', file_kb: '0', detected_language: 'ar', provider_status: '200' });
});

test('failure reporter: unexpected errors report UNKNOWN; success, already-completed and not-found never report', async () => {
  setup(); mockFetch(respond(200, dgBody()));
  const noteSvc = require('../src/services/noteService');
  const orig = noteSvc.createNote; noteSvc.createNote = async () => { throw new Error('db exploded'); };
  try { await assert.rejects(service.transcribeRecording('u1', REC_ID)); } finally { noteSvc.createNote = orig; }
  assert.equal(reports.length, 1); assert.equal(reports[0][2].code, 'UNKNOWN'); assert.equal(reports[0][1].message, 'Recording UNKNOWN');

  setup(); mockFetch(respond(503), respond(200, dgBody())); await service.transcribeRecording('u1', REC_ID);
  setup(baseRecording({ status: 'completed' })); await service.transcribeRecording('u1', REC_ID);
  setup(null); await assert.rejects(service.transcribeRecording('u1', REC_ID));
  assert.equal(reports.length, 0);
});

test('failure reporter throwing synchronously cannot break the request', async () => {
  setup(); mockFetch(respond(400));
  const fr = require('../src/utils/failureReporter'); const orig = fr.reportFailure; fr.reportFailure = () => { throw new Error('boom'); };
  try { await assert.rejects(service.transcribeRecording('u1', REC_ID), { statusCode: 500 }); } finally { fr.reportFailure = orig; }
});
