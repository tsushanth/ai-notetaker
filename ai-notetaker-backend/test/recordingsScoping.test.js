const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

// The recordings read/list/delete paths run on the service-role client (the anon client sees no rows
// once RLS is on). That client bypasses RLS, so these tests pin the thing RLS used to guarantee:
// every query is scoped to the authenticated user id.

const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((l) => [l, () => {}]));
const deletedFiles = [];
let rows;
const queries = [];

function stub(rel, exports) {
  const abs = require.resolve(rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// A tiny in-memory table with the supabase-js builder surface the service uses.
function table() {
  const q = { filters: [], op: 'select', count: false, range: null };
  queries.push(q);
  const run = () => {
    let out = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
    if (q.op === 'delete') {
      rows = rows.filter((r) => !out.includes(r));
      return { data: null, error: null };
    }
    const total = out.length;
    if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
    return { data: out, error: null, count: q.count ? total : null };
  };
  const b = {
    select: (_cols, opts) => { q.count = !!(opts && opts.count); return b; },
    delete: () => { q.op = 'delete'; return b; },
    eq: (c, v) => { q.filters.push([c, v]); return b; },
    order: () => b,
    range: (a, z) => { q.range = [a, z]; return b; },
    single: () => {
      const { data } = run();
      return Promise.resolve(data.length === 1
        ? { data: data[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
    },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

stub('../src/utils/logger', { logger });
// The anon client must never be used for these tables: any call on it fails the test loudly.
const anon = new Proxy({}, { get() { throw new Error('anon client used'); } });
stub('../src/config/supabase', { supabase: anon, supabaseAdmin: { from: () => table() } });
stub('../src/utils/failureReporter', { reportFailure() {}, reportCounted() {}, reportBackendError() {}, reportCrash() {} });
stub('../src/config/openai', { MODELS: {} });
stub('../src/services/noteService', { createNote: async () => ({ id: 'n' }) });
stub('../src/utils/audioLevel', { measureLevel: async () => null });
stub('../src/services/storageService', { downloadFile: async () => Buffer.alloc(1), deleteFile: async (p) => { deletedFiles.push(p); } });

const service = require('../src/services/transcriptionService');

const mine = { id: 'rec-mine', user_id: 'u1', storage_path: 'u1/a.m4a', status: 'completed' };
const mine2 = { id: 'rec-mine-2', user_id: 'u1', storage_path: 'u1/b.m4a', status: 'uploaded' };
const theirs = { id: 'rec-theirs', user_id: 'u2', storage_path: 'u2/a.m4a', status: 'completed' };

test.beforeEach(() => { rows = [mine, mine2, theirs].map((r) => ({ ...r })); queries.length = 0; deletedFiles.length = 0; });

const userFilter = (q) => q.filters.find(([c]) => c === 'user_id');

test('getRecording returns the caller\'s own row and filters on user_id', async () => {
  const row = await service.getRecording('u1', 'rec-mine');
  assert.equal(row.id, 'rec-mine');
  assert.deepEqual(userFilter(queries[0]), ['user_id', 'u1']);
});

test('getRecording does not return another user\'s row, even with its exact id', async () => {
  assert.equal(await service.getRecording('u1', 'rec-theirs'), null);
  assert.equal(await service.getRecording('u2', 'rec-mine'), null);
});

test('getRecordings lists only the caller\'s rows and filters on user_id', async () => {
  const out = await service.getRecordings('u1', { page: 1, limit: 20 });
  assert.deepEqual(out.recordings.map((r) => r.id).sort(), ['rec-mine', 'rec-mine-2']);
  assert.equal(out.pagination.total, 2);
  assert.deepEqual(userFilter(queries[0]), ['user_id', 'u1']);
  const other = await service.getRecordings('u2');
  assert.deepEqual(other.recordings.map((r) => r.id), ['rec-theirs']);
});

test('deleteRecording removes only the caller\'s row; the delete query itself carries the user_id filter', async () => {
  assert.equal(await service.deleteRecording('u1', 'rec-mine'), true);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['rec-mine-2', 'rec-theirs']);
  assert.deepEqual(deletedFiles, ['u1/a.m4a']);
  const del = queries.find((q) => q.op === 'delete');
  assert.deepEqual(userFilter(del), ['user_id', 'u1']);
  assert.ok(del.filters.some(([c, v]) => c === 'id' && v === 'rec-mine'));
});

test('deleteRecording of another user\'s id is a no-op: false, row and file untouched', async () => {
  assert.equal(await service.deleteRecording('u1', 'rec-theirs'), false);
  assert.ok(rows.some((r) => r.id === 'rec-theirs'));
  assert.deepEqual(deletedFiles, []);
  assert.equal(queries.some((q) => q.op === 'delete'), false);
});
