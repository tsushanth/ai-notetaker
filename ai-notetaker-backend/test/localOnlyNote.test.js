const h = require('./helpers/routeHarness');
h.install();
const test = require('node:test');
const assert = require('node:assert/strict');

const TUTORIAL = '00000000-0000-0000-0000-000000000001';
const mounts = {
  '/api/notes': [require('../src/routes/exports'), require('../src/routes/sharing')],
  '/api/integrations': require('../src/routes/integrations')
};
let server;
test.before(async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const [p, rs] of Object.entries(mounts)) for (const r of [].concat(rs)) app.use(p, r);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, error: err.message })); // eslint-disable-line no-unused-vars
  server = await h.listen(app);
});
test.after(() => server.close());
test.beforeEach(() => { h.resetDb(); for (const k of Object.keys(h.calls)) delete h.calls[k]; });

const ENDPOINTS = [
  ['GET', `/api/notes/${TUTORIAL}/export/pdf`],
  ['GET', `/api/notes/${TUTORIAL}/export/docx`],
  ['POST', `/api/notes/${TUTORIAL}/share`],
  ['POST', `/api/integrations/google-drive/export/${TUTORIAL}`],
  ['POST', `/api/integrations/notion/export/${TUTORIAL}`],
  ['POST', `/api/integrations/slack/share/${TUTORIAL}`]
];

for (const [method, path] of ENDPOINTS) {
  test(`${method} ${path.replace(TUTORIAL, ':tutorial')}: 404 LOCAL_ONLY_NOTE before any subscription or database work`, async () => {
    const r = await h.call(server, method, path, { user: 'free-user', body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'LOCAL_ONLY_NOTE');
    assert.match(r.body.error, /only exists on your device/);
    for (const k of ['exportPdf', 'exportDocx', 'share.create']) assert.equal(h.calls[k], undefined, `${k} not reached`);
  });
}

test('the local-only check still requires sign-in', async () => {
  const r = await h.call(server, 'GET', `/api/notes/${TUTORIAL}/export/pdf`, {});
  assert.equal(r.status, 401);
});

test('ordinary note ids are untouched (share still reaches the service)', async () => {
  const r = await h.call(server, 'POST', '/api/notes/6f1d1c52-0000-4000-8000-000000000002/share', { user: 'free-user', body: {} });
  assert.equal(r.status, 200);
  assert.equal(h.calls['share.create'].length, 1);
});
