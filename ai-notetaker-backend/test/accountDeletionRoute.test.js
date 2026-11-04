const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();

const U = '11111111-1111-1111-1111-111111111111';
const V = '22222222-2222-2222-2222-222222222222';

let outcome = { ok: true, authDeleted: true, failedSteps: [], warnings: [] };
const seen = [];
const svcPath = require.resolve(path.join(__dirname, '..', 'src', 'services', 'accountDeletionService.js'));
require.cache[svcPath] = { id: svcPath, filename: svcPath, loaded: true, exports: { deleteAccount: async (_admin, id) => { seen.push(id); if (outcome instanceof Error) throw outcome; return outcome; } } };

const app = h.makeApp({ '/api/user': require('../src/routes/user') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

test('DELETE /api/user/delete-account: 200 only when the auth user is gone', async () => {
  outcome = { ok: true, authDeleted: true, failedSteps: [], warnings: [] };
  let r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: U });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);

  outcome = { ok: false, authDeleted: false, failedSteps: ['auth.users'], warnings: [] };
  r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: U });
  assert.equal(r.status, 500);
  assert.equal(r.body.success, false);
  assert.equal(r.body.code, 'ACCOUNT_DELETION_INCOMPLETE');
  assert.match(r.body.error, /Trying again is safe/);
  assert.doesNotMatch(r.body.error, /Nothing further was lost/);

  outcome = new Error('boom');
  r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: U });
  assert.equal(r.status, 500);
  assert.equal(r.body.code, 'ACCOUNT_DELETION_INCOMPLETE');

  r = await h.call(server, 'DELETE', '/api/user/delete-account', {});
  assert.equal(r.status, 401);
});

test('the id passed to deleteAccount is the authenticated user, never a body, query or param value', async () => {
  outcome = { ok: true, authDeleted: true, failedSteps: [], warnings: [] };
  seen.length = 0;
  await h.call(server, 'DELETE', `/api/user/delete-account?userId=${V}&user_id=${V}&id=${V}`, { user: U, body: { userId: V, user_id: V, id: V } });
  assert.deepEqual(seen, [U]);
});

test('GET /api/user/data-export: AI content is reached through the user\'s own notes only', async () => {
  h.resetDb();
  h.db.profiles = [{ id: U, subscription_status: 'free' }];
  h.db.notes = [{ id: 'n-u1', user_id: U, title: 'mine' }, { id: 'n-u2', user_id: U, title: 'mine too' }, { id: 'n-v1', user_id: V, title: 'theirs' }];
  h.db.recordings = [{ id: 'r1', user_id: U, title: 'rec' }, { id: 'r2', user_id: V, title: 'rec' }];
  h.db.ai_content = [
    { id: 'a1', note_id: 'n-u1', content_type: 'quiz' }, { id: 'a2', note_id: 'n-u2', content_type: 'summary' },
    { id: 'a3', note_id: 'n-v1', content_type: 'quiz' }
  ];
  const r = await h.call(server, 'GET', '/api/user/data-export', { user: U });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.aiContent.map((x) => x.id).sort(), ['a1', 'a2']);
  assert.deepEqual(r.body.data.notes.map((x) => x.id).sort(), ['n-u1', 'n-u2']);
  assert.deepEqual(r.body.data.recordings.map((x) => x.id), ['r1']);
});

test('GET /api/user/data-export: a user with no notes gets an empty aiContent list', async () => {
  h.resetDb();
  const r = await h.call(server, 'GET', '/api/user/data-export', { user: U });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.aiContent, []);
});
