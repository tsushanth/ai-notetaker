const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteAccount, removeStoragePrefix, OWNED_TABLES } = require('../src/services/accountDeletionService');

const U = '11111111-1111-1111-1111-111111111111';
const quiet = { info() {}, warn() {}, error() {} };

/** In-memory stand-in for the production schema: analytics_events has a plain FK to auth.users (blocks the auth delete). */
function fakeAdmin({ tables = {}, missing = [], failTables = [], authError = null, files = {}, storageFails = false } = {}) {
  const db = { analytics_events: [{ user_id: U }, { user_id: U }], notes: [{ user_id: U }], learning_sessions: [{ user_id: U }], shared_notes: [{ user_id: U }], ...tables };
  const authUsers = new Set([U]);
  const order = [];
  const fileStore = { ...files };
  const admin = {
    db, authUsers, order, fileStore,
    from: (t) => ({
      delete: () => ({
        eq: async (col, id) => {
          order.push(t);
          if (missing.includes(t)) return { error: { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } };
          if (failTables.includes(t)) return { error: { code: '57014', message: 'statement timeout' } };
          db[t] = (db[t] || []).filter((r) => r[col] !== id);
          return { error: null };
        }
      })
    }),
    auth: {
      admin: {
        deleteUser: async (id) => {
          order.push('auth');
          if (authError) return { error: authError };
          if (!authUsers.has(id)) return { error: { status: 404, code: 'user_not_found', message: 'User not found' } };
          if ((db.analytics_events || []).some((r) => r.user_id === id)) return { error: { status: 500, message: 'Database error deleting user' } };
          authUsers.delete(id);
          return { error: null };
        }
      }
    },
    storage: {
      from: (bucket) => ({
        list: async (prefix, { offset = 0, limit = 100 }) => {
          if (storageFails) return { data: null, error: { message: 'storage down' } };
          const entries = (fileStore[`${bucket}/${prefix}`] || []).slice(offset, offset + limit);
          return { data: entries, error: null };
        },
        remove: async (paths) => { for (const p of paths) for (const k of Object.keys(fileStore)) fileStore[k] = fileStore[k].filter((e) => `${k.split('/').slice(1).join('/')}/${e.name}` !== p); return { error: null }; }
      })
    }
  };
  return admin;
}

test('regression: analytics_events rows are cleared before the auth user, so the auth delete succeeds', async () => {
  const admin = fakeAdmin();
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
  assert.equal(r.authDeleted, true);
  assert.equal(admin.authUsers.has(U), false);
  assert.equal(admin.db.analytics_events.length, 0);
  assert.ok(admin.order.indexOf('analytics_events') < admin.order.indexOf('auth'));
});

test('tables with no foreign key to the user are cleared too', async () => {
  const admin = fakeAdmin();
  await deleteAccount(admin, U, quiet);
  for (const t of ['learning_sessions', 'shared_notes', 'notes']) assert.equal(admin.db[t].length, 0, t);
  const tables = OWNED_TABLES.map(([t]) => t);
  for (const t of ['learning_lessons', 'user_integrations', 'user_webhooks', 'challenges', 'challenge_participants', 'users', 'profiles']) assert.ok(tables.includes(t), `${t} covered`);
});

test('tables that do not exist in this environment (user_profiles, chat_messages) are skipped, not fatal', async () => {
  const admin = fakeAdmin({ missing: ['user_profiles', 'profiles'] });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
});

test('a real row-delete failure stops before the auth delete and reports not ok', async () => {
  const admin = fakeAdmin({ failTables: ['notes'] });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failedSteps, ['notes']);
  assert.equal(admin.order.includes('auth'), false);
  assert.equal(admin.authUsers.has(U), true);
});

test('auth delete that keeps failing is reported as not ok (never success)', async () => {
  const admin = fakeAdmin({ authError: { status: 500, message: 'Database error deleting user' } });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, false);
  assert.equal(r.authDeleted, false);
  assert.deepEqual(r.failedSteps, ['auth.users']);
  assert.equal(admin.order.filter((s) => s === 'auth').length, 2, 'one retry');
});

test('a row inserted between the sweep and the auth delete is swept on the retry', async () => {
  const admin = fakeAdmin();
  const real = admin.auth.admin.deleteUser;
  let first = true;
  admin.auth.admin.deleteUser = async (id) => { if (first) { first = false; admin.db.analytics_events.push({ user_id: id }); } return real(id); };
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
  assert.equal(admin.authUsers.has(U), false);
});

test('retrying after the auth user is already gone succeeds (idempotent)', async () => {
  const admin = fakeAdmin();
  admin.authUsers.delete(U);
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
});

test('storage: user files are removed recursively; a storage outage is a warning, not a stuck account', async () => {
  const admin = fakeAdmin({ files: { [`documents/scans/${U}`]: [{ name: 'a.pdf', id: 'x' }], [`audio/podcasts/${U}`]: [{ name: 'sub', id: null }], [`audio/podcasts/${U}/sub`]: [{ name: 'p.wav', id: 'y' }] } });
  assert.equal(await removeStoragePrefix(admin.storage, 'documents', `scans/${U}`), 1);
  assert.equal(await removeStoragePrefix(admin.storage, 'audio', `podcasts/${U}`), 1);
  assert.equal(admin.fileStore[`documents/scans/${U}`].length, 0);
  assert.equal(admin.fileStore[`audio/podcasts/${U}/sub`].length, 0);
  const down = fakeAdmin({ storageFails: true });
  const r = await deleteAccount(down, U, quiet);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.startsWith('storage:')));
});
