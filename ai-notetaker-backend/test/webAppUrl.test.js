const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getWebAppUrl, DEFAULT_WEB_APP_URL } = require('../src/utils/webAppUrl');

test('defaults to our own domain, never a different company', () => {
  assert.equal(DEFAULT_WEB_APP_URL, 'https://scribeai.online');
  assert.equal(getWebAppUrl({}), 'https://scribeai.online');
  assert.equal(getWebAppUrl({ WEB_APP_URL: '' }), 'https://scribeai.online');
  assert.equal(getWebAppUrl({ WEB_APP_URL: '   ' }), 'https://scribeai.online');
});

test('WEB_APP_URL wins when set, without a trailing slash', () => {
  assert.equal(getWebAppUrl({ WEB_APP_URL: 'https://example.test' }), 'https://example.test');
  assert.equal(getWebAppUrl({ WEB_APP_URL: 'https://example.test/' }), 'https://example.test');
});

test('share links and the Drive redirect use the helper', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
  assert.equal((read('services/shareService.js').match(/getWebAppUrl\(\)/g) || []).length, 3);
  assert.equal((read('routes/integrations.js').match(/getWebAppUrl\(\)/g) || []).length, 3);
});

test('no backend source mentions scribeai.app', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const offenders = walk(path.join(__dirname, '..', 'src')).filter((f) => /\.(js|json|html)$/.test(f) && fs.readFileSync(f, 'utf8').includes('scribeai.app'));
  assert.deepEqual(offenders, []);
});

test('the PDF export footer names our domain', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'exportService.js'), 'utf8');
  assert.match(src, /Created with Scribe AI — scribeai\.online/);
});
