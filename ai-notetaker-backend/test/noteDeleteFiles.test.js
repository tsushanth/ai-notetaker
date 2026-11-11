const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_STORAGE_BUCKET = 'notetaker-files';

// Deleting a note removes the stored files that belong to THAT note (and only those), and a missing file
// or a storage failure never blocks the note delete.

const U = '11111111-1111-1111-1111-111111111111'; // caller
const V = '22222222-2222-2222-2222-222222222222'; // another user
const N = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // the note being deleted
const N2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // another note of the caller
const R1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const R2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const logs = { error: [], warn: [] };
const logger = { info() {}, debug() {}, warn: (m) => logs.warn.push(m), error: (m) => logs.error.push(String(m)) };

function stub(rel, exports) {
  const abs = require.resolve(rel);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

let db;
let store;
let removeCalls;
let storageMode; // 'ok' | 'down' | 'throw'
let notesDeleteError;

function table(name) {
  const q = { filters: [], op: 'select' };
  const rows = () => (db[name] = db[name] || []);
  const run = () => {
    const hit = rows().filter((r) => q.filters.every((f) => f(r)));
    if (q.op === 'delete') {
      if (name === 'notes' && notesDeleteError) return { data: null, error: notesDeleteError };
      db[name] = rows().filter((r) => !hit.includes(r));
      if (name === 'notes') {
        // ON DELETE CASCADE, as in production
        for (const dep of ['recordings', 'ai_content']) db[dep] = (db[dep] || []).filter((r) => !hit.some((n) => n.id === r.note_id));
      }
      return { data: null, error: null };
    }
    return { data: hit, error: null };
  };
  const b = {
    select: () => b,
    delete: () => { q.op = 'delete'; return b; },
    eq: (c, v) => { q.filters.push((r) => r[c] === v); return b; },
    in: (c, vs) => { q.filters.push((r) => vs.includes(r[c])); return b; },
    maybeSingle: async () => { const { data } = run(); return { data: data[0] || null, error: null }; },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

const admin = {
  from: (n) => table(n),
  storage: {
    from: (bucket) => ({
      remove: async (paths) => {
        removeCalls.push({ bucket, paths });
        if (storageMode === 'throw') throw new Error('socket hang up');
        if (storageMode === 'down') return { data: null, error: { message: 'storage unavailable' } };
        for (const p of paths) store.delete(`${bucket}/${p}`); // a missing object is silently fine, like Storage
        return { data: [], error: null };
      },
    }),
  },
};

stub('../src/utils/logger', { logger });
stub('../src/config/supabase', { supabase: {}, supabaseAdmin: admin });
stub('../src/utils/failureReporter', { reportFailure() {}, reportCounted() {}, reportBackendError() {}, reportCrash() {} });
const noteService = require('../src/services/noteService');
const cleanup = require('../src/services/noteFileCleanup');

function reset() {
  logs.error.length = 0;
  removeCalls = [];
  storageMode = 'ok';
  notesDeleteError = null;
  db = {
    notes: [
      { id: N, user_id: U, metadata: { file_path: `uploads/${U}/doc.pdf`, recording_id: R1 } },
      { id: N2, user_id: U, metadata: { file_path: `uploads/${U}/other.pdf` } },
    ],
    recordings: [
      { id: R1, user_id: U, note_id: N, storage_path: `${U}/recordings/r1.m4a` },
      { id: R2, user_id: U, note_id: N2, storage_path: `${U}/recordings/r2.m4a` },
    ],
    ai_content: [
      { note_id: N, content: { audio_url: `https://x.supabase.co/storage/v1/object/public/audio/tts/${U}/${N}-123.wav` } },
      { note_id: N, content: { image_url: `https://x.supabase.co/storage/v1/object/public/notetaker-files/infographics/${U}/${N}/9.svg` } },
      { note_id: N2, content: { audio_url: `https://x.supabase.co/storage/v1/object/public/audio/tts/${U}/${N2}-456.wav` } },
    ],
  };
  store = new Set([
    `documents/uploads/${U}/doc.pdf`, `documents/uploads/${U}/other.pdf`,
    `notetaker-files/${U}/recordings/r1.m4a`, `notetaker-files/${U}/recordings/r2.m4a`,
    `audio/tts/${U}/${N}-123.wav`, `audio/tts/${U}/${N2}-456.wav`,
    `notetaker-files/infographics/${U}/${N}/9.svg`,
    `documents/uploads/${V}/victim.pdf`, `notetaker-files/${V}/recordings/victim.m4a`,
  ]);
}

test('deleting a note removes its audio, document and generated files, and nothing else', async () => {
  reset();
  assert.equal(await noteService.deleteNote(U, N), true);
  assert.deepEqual([...store].sort(), [
    `audio/tts/${U}/${N2}-456.wav`, `documents/uploads/${U}/other.pdf`, `documents/uploads/${V}/victim.pdf`,
    `notetaker-files/${U}/recordings/r2.m4a`, `notetaker-files/${V}/recordings/victim.m4a`,
  ].sort());
  assert.equal(db.notes.some((n) => n.id === N), false);
  assert.equal(db.notes.some((n) => n.id === N2), true);
  assert.equal(db.recordings.some((r) => r.id === R2), true);
});

test('a forged metadata path (other user, traversal, wrong folder) is never removed', async () => {
  reset();
  db.notes[0].metadata = {
    file_path: `uploads/${V}/victim.pdf`,
    storage_path: `scans/${U}/../../uploads/${V}/victim.pdf`,
    recording_id: R1,
  };
  db.recordings.push({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', user_id: V, note_id: N, storage_path: `${V}/recordings/victim.m4a` });
  await noteService.deleteNote(U, N);
  assert.ok(store.has(`documents/uploads/${V}/victim.pdf`));
  assert.ok(store.has(`notetaker-files/${V}/recordings/victim.m4a`));
  const removed = removeCalls.flatMap((c) => c.paths.map((p) => `${c.bucket}/${p}`));
  assert.ok(!removed.some((p) => p.includes(V)));
  assert.ok(!removed.some((p) => p.includes('..')));
});

test('another user cannot delete the note or its files', async () => {
  reset();
  assert.equal(await noteService.deleteNote(V, N), true); // nothing matches the caller: idempotent success, no work
  assert.equal(db.notes.some((n) => n.id === N), true);
  assert.equal(removeCalls.length, 0);
  assert.ok(store.has(`documents/uploads/${U}/doc.pdf`));
});

test('a file that is already gone does not fail the note delete', async () => {
  reset();
  store.clear();
  assert.equal(await noteService.deleteNote(U, N), true);
  assert.equal(db.notes.some((n) => n.id === N), false);
  assert.equal(logs.error.length, 0);
});

test('a storage failure is logged but the note is still deleted', async () => {
  for (const mode of ['down', 'throw']) {
    reset();
    storageMode = mode;
    assert.equal(await noteService.deleteNote(U, N), true);
    assert.equal(db.notes.some((n) => n.id === N), false);
    assert.ok(logs.error.some((m) => /orphaned/.test(m) && m.includes(`uploads/${U}/doc.pdf`)));
  }
});

test('if the note row cannot be deleted, no file is touched', async () => {
  reset();
  notesDeleteError = { message: 'statement timeout' };
  await assert.rejects(() => noteService.deleteNote(U, N), /Failed to delete note/);
  assert.equal(removeCalls.length, 0);
  assert.equal(store.size, 9);
});

test('a recording that was never linked to the note (note_id empty) is still removed via metadata.recording_id', async () => {
  reset();
  db.recordings[0].note_id = null;
  await noteService.deleteNote(U, N);
  assert.ok(!store.has(`notetaker-files/${U}/recordings/r1.m4a`));
  assert.equal(db.recordings.some((r) => r.id === R1), false);
});

test('path helpers reject traversal and non-object paths', () => {
  assert.equal(cleanup.isCleanPath('a/b.pdf'), true);
  for (const bad of ['', '/a', 'a/', 'a//b', 'a/../b', './a', 'a\\b', null]) assert.equal(cleanup.isCleanPath(bad), false, String(bad));
  assert.deepEqual(cleanup.parsePublicUrl('https://x.supabase.co/storage/v1/object/public/audio/tts/u/n-1.wav?t=1'), { bucket: 'audio', path: 'tts/u/n-1.wav' });
  assert.equal(cleanup.parsePublicUrl('https://evil.example/file.wav'), null);
});
