// YouTube notes: captions first; without captions a transcript is generated inside hard limits, or the user is told why not.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; };
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
const reports = [];
stub('../src/utils/failureReporter', { reportCounted: (...a) => reports.push(a), reportFailure: async (...a) => reports.push(a), reportBackendError() {} });
const notes = [];
stub('../src/services/noteService', { createNote: async (userId, n) => { const note = { id: `note-${notes.length + 1}`, user_id: userId, ...n }; notes.push(note); return note; } });

const { YouTubeTranscriptService } = require('../src/services/youtubeTranscriptService');
const { createTranscriptGeneration, estimateCredits } = require('../src/services/transcriptGeneration');
const { createSupadataClient, SupadataError } = require('../src/services/supadataClient');
const { MESSAGES } = require('../src/utils/transcriptError');

const URL_ = 'https://youtu.be/abcDEF12_-3';
const ON = { YOUTUBE_GENERATE_ENABLED: 'true' };
const noCaptions = () => { throw new SupadataError('transcript-unavailable', null, { status: 206, billed: 1 }); };

function setup({ env = ON, captions = noCaptions, generate = async () => ({ content: 'spoken words here', lang: 'pl', billed: 10 }), seconds = 300, balance = { used: 100, max: 30000 }, reserve, ledger = {}, poll } = {}) {
  const calls = [];
  const rows = [];
  const supadata = {
    transcript: async (id, mode) => { calls.push(mode); return mode === 'native' ? captions() : generate(); },
    metadata: async () => { calls.push('metadata'); return { type: 'video', durationSeconds: seconds }; },
    balance: async () => { calls.push('balance'); return balance; },
    pollJob: async (jobId) => { calls.push(`poll:${jobId}`); return poll ? poll() : { content: 'from the job', lang: 'en' }; },
  };
  const book = {
    latest: async (u, v) => [...rows].reverse().find((r) => r.user_id === u && r.video_id === v && ['pending', 'done', 'failed'].includes(r.status)) || null,
    reserve: reserve || (async (p) => { const row = { id: rows.length + 1, user_id: p.userId, video_id: p.videoId, credits: p.credits, status: 'pending', created_at: new Date().toISOString(), limits: [p.userDaily, p.monthlyCredits] }; rows.push(row); return { ok: true, id: row.id, month_credits: p.credits }; }),
    update: async (id, patch) => Object.assign(rows.find((r) => r.id === id), patch),
    findNote: async (u, id) => notes.find((n) => n.id === id && n.user_id === u) || null,
    ...ledger,
  };
  const generation = createTranscriptGeneration({ supadata, ledger: book, env });
  const service = new YouTubeTranscriptService({ supadata, generation });
  service.getVideoInfo = async () => ({ title: 'T', author_name: 'A', thumbnail_url: 'x' });
  return { service, calls, rows, book };
}
const rejects = (promise, code) => assert.rejects(promise, (e) => { assert.equal(e.publicCode, code, e.message); return true; });

test('a video with captions is one native call and no generation', async () => {
  const { service, calls, rows } = setup({ captions: () => ({ content: 'the captions', lang: 'en' }) });
  const out = await service.processVideoUrl('u1', URL_);
  assert.equal(out.stats.transcriptSource, 'supadata_native');
  assert.equal(out.note.content, 'the captions');
  assert.deepEqual(calls, ['native']);
  assert.equal(rows.length, 0);
});

test('no captions: the transcript is generated, saved and its cost recorded with the limits', async () => {
  const { service, calls, rows } = setup();
  const out = await service.processVideoUrl('u1', URL_);
  assert.equal(out.stats.transcriptSource, 'supadata_generated');
  assert.equal(out.note.metadata.transcript_language, 'pl');
  assert.deepEqual(calls, ['native', 'metadata', 'balance', 'generate']);
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].note_id, out.note.id);
  assert.equal(rows[0].credits, 11); // 5 minutes x 2 + 1 for the length lookup
  assert.deepEqual(rows[0].limits, [3, 3000]);
});

test('empty captions count as no captions', async () => {
  const { service } = setup({ captions: () => ({ content: '  ', lang: 'en' }) });
  assert.equal((await service.processVideoUrl('u1', URL_)).stats.transcriptSource, 'supadata_generated');
});

test('the switch is off unless it says true: nothing beyond the captions request is paid for', async () => {
  for (const env of [{}, { YOUTUBE_GENERATE_ENABLED: 'false' }, { YOUTUBE_GENERATE_ENABLED: '1' }]) {
    const { service, calls } = setup({ env });
    await rejects(service.processVideoUrl('u1', URL_), 'NO_CAPTIONS_UNAVAILABLE');
    assert.deepEqual(calls, ['native']);
  }
});

test('20 minutes is the longest video; the environment cannot raise it', async () => {
  const ok = setup({ seconds: 20 * 60 });
  await ok.service.processVideoUrl('u1', URL_);
  for (const env of [ON, { ...ON, YOUTUBE_GENERATE_MAX_MINUTES: '600' }]) {
    const { service, calls, rows } = setup({ seconds: 20 * 60 + 1, env });
    await rejects(service.processVideoUrl('u1', URL_), 'NO_CAPTIONS_TOO_LONG');
    assert.ok(!calls.includes('generate'));
    assert.equal(rows.length, 0);
  }
});

test('unknown length is refused', async () => {
  for (const seconds of [0, NaN, undefined]) {
    const { service, calls } = setup({ seconds: seconds === undefined ? NaN : seconds });
    await rejects(service.processVideoUrl('u1', URL_), 'NO_TRANSCRIPT');
    assert.ok(!calls.includes('generate'));
  }
});

test('nothing is generated close to the end of the plan, so no extra charge can start', async () => {
  const { service, calls } = setup({ balance: { used: 28995, max: 30000 } });
  await rejects(service.processVideoUrl('u1', URL_), 'NO_CAPTIONS_UNAVAILABLE');
  assert.ok(!calls.includes('generate'));
});

test('the fourth in a day is refused with the time to wait', async () => {
  const { service, calls } = setup({ reserve: async () => ({ ok: false, reason: 'user_daily', retry_at: new Date(Date.now() + 2 * 3600_000 - 1000).toISOString() }) });
  await assert.rejects(service.processVideoUrl('u1', URL_), (e) => {
    assert.equal(e.statusCode, 429);
    assert.equal(e.publicCode, 'GENERATE_LIMIT_REACHED');
    assert.match(e.message, /used today's 3 transcripts for videos without captions\. You can try again in about 2 hours/);
    assert.equal(e.details.limit, 3);
    return true;
  });
  assert.ok(!calls.includes('generate'));
});

test('the monthly cap and a broken ledger both mean nothing is generated', async () => {
  for (const reserve of [async () => ({ ok: false, reason: 'monthly', month_credits: 2999 }), async () => { throw new Error('relation does not exist'); }]) {
    const { service, calls } = setup({ reserve });
    await rejects(service.processVideoUrl('u1', URL_), 'NO_CAPTIONS_UNAVAILABLE');
    assert.ok(!calls.includes('generate'));
  }
});

test('a slow generation answers "still writing", then asking again joins it, then returns the same note for free', async () => {
  let finish;
  const { service, calls, rows } = setup({ generate: () => new Promise((r) => { finish = r; }) });
  const before = notes.length;
  await rejects(service.processVideoUrl('u1', URL_, undefined, { budgetMs: 20 }), 'TRANSCRIPT_PENDING');
  assert.equal(service.isGenerating('u1', URL_), true);
  assert.equal(service.isGenerating('u2', URL_), false);
  await rejects(service.processVideoUrl('u1', URL_, undefined, { budgetMs: 20 }), 'TRANSCRIPT_PENDING');
  assert.equal(calls.filter((c) => c === 'native').length, 1, 'joining costs no request');
  finish({ content: 'late words', lang: 'en' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rows[0].status, 'done');
  assert.equal(notes.length, before + 1, 'the note is saved with nobody waiting');
  const again = await service.processVideoUrl('u1', URL_);
  assert.equal(again.note.content, 'late words');
  assert.equal(notes.length, before + 1);
  assert.equal(calls.filter((c) => c === 'generate').length, 1);
});

test('after a generation the vendor answers the captions request with it: the saved note is returned, not a copy', async () => {
  // Seen live: once generated, mode=native returns the text.
  let generated = false;
  const { service, calls } = setup({
    captions: () => (generated ? { content: 'spoken words here', lang: 'none' } : noCaptions()),
    generate: async () => { generated = true; return { content: 'spoken words here', lang: 'dz', billed: 4 }; },
  });
  const first = await service.processVideoUrl('u1', URL_);
  const before = notes.length;
  const paid = calls.length;
  const again = await service.processVideoUrl('u1', URL_);
  assert.equal(again.note.id, first.note.id);
  assert.equal(again.stats.transcriptSource, 'supadata_generated');
  assert.equal(notes.length, before);
  assert.equal(calls.length, paid, 'no vendor request for the repeat');
});

test('a ledger that cannot be read does not stop a captioned video', async () => {
  const { service } = setup({ captions: () => ({ content: 'the captions' }), ledger: { latest: async () => { throw new Error('db down'); } } });
  assert.equal((await service.processVideoUrl('u1', URL_)).note.content, 'the captions');
});

test('a vendor job is saved, and a restarted machine resumes it without paying again', async () => {
  const { service, calls, rows } = setup({ generate: async () => ({ jobId: 'job-1', billed: 10 }) });
  await service.processVideoUrl('u1', URL_);
  assert.deepEqual(calls.slice(-2), ['generate', 'poll:job-1']);
  const restarted = setup();
  restarted.rows.push({ id: 1, user_id: 'u1', video_id: 'abcDEF12_-3', status: 'pending', job_id: 'job-9', created_at: new Date().toISOString() });
  const out = await restarted.service.processVideoUrl('u1', URL_);
  assert.equal(out.note.content, 'from the job');
  assert.deepEqual(restarted.calls, ['native', 'poll:job-9']);
  assert.equal(rows[0].job_id, 'job-1');
});

test('a refused request is released; an unknown outcome stays counted', async () => {
  const refused = setup({ generate: async () => { throw new SupadataError('limit-exceeded', 'HTTP 429', { status: 429, billed: 0 }); } });
  await rejects(refused.service.processVideoUrl('u1', URL_), 'TRANSCRIPT_FAILED');
  assert.equal(refused.rows[0].status, 'released');
  assert.equal(refused.rows[0].credits, 1);
  const timedOut = setup({ generate: async () => { throw new SupadataError('timeout', 'TimeoutError'); } });
  await rejects(timedOut.service.processVideoUrl('u1', URL_), 'TRANSCRIPT_FAILED');
  assert.equal(timedOut.rows[0].status, 'failed');
  assert.equal(timedOut.rows[0].credits, 11);
});

test('no speech and private videos say so', async () => {
  const silent = setup({ generate: async () => ({ content: '', billed: 10 }) });
  await rejects(silent.service.processVideoUrl('u1', URL_), 'NO_SPEECH');
  const gone = setup({ captions: () => { throw new SupadataError('not-found', 'HTTP 404', { status: 404, billed: 0 }); } });
  await rejects(gone.service.processVideoUrl('u1', URL_), 'VIDEO_UNAVAILABLE');
  const outage = setup({ captions: () => { throw new SupadataError('internal-error', 'HTTP 500', { status: 500 }); } });
  await rejects(outage.service.processVideoUrl('u1', URL_), 'TRANSCRIPT_SERVICE_ERROR');
  assert.ok(!outage.calls.includes('generate'));
});

test('a generation that finds nothing to transcribe says no speech and records what was charged', async () => {
  // Seen live on silent videos: mode=generate answers 206, charged 1 credit.
  for (const generate of [
    async () => { throw new SupadataError('transcript-unavailable', null, { status: 206, billed: 1 }); },
    async () => { throw new SupadataError('transcript-unavailable', 'job failed'); },
  ]) {
    const { service, rows } = setup({ generate });
    await rejects(service.processVideoUrl('u1', URL_), 'NO_SPEECH');
    assert.equal(rows[0].status, 'failed');
  }
  const { service, rows } = setup({ generate: async () => { throw new SupadataError('transcript-unavailable', null, { status: 206, billed: 1 }); } });
  await rejects(service.processVideoUrl('u1', URL_), 'NO_SPEECH');
  assert.equal(rows[0].credits, 2);
});

test('asking again about a video with nothing to hear says so without paying again; other failures may be retried', async () => {
  const silent = setup({ generate: async () => { throw new SupadataError('transcript-unavailable', null, { status: 206, billed: 1 }); } });
  await rejects(silent.service.processVideoUrl('u1', URL_), 'NO_SPEECH');
  await rejects(silent.service.processVideoUrl('u1', URL_), 'NO_SPEECH');
  assert.equal(silent.calls.filter((c) => c === 'generate').length, 1);
  assert.equal(silent.rows.length, 1);
  const flaky = setup({ generate: async () => { throw new SupadataError('timeout', 'TimeoutError'); } });
  await rejects(flaky.service.processVideoUrl('u1', URL_), 'TRANSCRIPT_FAILED');
  await rejects(flaky.service.processVideoUrl('u1', URL_), 'TRANSCRIPT_FAILED');
  assert.equal(flaky.calls.filter((c) => c === 'generate').length, 2);
});

test('estimate: 2 credits per started minute plus the lookup', () => {
  assert.equal(estimateCredits(1), 3);
  assert.equal(estimateCredits(61), 5);
  assert.equal(estimateCredits(1200), 41);
});

// What released Android apps (YouTubeInputScreen.kt) show for a server message.
const appText = (error) => {
  if (['No transcript available', 'captions', 'subtitles'].some((w) => error.includes(w))) return 'no-captions';
  if (['401', 'Unauthorized'].some((w) => error.includes(w))) return 'session';
  if (['private', 'unavailable'].some((w) => error.includes(w))) return 'private';
  if (['timeout', 'timed out'].some((w) => error.includes(w))) return 'timeout';
  return 'generic';
};

test('released apps pick the right fixed text for each message', () => {
  const expected = {
    NO_CAPTIONS_UNAVAILABLE: 'no-captions', NO_CAPTIONS_TOO_LONG: 'no-captions', GENERATE_LIMIT_REACHED: 'no-captions',
    NO_SPEECH: 'no-captions', NO_TRANSCRIPT: 'no-captions', VIDEO_UNAVAILABLE: 'private',
    TRANSCRIPT_PENDING: 'generic', TRANSCRIPT_FAILED: 'generic', TRANSCRIPT_SERVICE_ERROR: 'generic',
  };
  assert.deepEqual(Object.fromEntries(Object.entries(MESSAGES).map(([code, [, text]]) => [code, appText(text)])), expected);
});

const answer = (status, body, billed) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => (billed === undefined ? null : String(billed)) } });

test('the vendor only ever receives a YouTube address built from the id; 206 means no captions', async () => {
  const urls = [];
  const client = createSupadataClient({ apiKey: 'k', fetchImpl: async (u) => { urls.push(u); return answer(206, { error: 'transcript-unavailable' }); } });
  await assert.rejects(client.transcript('abcDEF12_-3', 'native'), { code: 'transcript-unavailable', billed: 1 });
  assert.equal(new URL(urls[0]).searchParams.get('url'), 'https://www.youtube.com/watch?v=abcDEF12_-3');
});

test('a lookalike address is reduced to its video id', async () => {
  const seen = [];
  const { service } = setup();
  service.client = () => ({ transcript: async (id) => { seen.push(id); return { content: 'x' }; } });
  await service.processVideoUrl('u1', 'https://youtube.com.example.org/youtu.be/abcDEF12_-3.mp3');
  assert.deepEqual(seen, ['abcDEF12_-3']);
});

test('billing: refused requests are free, server errors and job status errors are unknown', async () => {
  const client = (status, body) => createSupadataClient({ apiKey: 'k', fetchImpl: async () => answer(status, body) });
  await assert.rejects(client(429, { error: 'limit-exceeded' }).transcript('abcDEF12_-3', 'generate'), { billed: 0, code: 'limit-exceeded' });
  await assert.rejects(client(500, { error: 'internal-error' }).transcript('abcDEF12_-3', 'generate'), { billed: null });
  await assert.rejects(client(404, { error: 'not-found' }).pollJob('j'), { billed: null });
});

test('a job result is read from either shape', async () => {
  for (const body of [{ status: 'completed', content: 'a b', lang: 'en' }, { status: 'completed', result: { content: [{ text: 'a' }, { text: 'b' }], lang: 'en' } }]) {
    const client = createSupadataClient({ apiKey: 'k', fetchImpl: async () => answer(200, body) });
    assert.deepEqual(await client.pollJob('j'), { content: 'a b', lang: 'en' });
  }
});
