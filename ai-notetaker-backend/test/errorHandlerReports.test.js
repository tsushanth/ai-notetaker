const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'production';
process.env.FAILURE_REPORTER_FORCE = '1'; // the reporter is also off under the node test runner; this file stubs fetch itself
process.env.FAILURE_REPORTER_KEY = 'test-report-key'; // the key comes from the environment only
const sent = [];
global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; };
const { errorHandler, AppError } = require('../src/middleware/errorHandler');
const fr = require('../src/utils/failureReporter');
const flush = () => new Promise((r) => setImmediate(r));
const mkRes = () => { const res = { locals: {}, statusCode: 200, status(c) { res.statusCode = c; return res; }, json() { return res; } }; return res; };

test('rejected upload (4xx with report) emails once as a counted failure, 5xx still pages as backend_error', async () => {
  fr._resetCountedForTests(); sent.length = 0;
  const req = { method: 'POST', path: '/upload', baseUrl: '/api/recordings', route: { path: '/upload' } };
  const err = new AppError('Invalid file type', 400, true, { message: 'Upload rejected: unsupported audio type', context: { reason: 'BAD_MIME', mimetype: 'audio/x-weird' } });
  errorHandler(err, { ...req }, mkRes(), () => {});
  errorHandler(err, { ...req }, mkRes(), () => {});
  const limit = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
  errorHandler(limit, { ...req }, mkRes(), () => {});
  const res5 = mkRes(); const req5 = { ...req, res: res5 };
  errorHandler(new AppError('Failed to upload audio file', 500), req5, res5, () => {});
  await flush();
  const kinds = sent.map((s) => `${s.kind}:${s.message}`);
  assert.deepEqual(kinds, [
    'failure:Upload rejected: unsupported audio type',
    'failure:Upload rejected: file too large',
    'backend_error:Failed to upload audio file',
  ]);
  assert.equal(sent[0].context.mimetype, 'audio/x-weird');
});
