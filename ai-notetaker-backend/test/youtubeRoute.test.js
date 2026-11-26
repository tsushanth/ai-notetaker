// POST /api/uploads/video-url: "still writing" is not a failure, and asking again meanwhile spends no upload allowance.
const h = require('./helpers/routeHarness');
h.install();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { TranscriptError } = require('../src/utils/transcriptError');
let generating = false;
const servicePath = require.resolve(path.join(__dirname, '..', 'src', 'services', 'youtubeTranscriptService.js'));
require.cache[servicePath].exports = {
  isGenerating: () => generating,
  processVideoUrl: async () => { throw new TranscriptError('TRANSCRIPT_PENDING'); },
};

let server;
test.before(async () => { server = await h.listen(h.makeApp({ '/api/uploads': require('../src/routes/uploads') })); });
test.after(() => server.close());

test('pending answers 409 TRANSCRIPT_PENDING and spends the allowance only the first time', async () => {
  const send = () => h.call(server, 'POST', '/api/uploads/video-url', { user: 'u-video', body: { url: 'https://youtu.be/abcDEF12_-3' } });
  const first = await send();
  assert.equal(first.status, 409);
  assert.equal(first.body.code, 'TRANSCRIPT_PENDING');
  assert.match(first.body.error, /note will appear in your notes list/);
  const count = () => (h.db.usage_tracking || []).filter((r) => r.feature_type === 'upload').length;
  assert.equal(count(), 1);
  generating = true;
  assert.equal((await send()).status, 409);
  assert.equal(count(), 1);
});

test('the error handler sends the code of a transcript error', () => {
  const { errorHandler } = require('../src/middleware/errorHandler');
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  errorHandler(new TranscriptError('NO_CAPTIONS_TOO_LONG'), { method: 'POST', path: '/video-url' }, res, () => {});
  assert.equal(res.code, 422);
  assert.equal(res.body.code, 'NO_CAPTIONS_TOO_LONG');
  assert.match(res.body.error, /up to 20 minutes/);
});
