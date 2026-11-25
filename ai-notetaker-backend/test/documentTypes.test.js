// What the picker offers, what the upload route accepts and what can actually be read must agree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
process.env.SUPABASE_ANON_KEY = 'dummy';
process.env.ANTHROPIC_API_KEY = 'dummy';
process.env.FAILURE_REPORTER_DISABLED = '1';

const block = (file, from, to) => { const s = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'); const a = s.indexOf(from); return s.slice(a, s.indexOf(to, a)); };
const mimes = (text) => (text.match(/(?:application|text)\/[a-z0-9.+-]+/g) || []).sort();

test('the Android picker offers exactly the types the upload route accepts', () => {
  const server = mimes(block('ai-notetaker-backend/src/routes/uploads.js', 'const ALLOWED_MIME_TYPES', '];'));
  const app = mimes(block('android/app/src/main/java/com/kreativekoala/scribeai/utils/DocumentTypes.kt', 'val ACCEPTED', ')\n}'));
  assert.equal(server.length, 4);
  assert.deepEqual(app, server);
});

test('a presentation that cannot be read is an error, never a placeholder note', async () => {
  const pdfService = require('../src/services/pdfService');
  for (const mime of ['application/vnd.ms-powerpoint', 'application/vnd.oasis.opendocument.presentation']) {
    await assert.rejects(pdfService.extractText(Buffer.from('not a zip'), mime), { statusCode: 400 });
  }
});
