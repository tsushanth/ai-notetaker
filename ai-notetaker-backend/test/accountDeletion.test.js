const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteAccount, removeStoragePrefix, isUuid, OWNED_TABLES, STORAGE_PREFIXES } = require('../src/services/accountDeletionService');

const U = '11111111-1111-1111-1111-111111111111'; // the caller
const V = '11111111-1111-1111-1111-111111111112'; // another user whose id differs in the last character
const quiet = { info() {}, warn() {}, error() {} };

/**
 * In-memory stand-in for the production schema with TWO users.
 * - analytics_events has a plain FK to auth.users (blocks the auth delete while rows exist)
 * - storage is a flat map of "bucket/path" keys; list() returns the direct children of exactly that folder, like Storage does
 */
function fakeAdmin({ missing = [], failTables = [], authError = null, objects = [], storageFailsOn = null, noBucket = null } = {}) {
  const db = {};
  for (const t of ['analytics_events', 'notes', 'learning_sessions', 'shared_notes', 'recordings', 'users', 'subscriptions', 'learning_lessons', 'user_integrations', 'user_webhooks', 'challenges', 'challenge_participants']) {
    db[t] = [{ user_id: U, id: U, creator_user_id: U }, { user_id: V, id: V, creator_user_id: V }, { user_id: U, id: U, creator_user_id: U }];
  }
  const authUsers = new Set([U, V]);
  const order = [];
  const listed = [];
  const store = new Set(objects);
  const admin = {
    db, authUsers, order, listed, store, failStorage: storageFailsOn,
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
        list: async (prefix, { offset = 0, limit = 100 } = {}) => {
          listed.push(`${bucket}/${prefix}`);
          if (noBucket === bucket) return { data: null, error: { message: 'Bucket not found' } };
          if (admin.failStorage === bucket) return { data: null, error: { message: 'storage down' } };
          const base = `${bucket}/${prefix}/`;
          const kids = new Map();
          for (const key of store) {
            if (!key.startsWith(base)) continue;
            const rest = key.slice(base.length);
            const [first, ...more] = rest.split('/');
            kids.set(first, more.length ? { name: first, id: null } : { name: first, id: 'obj' });
          }
          return { data: [...kids.values()].slice(offset, offset + limit), error: null };
        },
        remove: async (paths) => { for (const p of paths) store.delete(`${bucket}/${p}`); return { error: null }; }
      })
    }
  };
  return admin;
}

const objectsFor = (id) => [
  `notetaker-files/${id}/recordings/a.m4a`, `notetaker-files/meetings/${id}/m1/recording.mp4`, `notetaker-files/infographics/${id}/n1/1.svg`,
  `documents/uploads/${id}/u.pdf`, `documents/scans/${id}/s.pdf`, `documents/pdfs/${id}/p.pdf`,
  `audio/podcasts/${id}/n_1.wav`, `audio/tts/${id}/n-1.wav`
];

test('regression: analytics_events rows are cleared before the auth user, so the auth delete succeeds', async () => {
  const admin = fakeAdmin();
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
  assert.equal(r.authDeleted, true);
  assert.equal(admin.authUsers.has(U), false);
  assert.equal(admin.db.analytics_events.filter((x) => x.user_id === U).length, 0);
  assert.ok(admin.order.indexOf('analytics_events') < admin.order.indexOf('auth'));
});

test('scoping: only the caller\'s rows, auth user and files are removed; another user (and a sibling prefix) is untouched', async () => {
  const sibling = [`documents/scans/${U}0/other.pdf`, `documents/scans/${U}-old/other.pdf`, `documents/pdfs/${U}x/other.pdf`, `audio/tts/${U.slice(0, -1)}/x.wav`];
  const admin = fakeAdmin({ objects: [...objectsFor(U), ...objectsFor(V), ...sibling] });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
  for (const key of objectsFor(U)) assert.equal(admin.store.has(key), false, `${key} removed`);
  for (const key of [...objectsFor(V), ...sibling]) assert.equal(admin.store.has(key), true, `${key} kept`);
  for (const [t] of OWNED_TABLES) {
    for (const row of admin.db[t] || []) assert.notEqual(row.user_id ?? row.id, U, `${t} has no row of the caller`);
  }
  assert.equal(admin.db.notes.filter((x) => x.user_id === V).length, 1, 'other user rows kept');
  assert.equal(admin.db.analytics_events.filter((x) => x.user_id === V).length, 1);
  assert.equal(admin.authUsers.has(V), true);
});

test('every prefix the backend writes to is covered, including documents/pdfs', () => {
  const prefixes = STORAGE_PREFIXES.map(([b, f]) => `${b}/${f('<id>')}`).sort();
  assert.deepEqual(prefixes, [
    'audio/podcasts/<id>', 'audio/tts/<id>',
    'documents/pdfs/<id>', 'documents/scans/<id>', 'documents/uploads/<id>',
    'notetaker-files/<id>', 'notetaker-files/infographics/<id>', 'notetaker-files/meetings/<id>'
  ]);
});

test('UUID guard: anything that is not a UUID throws before any storage or database call', async () => {
  for (const bad of ['', undefined, null, '   ', 'abc', '../..', `${U}/../${V}`, `${U}0`, `${U}\n`, 123, {}, [U]]) {
    const admin = fakeAdmin({ objects: objectsFor(U) });
    await assert.rejects(deleteAccount(admin, bad, quiet), TypeError, String(bad));
    assert.deepEqual(admin.listed, [], 'no list call');
    assert.deepEqual(admin.order, [], 'no delete call');
    assert.equal(admin.store.size, objectsFor(U).length);
  }
  assert.equal(isUuid(U), true);
  assert.equal(isUuid(U.toUpperCase()), true);
});

test('removeStoragePrefix refuses a bucket root or a prefix without a user id', async () => {
  const admin = fakeAdmin({ objects: objectsFor(U) });
  for (const bad of ['', '/', 'scans', 'scans/', 'scans/not-a-uuid', undefined]) {
    await assert.rejects(removeStoragePrefix(admin.storage, 'documents', bad), /user id/, String(bad));
  }
  assert.deepEqual(admin.listed, []);
});

test('mixed-case ids are normalised and still only touch that user', async () => {
  const admin = fakeAdmin({ objects: [...objectsFor(U), ...objectsFor(V)] });
  const r = await deleteAccount(admin, U.toUpperCase(), quiet);
  assert.equal(r.ok, true);
  assert.equal(admin.store.has(`documents/scans/${V}/s.pdf`), true);
  assert.equal(admin.store.has(`documents/scans/${U}/s.pdf`), false);
});

test('tables that do not exist in this environment (user_profiles, chat_messages) are skipped, not fatal', async () => {
  const admin = fakeAdmin({ missing: ['user_profiles', 'profiles'] });
  assert.equal((await deleteAccount(admin, U, quiet)).ok, true);
});

test('storage failure aborts BEFORE rows and the auth user are touched; a retry after recovery completes', async () => {
  const admin = fakeAdmin({ objects: [...objectsFor(U), ...objectsFor(V)], storageFailsOn: 'audio' });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failedSteps, ['storage:audio']);
  assert.deepEqual(admin.order, [], 'no row delete and no auth delete happened');
  assert.equal(admin.authUsers.has(U), true);
  assert.equal(admin.db.notes.filter((x) => x.user_id === U).length, 2);
  assert.equal(admin.store.has(`documents/scans/${U}/s.pdf`), false, 'buckets processed before the failure were already emptied');
  // storage recovers: the retry finishes everything
  admin.failStorage = null;
  const retry = await deleteAccount(admin, U, quiet);
  assert.equal(retry.ok, true);
  assert.equal(admin.authUsers.has(U), false);
  assert.equal(admin.store.has(`audio/tts/${U}/n-1.wav`), false);
  assert.equal(admin.store.has(`audio/tts/${V}/n-1.wav`), true);
});

test('retry after partial progress is idempotent (storage cleared earlier, rows half gone, auth failed once)', async () => {
  const admin = fakeAdmin({ authError: { status: 500, message: 'Database error deleting user' } });
  const first = await deleteAccount(admin, U, quiet);
  assert.equal(first.ok, false);
  assert.deepEqual(first.failedSteps, ['auth.users']);
  assert.equal(admin.authUsers.has(U), true);
  // the platform recovers: same data, a second request now succeeds
  admin.auth.admin.deleteUser = async (id) => { admin.authUsers.delete(id); return { error: null }; };
  const second = await deleteAccount(admin, U, quiet);
  assert.equal(second.ok, true);
  assert.equal(admin.authUsers.has(U), false);
  assert.equal(admin.authUsers.has(V), true);
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
  assert.equal((await deleteAccount(admin, U, quiet)).ok, true);
  assert.equal(admin.authUsers.has(U), false);
});

test('retrying after the auth user is already gone succeeds', async () => {
  const admin = fakeAdmin();
  admin.authUsers.delete(U);
  assert.equal((await deleteAccount(admin, U, quiet)).ok, true);
});

test('a bucket that does not exist in this environment is skipped; nested folders are removed recursively', async () => {
  const admin = fakeAdmin({ noBucket: 'audio', objects: [`documents/scans/${U}/2026/11/deep.pdf`, `documents/scans/${V}/2026/11/deep.pdf`] });
  const r = await deleteAccount(admin, U, quiet);
  assert.equal(r.ok, true);
  assert.equal(admin.store.has(`documents/scans/${U}/2026/11/deep.pdf`), false);
  assert.equal(admin.store.has(`documents/scans/${V}/2026/11/deep.pdf`), true);
});
