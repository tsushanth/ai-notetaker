const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminSecretMatches } = require('../src/middleware/adminSecret');

test('the right secret matches', () => {
  assert.equal(adminSecretMatches('s3cret-value', 's3cret-value'), true);
});

test('with no secret configured nothing matches, including the old public default', () => {
  for (const expected of [undefined, null, '', 0]) {
    assert.equal(adminSecretMatches('scribeai-admin-2025', expected), false);
    assert.equal(adminSecretMatches(expected, expected), false);
    assert.equal(adminSecretMatches('', expected), false);
  }
});

test('a missing, empty, wrong, longer or shorter secret is refused', () => {
  for (const p of [undefined, null, '', 'wrong', 's3cret-valu', 's3cret-value!', 'S3CRET-VALUE', ['s3cret-value'], 42]) {
    assert.equal(adminSecretMatches(p, 's3cret-value'), false, String(p));
  }
});

test('the batch endpoint has no literal fallback for ADMIN_SECRET and uses the shared check (guardrail)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/formatting.js'), 'utf8');
  assert.equal(/ADMIN_SECRET\s*(\|\||\?\?)/.test(src), false, 'no default value after ADMIN_SECRET');
  assert.equal(src.includes('scribeai-admin-2025'), false);
  assert.ok(src.includes('adminSecretMatches('));
  assert.ok(src.includes('503'), 'reports itself disabled when unconfigured');
});
