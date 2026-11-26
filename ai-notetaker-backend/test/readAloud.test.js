// Read Aloud: nothing is skipped, long jobs outlive the request, and every failure is reported.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.TTS_RETRY_DELAY_MS = '1';
process.env.FFMPEG_PATH = '/nonexistent/ffmpeg'; // store WAV in tests; the MP3 path is covered separately

function stub(rel, exports) { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; }
const reports = [];
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('../src/utils/failureReporter', { reportFailure: (flow, err, ctx) => { reports.push({ flow, message: err.message, ctx }); return Promise.resolve(); } });

const store = { notes: [], ai_content: [], uploads: [], shared: {} };
function from(table) {
  const filters = [];
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
    rows: () => (store[table] || []).filter((r) => filters.every((f) => f(r))),
    single: async () => { const r = q.rows()[0]; return r ? { data: r, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; },
    then: (res, rej) => Promise.resolve({ data: q.rows(), error: null }).then(res, rej),
    upsert: async (row) => { store[table] = (store[table] || []).filter((r) => !(r.note_id === row.note_id && r.content_type === row.content_type)); store[table].push(row); return { error: null }; },
  };
  return q;
}
let uploadError = null;
stub('../src/config/supabase', { supabaseAdmin: { from, storage: { from: () => ({
  upload: async (name, body, opts) => { if (uploadError) return { error: { message: uploadError } }; store.uploads.push({ name, body, opts }); return { error: null }; },
  download: async (name) => (store.shared[name] ? { data: new Blob([store.shared[name]]), error: null } : { data: null, error: { message: 'not found' } }),
  getPublicUrl: (name) => ({ data: { publicUrl: `https://x.test/audio/${name}` } }),
}) } } });

const { splitForSpeech, cleanTextForSpeech, MAX_PIECE_CHARS } = require('../src/utils/speechText');
const { concatWav, parseWav, wavSeconds } = require('../src/utils/wav');
const tts = require('../src/services/ttsService');
const jobs = require('../src/services/ttsJobs');
const { TtsError } = require('../src/utils/ttsError');

/** A 16-bit mono 24 kHz WAV of `samples` samples. */
function wav(samples = 2400) {
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}
let sent;
function worker(answer) {
  sent = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, text: body.text });
    const status = answer(body.text, sent.length);
    if (status instanceof Error) throw status;
    return status === 200 ? new Response(wav()) : new Response('Synthesis failed', { status });
  };
}
const SENTINEL = '00000000-0000-0000-0000-000000000001';
const sentences = (n) => Array.from({ length: n }, (_, i) => `This is sentence number ${i} of a long study note.`).join(' ');
function reset(content = sentences(3)) {
  reports.length = 0; uploadError = null;
  store.notes = [
    { id: SENTINEL, user_id: 'someone-else', source_type: 'tutorial', content: 'not yours' },
    { id: 'mine-tutorial', user_id: 'u1', source_type: 'tutorial', content },
    { id: 'n1', user_id: 'u1', source_type: 'video', content },
  ];
  store.ai_content = []; store.uploads = []; store.shared = {};
}

test('text is split below the size at which the worker starts skipping, and no word is lost', () => {
  const text = `${sentences(80)} ${'unbroken'.repeat(100)}. 中文内容没有空格。`.trim();
  const pieces = splitForSpeech(text);
  assert.ok(pieces.every((p) => p.length <= MAX_PIECE_CHARS && MAX_PIECE_CHARS < 400));
  assert.equal(pieces.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('markdown cleaning keeps the words of bold text, links and tables, and drops pieces with nothing to say', () => {
  const out = cleanTextForSpeech('## Cells\n**Mitochondria** make [energy](https://x.test/a) https://x.test/b\n| Starch | Glycogen |\n|---|---|\n- one\n---');
  for (const w of ['Cells', 'Mitochondria', 'energy', 'Starch, Glycogen', 'one']) assert.ok(out.includes(w), w);
  assert.doesNotMatch(out, /\*\*|https|\|/);
  assert.deepEqual(splitForSpeech('--- *** ... !!!'), []);
});

test('joined WAV audio holds every part (byte concatenation would play only the first)', () => {
  const joined = concatWav([wav(24000), wav(24000)], 150);
  assert.equal(parseWav(joined).data.length, 48000 + 48000 + 7200);
  assert.equal(Math.round(wavSeconds(joined) * 100), 215);
  assert.equal(joined.readUInt32LE(4), joined.length - 8);
});

test('every piece is requested and the result is one file saved against the note', async () => {
  reset(sentences(40)); worker(() => 200);
  const out = await tts.generateForNote('u1', 'n1');
  assert.ok(sent.length > 5);
  assert.ok(sent.every((s) => s.url.endsWith('/synthesize') && s.text.length <= MAX_PIECE_CHARS));
  assert.equal(store.uploads.length, 1);
  assert.match(store.uploads[0].name, /^tts\/u1\/n1-\d+\.wav$/);
  assert.equal(store.ai_content[0].note_id, 'n1');
  assert.ok(out.duration_seconds >= 1);
});

test('welcome note: the fixed app id is read as this user\'s own copy', async () => {
  reset(); worker(() => 200);
  const out = await tts.generateForNote('u1', SENTINEL);
  assert.match(out.audio_url, /tts\/u1\/mine-tutorial-/);
  assert.equal(store.ai_content[0].note_id, 'mine-tutorial');
  assert.ok(sent.every((s) => !s.text.includes('not yours')));
  assert.ok(await tts.getTTSForNote('u1', SENTINEL));
});

test('saved audio is only returned to the note owner', async () => {
  reset(); worker(() => 200);
  await tts.generateForNote('u1', 'n1');
  assert.equal(await tts.getTTSForNote('intruder', 'n1'), null);
});

test('a second request for unchanged text reuses the saved audio', async () => {
  reset(); worker(() => 200);
  const a = await tts.generateForNote('u1', 'n1');
  const calls = sent.length;
  const b = await tts.generateForNote('u1', 'n1');
  assert.equal(b.audio_url, a.audio_url);
  assert.equal(sent.length, calls);
});

test('a piece the model cannot take is halved, not skipped', async () => {
  reset(`${'alpha beta gamma delta epsilon '.repeat(8)}.`); worker((text) => (text.length > 150 ? 500 : 200));
  await tts.generateForNote('u1', 'n1');
  const accepted = sent.filter((s) => s.text.length <= 150).map((s) => s.text).join(' ');
  assert.equal(accepted.split(/\s+/).filter((w) => w.startsWith('alpha')).length, 8);
  assert.equal(store.uploads.length, 1);
});

test('a piece that cannot be synthesized fails the whole job with one report, and nothing is saved', async () => {
  reset(); worker(() => 500);
  await assert.rejects(jobs.start(tts, 'u1', 'n1'), (e) => e instanceof TtsError && e.code === 'WORKER_ERROR' && e.statusCode === 502);
  assert.equal(store.uploads.length, 0);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message, 'Read Aloud failed: WORKER_ERROR');
  assert.equal(reports[0].ctx.worker_status, '500');
  assert.ok(!JSON.stringify(reports).includes('sentence number'), 'no note text in reports');
});

test('passing worker errors are retried', async () => {
  reset('Short note.'); worker((_t, n) => (n === 1 ? 503 : 200));
  await tts.generateForNote('u1', 'n1');
  assert.equal(sent.length, 2);
});

test('upload failure, over-long note and empty note each end in a report', async () => {
  reset(); worker(() => 200); uploadError = 'Payload too large';
  await assert.rejects(jobs.start(tts, 'u1', 'n1'), { code: 'UPLOAD_FAILED' });
  reset(sentences(600)); await assert.rejects(jobs.start(tts, 'u1', 'n1'), { code: 'TOO_LONG', statusCode: 422 });
  assert.equal(reports.at(-1).ctx.code, 'TOO_LONG');
  reset('***'); await assert.rejects(jobs.start(tts, 'u1', 'n1'), { code: 'NOTHING_TO_READ' });
  assert.equal(reports.length, 1);
});

test('a job outlives a caller who stops waiting; a retry joins it; shutdown reports it', async () => {
  reset();
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const slow = { generateForNote: async () => { calls += 1; await gate; return { audio_url: 'u' }; } };
  const first = jobs.start(slow, 'u1', 'n1', { voice: 'nova', speed: 1 });
  assert.deepEqual(await jobs.wait(first, 5), { done: false });
  assert.equal(jobs.isRunning('u1', 'n1', 'nova', '1.0'), true);
  assert.equal(jobs.start(slow, 'u1', 'n1'), first);
  await jobs.reportInterrupted();
  assert.equal(reports.at(-1).ctx.code, 'INTERRUPTED');
  release();
  assert.deepEqual(await jobs.wait(first, 1000), { done: true, result: { audio_url: 'u' } });
  assert.equal(calls, 1);
  assert.equal(jobs.isRunning('u1', 'n1'), false);
});

test('wait budget: released apps get less than their 120 s timeout; newer clients may ask for more, within a cap', () => {
  assert.equal(jobs.waitBudgetMs(undefined, {}), 100_000);
  assert.equal(jobs.waitBudgetMs('270000', {}), 270_000);
  assert.equal(jobs.waitBudgetMs('999999999', {}), jobs.MAX_WAIT_MS);
  assert.equal(jobs.waitBudgetMs('abc', { TTS_WAIT_MS: '5' }), 5);
});

test('MP3 encoding gives null (so WAV is stored) when ffmpeg is unavailable', async () => {
  assert.equal(await tts.encodeMp3(wav(), { ffmpegPath: '/nonexistent/ffmpeg' }), null);
});

test('MP3 encoding with the real ffmpeg, when this machine has it', async (t) => {
  const out = await tts.encodeMp3(wav(48000), { ffmpegPath: 'ffmpeg' });
  if (!out) return t.skip('ffmpeg not installed');
  assert.ok(out.length > 100 && out.length < 44 + 96000);
});

// The welcome text shared by every user. Taken from the app source so the test fails if the app's text changes without
// its hash being added.
const appSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'android/app/src/main/java/com/kreativekoala/scribeai/utils/TutorialContent.kt'), 'utf8');
const WELCOME = appSource.split('const val TUTORIAL_CONTENT = """')[1].split('"""')[0];
const { isStockWelcomeNote } = require('../src/services/welcomeNote');

test('only an unchanged, app-supplied welcome note counts as the shared one', () => {
  assert.equal(isStockWelcomeNote({ source_type: 'tutorial', content: WELCOME }), true, 'add the new hash in welcomeNote.js');
  assert.equal(isStockWelcomeNote({ source_type: 'tutorial', content: `${WELCOME} my own line` }), false);
  assert.equal(isStockWelcomeNote({ source_type: 'manual', content: WELCOME }), false);
  assert.equal(isStockWelcomeNote(null), false);
});

/** Give u1 and u2 a welcome note copy each; ffmpeg is replaced so an MP3 comes back (only an MP3 is shared). */
function welcomeSetup(t, extra = {}) {
  reset(); worker(() => 200);
  store.notes = ['u1', 'u2'].map((u) => ({ id: `${u}-welcome`, user_id: u, source_type: 'tutorial', content: WELCOME, formatted_content: `Formatted differently for ${u}.`, ...extra }));
  const fs = require('node:fs');
  const script = require('node:path').join(require('node:os').tmpdir(), `fake-ffmpeg-${process.pid}`);
  fs.writeFileSync(script, '#!/bin/sh\ncat >/dev/null\nhead -c 16000 /dev/zero\n', { mode: 0o755 });
  process.env.FFMPEG_PATH = script;
  t.after(() => { process.env.FFMPEG_PATH = '/nonexistent/ffmpeg'; fs.rmSync(script, { force: true }); });
}
/** What the real bucket would then hold. */
const keepSharedUploads = () => { for (const u of store.uploads) if (u.name.startsWith('tts/shared/')) store.shared[u.name] = u.body; };

test('welcome audio is made once; the next user gets a copy of their own without synthesis', async (t) => {
  welcomeSetup(t);
  const first = await tts.generateForNote('u1', SENTINEL);
  const calls = sent.length;
  assert.ok(calls > 5);
  assert.ok(sent.every((s) => !s.text.includes('Formatted differently')));
  assert.match(first.audio_url, /tts\/u1\/u1-welcome-/);
  keepSharedUploads();
  assert.equal(Object.keys(store.shared).length, 1);
  assert.match(Object.keys(store.shared)[0], /^tts\/shared\/welcome\/[0-9a-f]{64}-af_nicole\.mp3$/);
  store.uploads = [];
  const second = await tts.generateForNote('u2', SENTINEL);
  assert.equal(sent.length, calls, 'no synthesis for the second user');
  assert.deepEqual(store.uploads.map((u) => u.name.replace(/-\d+\.mp3$/, '')), ['tts/u2/u2-welcome']);
  assert.match(second.audio_url, /tts\/u2\/u2-welcome-/);
  assert.equal(second.duration_seconds, 2, '16,000 bytes at 64 kbit/s');
});

test('another voice is made separately; another speed is not shared', async (t) => {
  welcomeSetup(t);
  await tts.generateForNote('u1', SENTINEL); keepSharedUploads();
  let calls = sent.length;
  store.uploads = [];
  await tts.generateForNote('u2', SENTINEL, { voice: 'echo' });
  assert.ok(sent.length > calls);
  assert.ok(store.uploads.some((u) => u.name.endsWith('-am_michael.mp3')));
  calls = sent.length; store.uploads = [];
  await tts.generateForNote('u2', SENTINEL, { speed: 1.5 });
  assert.ok(sent.length > calls);
  assert.ok(store.uploads.every((u) => !u.name.startsWith('tts/shared/')));
});

test('an edited welcome note and any other note are never shared or served shared audio', async (t) => {
  for (const extra of [{ content: `${WELCOME}\nMy private line.`, formatted_content: null }, { source_type: 'manual' }]) {
    welcomeSetup(t, extra);
    await tts.generateForNote('u1', 'u1-welcome');
    const calls = sent.length;
    await tts.generateForNote('u2', 'u2-welcome');
    assert.equal(sent.length, calls * 2);
    assert.ok(store.uploads.every((u) => !u.name.startsWith('tts/shared/')));
  }
});
