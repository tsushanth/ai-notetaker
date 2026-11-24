const test = require('node:test');
const assert = require('node:assert/strict');
const { documentFailureContext } = require('../src/utils/documentFailure');

const job = () => ({
  mimeType: 'application/pdf',
  fileSize: 12478301,
  steps: [{ status: 'completed' }, { status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }]
});

test('failure context says why an unreadable document failed (app error)', () => {
  const err = Object.assign(new Error('Could not extract text from document'), { statusCode: 400 });
  assert.deepEqual(documentFailureContext(job(), err), {
    step: '2', mime: 'application/pdf', size_kb: '12186', reason: 'Could not extract text from document', http: '400'
  });
});

test('failure context uses only the class name for an unexpected error', () => {
  const ctx = documentFailureContext(job(), new TypeError('Cannot read properties of undefined (reading "secret-doc.pdf")'));
  assert.equal(ctx.reason, 'TypeError');
  assert.equal(ctx.http, 'none');
});

test('failure context hides storage paths and caps the length', () => {
  const err = Object.assign(new Error('Failed to download file: not found uploads/abc/def.pdf ' + 'x'.repeat(300)), { statusCode: 500 });
  const ctx = documentFailureContext(job(), err);
  assert.ok(!ctx.reason.includes('def.pdf'));
  assert.ok(ctx.reason.includes('uploads/<path>'));
  assert.ok(ctx.reason.length <= 120);
});

test('failure context copes with a missing error and missing job fields', () => {
  const ctx = documentFailureContext({ steps: [] }, undefined);
  assert.deepEqual(ctx, { step: '-1', mime: 'unknown', size_kb: '0', reason: 'Error', http: 'none' });
});
