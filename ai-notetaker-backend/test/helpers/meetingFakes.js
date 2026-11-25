'use strict';
// In-memory Supabase for the meeting tables, with the filters the meeting code relies on, plus the module stubs that let the
// real meetingService, recallService (methods replaced per test) and meetingSweeper run without a network.
const path = require('node:path');

process.env.NODE_ENV = 'test';

function stub(rel, exports) {
  const abs = require.resolve(path.join(__dirname, '..', '..', 'src', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

const db = { meetings: [], bot_runs: [], meeting_recordings: [] };
const notes = [];
const storage = { uploadError: null };

function from(name) {
  const rows = db[name];
  const q = { filters: [], patch: null, inserted: null, columns: '' };
  const add = (fn) => { q.filters.push(fn); return q; };
  q.select = (columns = '*') => { q.columns = columns; return q; };
  q.eq = (c, v) => add((r) => r[c] === v);
  q.neq = (c, v) => add((r) => r[c] !== v);
  q.in = (c, vs) => add((r) => vs.includes(r[c]));
  q.is = (c, v) => add((r) => (r[c] ?? null) === v);
  q.lt = (c, v) => add((r) => r[c] < v);
  q.not = (c, op, list) => {
    if (op !== 'in') throw new Error(`fake db: not.${op} is not supported`);
    const values = list.replace(/[()"]/g, '').split(',');
    return add((r) => !values.includes(r[c]));
  };
  q.order = () => q;
  q.limit = () => q;
  q.range = () => q;
  q.update = (patch) => { q.patch = patch; return q; };
  q.insert = (row) => { q.inserted = { id: `${name}-${rows.length + 1}`, ...row }; return q; };
  const join = (r) => {
    const out = { ...r };
    if (q.columns.includes('bot_runs')) out.bot_runs = db.bot_runs.filter((b) => b.meeting_id === r.id).map((b) => ({ ...b }));
    if (q.columns.includes('meetings(')) out.meetings = { ...db.meetings.find((m) => m.id === r.meeting_id) };
    return out;
  };
  const run = () => {
    if (q.inserted) { rows.push(q.inserted); return { data: [{ ...q.inserted }], error: null }; }
    const hit = rows.filter((r) => q.filters.every((f) => f(r)));
    if (q.patch) hit.forEach((r) => Object.assign(r, q.patch));
    return { data: hit.map(join), error: null, count: hit.length };
  };
  q.single = async () => {
    const { data } = run();
    return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
  };
  q.then = (res, rej) => Promise.resolve(run()).then(res, rej);
  return q;
}

const supabaseAdmin = { from };
stub('utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('config/supabase', { supabaseAdmin, supabase: supabaseAdmin });
stub('services/noteService', { createNote: async (userId, note) => { notes.push({ userId, ...note }); return { id: `note-${notes.length}` }; } });
stub('services/storageService', {
  bucket: 'test',
  getAdminClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: storage.uploadError }) }) } }),
});

const recall = require('../../src/services/recallService');
const meetings = require('../../src/services/meetingService');

const pending = [];
const processOriginal = meetings.processRecordingAsync.bind(meetings);
meetings.processRecordingAsync = (...args) => { const p = processOriginal(...args); pending.push(p); return p; };
meetings.processingDelayMs = 0;
meetings.transcriptRetryMs = 0;
/** Wait for the processing that a status event scheduled. */
async function settle() {
  await new Promise((r) => setTimeout(r, 5));
  await Promise.all(pending.splice(0));
}

const T = (minute, second = 0) => new Date(Date.UTC(2026, 0, 1, 12, minute, second)).toISOString();
const change = (code, minute, subCode = null) => ({ code, sub_code: subCode, created_at: T(minute) });
/** A GET /bot/{id} response. */
const bot = (changes, recordings = []) => ({ id: 'bot-1', status_changes: changes, recordings });

function seed({ meeting = {}, run = {}, noRun = false } = {}) {
  db.meetings.length = 0; db.bot_runs.length = 0; db.meeting_recordings.length = 0; notes.length = 0;
  storage.uploadError = null;
  db.meetings.push({ id: 'm1', user_id: 'u1', title: 'Standup', platform: 'zoom', status: 'bot_joining', note_id: null, error_message: null, scheduled_start: null, created_at: T(0), updated_at: T(0), ...meeting });
  if (!noRun) db.bot_runs.push({ id: 'r1', meeting_id: 'm1', recall_bot_id: 'bot-1', status: 'joining', join_time: null, leave_time: null, recall_status: {}, created_at: T(0), ...run });
}

/** Replace what the Recall API returns. Unset parts fail the way recallService reports them. */
function recallReturns({ status, transcript, recording } = {}) {
  const calls = { status: 0, transcript: 0, recording: 0 };
  recall.getBotStatus = async () => { calls.status += 1; if (!status || status instanceof Error) throw status || new Error('Failed to get bot status'); return status; };
  recall.getTranscript = async () => { calls.transcript += 1; if (transcript === undefined) throw new Error('Failed to get meeting transcript'); return transcript; };
  recall.getRecordingUrl = async () => { calls.recording += 1; if (!recording) throw new Error('Failed to get meeting recording'); return recording; };
  meetings.downloadRecording = async () => Buffer.from('video');
  return calls;
}

module.exports = { db, notes, storage, supabaseAdmin, recall, meetings, settle, seed, recallReturns, change, bot, T };
