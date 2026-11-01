const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
function stub(rel, exports) { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; }
const reports = [];
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('../src/utils/failureReporter', { reportFailure: (flow, err, ctx) => reports.push({ flow, message: err.message, ctx }) });
const rec = require('../src/services/recordingReconciler');

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000, H = 3600000, D = 24 * H;
let uid = 0;
const row = (status, createdAgo, updatedAgo = createdAgo, id = `r${Math.random()}`, extra = {}) => ({ id, user_id: `u${uid++}`, status, created_at: ago(createdAgo), updated_at: ago(updatedAgo), ...extra });
const noSpeech = (createdAgo, extra = {}) => row('failed', createdAgo, createdAgo, undefined, { error_message: 'NO_SPEECH: audio 8.2s, detected language en (confidence 0), file 99 KB', ...extra });

test('evaluate: healthy pipeline raises nothing', () => {
  const ev = rec.evaluate([row('completed', 2 * H), row('completed', 5 * H), row('failed', 3 * H)], 2, NOW);
  assert.equal(ev.stuckProcessing.length, 0);
  assert.equal(ev.stuckUploadedCount, 0);
  assert.equal(ev.zeroCompleted24h, false);
  assert.equal(ev.deadman, false);
});

test('evaluate: processing past threshold is stuck, fresh processing is not', () => {
  const ev = rec.evaluate([row('processing', 40 * MIN), row('processing', 2 * MIN)], 5, NOW);
  assert.equal(ev.stuckProcessing.length, 1);
});

test('evaluate: uploaded stuck only inside the lookback and past the threshold', () => {
  const ev = rec.evaluate([row('uploaded', 3 * H), row('uploaded', 10 * MIN), row('uploaded', 3 * D)], 5, NOW);
  assert.equal(ev.stuckUploadedCount, 1);
});

test('evaluate: zero completed in 24h with uploads, and dead-man over 3 days', () => {
  const ev = rec.evaluate([row('failed', 2 * H), row('failed', 3 * H), row('failed', 4 * H), row('failed', 30 * H)], 0, NOW);
  assert.equal(ev.zeroCompleted24h, true);
  assert.equal(ev.deadman, true);
  assert.equal(ev.failed24, 3);
  assert.equal(ev.uploadsInDeadmanWindow, 4);
});

test('evaluate: low traffic is not an outage (1-2 failed uploads, or one user repeating)', () => {
  const one = rec.evaluate([row('failed', 2 * H, 2 * H, undefined, { error_message: 'PROVIDER_ERROR: Deepgram HTTP 401' })], 0, NOW);
  assert.equal(one.zeroCompleted24h, false);
  assert.equal(one.deadman, false);
  const sameUser = ['a', 'b', 'c'].map((x, i) => row('failed', (i + 1) * H, undefined, x, { user_id: 'only-user' }));
  const ev = rec.evaluate(sameUser, 0, NOW);
  assert.equal(ev.zeroCompleted24h, false);
  assert.equal(ev.deadman, false);
});

test('evaluate: NO_SPEECH failures (new and legacy text) are the audio, not the pipeline', () => {
  const legacy = row('failed', 5 * H, 5 * H, undefined, { error_message: 'No speech detected in the recording' });
  const ev = rec.evaluate([noSpeech(2 * H), noSpeech(3 * H), legacy, noSpeech(40 * H)], 0, NOW);
  assert.equal(ev.zeroCompleted24h, false);
  assert.equal(ev.deadman, false);
  assert.equal(ev.uploadsInDeadmanWindow, 0);
  // but they do not hide a real outage next to them
  const mixed = rec.evaluate([noSpeech(1 * H), row('failed', 2 * H), row('failed', 3 * H), row('failed', 4 * H)], 0, NOW);
  assert.equal(mixed.deadman, true);
});

test('evaluate: rows still in flight do not count as attempts', () => {
  const ev = rec.evaluate([row('processing', 2 * MIN), row('processing', 3 * MIN), row('uploaded', 5 * MIN), row('failed', 1 * H)], 0, NOW);
  assert.equal(ev.uploadsInDeadmanWindow, 1);
  assert.equal(ev.deadman, false);
});

test('evaluate: no uploads at all is NOT an alarm (tiny traffic)', () => {
  const ev = rec.evaluate([], 0, NOW);
  assert.equal(ev.zeroCompleted24h, false);
  assert.equal(ev.deadman, false);
});

// minimal supabase fake
function fakeDb({ rows = [], oldProcessing = [], completed = 0, queryError = null, updated = [] }) {
  return {
    updates: updated,
    from() {
      const st = { filters: {}, patch: null, head: false };
      const b = {
        select(_c, opts) { if (opts && opts.head) st.head = true; return b; },
        gte(col) { st.filters.gte = col; return b; },
        lt() { st.filters.lt = true; return b; },
        eq(col, v) { st.filters[col] = v; return b; },
        order() { return b; },
        limit() { return b; },
        update(p) { st.patch = p; return b; },
        then(res, rej) {
          let out;
          if (queryError) out = { data: null, count: null, error: { message: queryError } };
          else if (st.patch) { updated.push({ patch: st.patch, filters: st.filters }); out = { data: [{ id: st.filters.id }], error: null }; }
          else if (st.head) out = { count: completed, error: null };
          else if (st.filters.status === 'processing') out = { data: oldProcessing, error: null };
          else out = { data: rows, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}

test('reconcile: stuck processing is marked failed with compare-and-set and reported once with counts only', async () => {
  rec._resetForTests(); reports.length = 0;
  const stuck = row('processing', 2 * H, 2 * H, 'secret-id-1');
  const db = fakeDb({ rows: [stuck, row('completed', 1 * H)], completed: 3 });
  await rec.reconcileRecordings({ db, now: NOW });
  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].patch.status, 'failed');
  assert.match(db.updates[0].patch.error_message, /^PROCESSING_INTERRUPTED/);
  assert.equal(db.updates[0].filters.status, 'processing');
  assert.equal(db.updates[0].filters.updated_at, stuck.updated_at);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].message, 'Recording stuck in processing (marked failed)');
  assert.equal(reports[0].ctx.code, 'STUCK_PROCESSING');
  assert.ok(!JSON.stringify(reports).includes('secret-id-1'));
  // second pass inside cooldown: no second email
  await rec.reconcileRecordings({ db: fakeDb({ rows: [stuck, row('completed', 1 * H)], completed: 3 }), now: NOW + 10 * MIN });
  assert.equal(reports.length, 1);
});

test('reconcile: dead-man and zero-completed both fire when everything failed', async () => {
  rec._resetForTests(); reports.length = 0;
  const db = fakeDb({ rows: [row('failed', 2 * H), row('failed', 3 * H), row('failed', 4 * H), row('failed', 40 * H)], completed: 0 });
  await rec.reconcileRecordings({ db, now: NOW });
  const codes = reports.map((r) => r.ctx.code).sort();
  assert.deepEqual(codes, ['PIPELINE_DEADMAN', 'ZERO_COMPLETED_24H']);
});

test('reconcile: the 2026-11-01 false positive (one silent upload, nothing else in 3 days) sends nothing', async () => {
  rec._resetForTests(); reports.length = 0;
  await rec.reconcileRecordings({ db: fakeDb({ rows: [noSpeech(2 * H)], completed: 0 }), now: NOW });
  assert.equal(reports.length, 0);
});

test('reconcile: a stuck uploaded row reports but is not modified', async () => {
  rec._resetForTests(); reports.length = 0;
  const db = fakeDb({ rows: [row('uploaded', 5 * H), row('completed', 1 * H)], completed: 1 });
  await rec.reconcileRecordings({ db, now: NOW });
  assert.equal(db.updates.length, 0);
  assert.equal(reports[0].ctx.code, 'STUCK_UPLOADED');
  assert.equal(reports[0].ctx.stuck_count, '1');
});

test('reconcile: a failing query reports RECONCILER_QUERY_FAILED instead of going silent', async () => {
  rec._resetForTests(); reports.length = 0;
  const out = await rec.reconcileRecordings({ db: fakeDb({ queryError: 'connection refused' }), now: NOW });
  assert.equal(out, null);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].ctx.code, 'RECONCILER_QUERY_FAILED');
  assert.ok(!JSON.stringify(reports).includes('connection refused'));
});

test('reconcile: healthy data sends nothing', async () => {
  rec._resetForTests(); reports.length = 0;
  await rec.reconcileRecordings({ db: fakeDb({ rows: [row('completed', 1 * H), row('failed', 3 * H)], completed: 4 }), now: NOW });
  assert.equal(reports.length, 0);
});
