const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();

let outcome = { ok: true, authDeleted: true, failedSteps: [], warnings: [] };
const svcPath = require.resolve(path.join(__dirname, '..', 'src', 'services', 'accountDeletionService.js'));
require.cache[svcPath] = { id: svcPath, filename: svcPath, loaded: true, exports: { deleteAccount: async () => { if (outcome instanceof Error) throw outcome; return outcome; } } };

const app = h.makeApp({ '/api/user': require('../src/routes/user') });

test('DELETE /api/user/delete-account: 200 only when the auth user is gone', async () => {
  const server = await h.listen(app);
  try {
    outcome = { ok: true, authDeleted: true, failedSteps: [], warnings: [] };
    let r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: 'u1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);

    outcome = { ok: false, authDeleted: false, failedSteps: ['auth.users'], warnings: [] };
    r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: 'u1' });
    assert.equal(r.status, 500);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, 'ACCOUNT_DELETION_INCOMPLETE');

    outcome = new Error('boom');
    r = await h.call(server, 'DELETE', '/api/user/delete-account', { user: 'u1' });
    assert.equal(r.status, 500);
    assert.equal(r.body.code, 'ACCOUNT_DELETION_INCOMPLETE');

    r = await h.call(server, 'DELETE', '/api/user/delete-account', {});
    assert.equal(r.status, 401);
  } finally { server.close(); }
});
