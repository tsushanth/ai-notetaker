// A released Android app shows any non-2xx answer as "Failed to process video": while a transcript is being written its
// request is held open and ends with the note, or with a cut connection when no note comes.
const h = require('./helpers/routeHarness');
h.install();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');

const { TranscriptError } = require('../src/utils/transcriptError');
const { answerWhenDone, showsPendingAsFailure } = require('../src/utils/holdOpen');

let generating = true;
let finish;
const budgets = [];
const servicePath = require.resolve(path.join(__dirname, '..', 'src', 'services', 'youtubeTranscriptService.js'));
require.cache[servicePath].exports = {
  isGenerating: () => generating,
  processVideoUrl: (_u, _url, _t, opts) => {
    if (!opts) return Promise.reject(new TranscriptError('TRANSCRIPT_PENDING'));
    budgets.push(opts.budgetMs);
    return new Promise((resolve, reject) => { finish = { resolve, reject }; });
  },
};

let server;
test.before(async () => { server = await h.listen(h.makeApp({ '/api/uploads': require('../src/routes/uploads') })); });
test.after(() => server.close());

/** Raw request: resolves when the response ends or breaks, reporting what a client would see. */
function post(headers) {
  let sawHeaders;
  const headersSeen = new Promise((r) => { sawHeaders = r; });
  const done = new Promise((resolve) => {
    const body = JSON.stringify({ url: 'https://youtu.be/abcDEF12_-3' });
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/uploads/video-url',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, (res) => {
      let text = '';
      sawHeaders(res.statusCode);
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, complete: res.complete }));
      res.on('error', () => resolve({ status: res.statusCode, text, complete: false }));
      res.on('aborted', () => resolve({ status: res.statusCode, text, complete: false }));
    });
    req.end(body);
  });
  return { headersSeen, done };
}
const android = (user) => ({ 'x-test-user': user, 'User-Agent': 'okhttp/4.12.0' });
const tick = () => new Promise((r) => setTimeout(r, 50));

test('Android gets 201 at once and the note when the transcript is done', async () => {
  const r = post(android('u-hold-1'));
  assert.equal(await r.headersSeen, 201);
  await tick();
  finish.resolve({ note: { id: 'n1' }, stats: {} });
  const out = await r.done;
  assert.equal(out.complete, true);
  assert.deepEqual(JSON.parse(out.text), { success: true, data: { note: { id: 'n1' }, stats: {} } });
  assert.ok(budgets.at(-1) >= 10 * 60_000);
});

test('Android sees a broken answer, not a success, when no note comes', async () => {
  const r = post(android('u-hold-2'));
  await r.headersSeen;
  await tick();
  finish.reject(new TranscriptError('NO_SPEECH'));
  const out = await r.done;
  assert.equal(out.complete, false);
  assert.equal(out.text.trim(), '');
});

test('other clients, clients that accept pending, and another machine\'s job still get 409', async () => {
  for (const headers of [{ 'x-test-user': 'u-web' }, { 'x-test-user': 'u-ios', 'User-Agent': 'scribeai/1 CFNetwork/1 Darwin/1' }, { ...android('u-new'), 'x-accepts-pending': '1' }]) {
    const out = await post(headers).done;
    assert.equal(out.status, 409);
    assert.equal(JSON.parse(out.text).code, 'TRANSCRIPT_PENDING');
  }
  generating = false;
  assert.equal((await post(android('u-elsewhere')).done).status, 409);
  generating = true;
});

test('keeps writing while it waits, and stops when the caller leaves', async () => {
  const writes = [];
  let closed;
  const res = { destroyed: false, writableEnded: false, locals: {}, status() { return this; }, set() {}, once(_e, fn) { closed = fn; }, write(c) { writes.push(c); }, end() { this.writableEnded = true; }, destroy() { this.destroyed = true; } };
  let release;
  const p = answerWhenDone(res, () => new Promise((r) => { release = r; }), { beatMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(writes.length >= 3);
  res.destroyed = true;
  closed();
  const n = writes.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(writes.length, n);
  release({});
  await p;
  assert.equal(res.writableEnded, false);
});

test('a failure is recorded as such, not as a success', async () => {
  const res = { destroyed: false, writableEnded: false, locals: {}, status() { return this; }, set() {}, once() {}, write() {}, end() {}, destroy() { this.destroyed = true; } };
  await answerWhenDone(res, async () => { throw new TranscriptError('TRANSCRIPT_FAILED'); });
  assert.equal(res.destroyed, true);
  assert.ok(['client_error', 'server_error'].includes(res.locals.outcome));
});

test('only okhttp clients without the header are held', () => {
  const req = (h2) => ({ get: (n) => h2[n.toLowerCase()] });
  assert.equal(showsPendingAsFailure(req({ 'user-agent': 'okhttp/5.0.0-alpha.14' })), true);
  assert.equal(showsPendingAsFailure(req({ 'user-agent': 'okhttp/4.12.0', 'x-accepts-pending': '1' })), false);
  assert.equal(showsPendingAsFailure(req({ 'user-agent': 'Mozilla/5.0' })), false);
});
