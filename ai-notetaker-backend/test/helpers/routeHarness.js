'use strict';
// Route-level test harness: real routers and real middleware, with the database, auth and the heavy services replaced.
//
//   const h = require('./helpers/routeHarness');
//   h.install();                                   // BEFORE requiring any route (swaps modules in require.cache)
//   const app = h.makeApp({ '/api/ai': require('../src/routes/ai') });
//   const server = await h.listen(app);
//   const r = await h.call(server, 'POST', '/api/ai/summary', { user: 'u1', body: {...} });
//
// `h.db` is an in-memory fake of the Supabase tables the middleware reads (subscriptions, usage_tracking, meetings, llm_calls ...);
// inserts made by recordUsage land in it, so cap tests exercise the same counting path as production. Every test file runs in
// its own process under `node --test`, so the module swaps never leak between files.
const path = require('node:path');
const http = require('node:http');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dummy';
process.env.FAILURE_REPORTER_DISABLED = '1';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'dummy';

const db = {};
const resetDb = () => { for (const k of Object.keys(db)) delete db[k]; };

function table(name) {
  const rows = (db[name] = db[name] || []);
  const q = { filters: [], wantCount: false, head: false, range: null, mutation: null };
  const add = (fn) => { q.filters.push(fn); return q; };
  q.select = (_cols, opts = {}) => { if (opts.count) q.wantCount = true; if (opts.head) q.head = true; return q; };
  q.eq = (c, v) => add((r) => r[c] === v);
  q.neq = (c, v) => add((r) => r[c] !== v);
  q.in = (c, vs) => add((r) => vs.includes(r[c]));
  q.gte = (c, v) => add((r) => r[c] >= v);
  q.lte = (c, v) => add((r) => r[c] <= v);
  q.is = (c, v) => add((r) => (r[c] ?? null) === v);
  q.not = () => q;
  q.order = () => q;
  q.limit = () => q;
  q.range = (a, b) => { q.range = [a, b]; return q; };
  const run = () => {
    const all = rows.filter((r) => q.filters.every((f) => f(r)));
    const page = Array.isArray(q.range) ? all.slice(q.range[0], q.range[1] + 1) : all;
    return { data: q.head ? null : page, count: q.wantCount ? all.length : null, error: null };
  };
  q.single = async () => { const { data } = run(); return data && data.length ? { data: data[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } }; };
  q.maybeSingle = async () => { const { data } = run(); return { data: data && data.length ? data[0] : null, error: null }; };
  q.then = (res, rej) => Promise.resolve(run()).then(res, rej);
  q.insert = (row) => {
    const list = [].concat(row).map((r) => ({ ...r }));
    rows.push(...list);
    const p = Promise.resolve({ data: list, error: null });
    p.select = () => ({ single: async () => ({ data: list[0], error: null }) });
    return p;
  };
  const noop = () => { const p = Promise.resolve({ data: null, error: null }); p.eq = () => p; p.select = () => ({ single: async () => ({ data: null, error: null }) }); return p; };
  q.upsert = noop; q.update = noop; q.delete = noop;
  return q;
}
const fakeSupabase = { createClient: () => ({ from: table, storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://signed.example/u' }, error: null }), download: async () => ({ data: null, error: { message: 'no storage in tests' } }) }) }, auth: {} }) };

const swap = (relPath, exports) => {
  const full = require.resolve(path.join(__dirname, '..', '..', 'src', relPath));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};
const swapPkg = (name, exports) => {
  const full = require.resolve(name);
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

/** Headers: x-test-user sets req.userId (no header -> 401). */
const auth = (req, res, next) => {
  const id = req.headers['x-test-user'];
  if (!id) return res.status(401).json({ success: false, error: 'Authentication required' });
  req.userId = id; req.user = { id };
  next();
};

const calls = {}; // service stub call log, by name
const stub = (name, value) => (...args) => { (calls[name] = calls[name] || []).push(args); return typeof value === 'function' ? value(...args) : value; };

function install() {
  // Job-cleanup timers of 5-10 minutes (uploads.js) must not keep the test process alive.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); if (ms >= 60000 && t && t.unref) t.unref(); return t; };
  const netOff = () => Promise.reject(new Error('network disabled in tests'));
  swapPkg('axios', { post: netOff, get: netOff, put: netOff, delete: netOff, request: netOff, create() { return this; }, isAxiosError: () => false });
  swapPkg('@supabase/supabase-js', fakeSupabase);
  swap('middleware/auth.js', { authenticate: auth, optionalAuth: auth });
  swap('middleware/validation.js', { validate: () => (req, res, next) => { req.validatedBody = req.body; next(); } });
  swap('config/openai.js', { llmUsage: { record() {}, instrument() {} }, anthropic: {}, MODELS: {}, PRICING: {} });
  swap('services/exportService.js', { generatePDF: stub('exportPdf', { buffer: Buffer.from('%PDF'), filename: 'n.pdf' }), generateDOCX: stub('exportDocx', { buffer: Buffer.from('docx'), filename: 'n.docx' }) });
  swap('services/learningService.js', { startSession: stub('learn.start', { session: { id: 's1' } }), submitLessonResponse: stub('learn.submit', { score: 1 }), getSessionStatus: stub('x', {}), getUserSessions: stub('x', []), getSessions: stub('x', []) });
  swap('services/noteService.js', { getNoteById: stub('getNoteById', async (userId, id) => ({ id, user_id: userId, content: 'x'.repeat(300), title: 't' })), createNote: stub('createNote', {}) });
  swap('services/integrationService.js', { getConnectedIntegrations: stub('x', []), registerWebhook: stub('webhook', { id: 'w1' }), deleteWebhook: stub('x', true) });
  swap('services/shareService.js', {
    createShareLink: stub('share.create', async () => ({ shareId: 'sh1', shareUrl: 'https://x/shared/t' })),
    getUserShares: async (...a) => { (calls['share.list'] = calls['share.list'] || []).push(a); return harness.shares.slice(); }
  });
  swap('services/aiService.js', {
    generateSummary: stub('ai.summary', { summary: 's' }), generateQuiz: stub('ai.quiz', {}), generateFlashcards: stub('ai.flashcards', {}),
    chatWithNote: stub('ai.chat', {}), generateChatSuggestions: stub('ai.suggestions', []), generateMindMap: stub('ai.mindmap', {}), generateDiagram: stub('ai.diagram', {}),
    generatePodcastScriptOnly: stub('ai.podcastScript', { id: 'p1', note_id: 'n1', script: 'hi', duration: 1, style: 'x' }),
    generateInfographic: stub('ai.infographic', { url: 'u' }), generatePodcast: stub('ai.podcast', {})
  });
  swap('services/formattingService.js', { formatNoteById: stub('format', { success: true, noteId: 'n1', formattedContent: '# x' }), getFormattingStats: stub('x', {}), formatUnformattedNotes: stub('x', {}) });
  swap('services/ttsService.js', { synthesize: stub('tts.synth', Buffer.from('mp3')), generateForNote: stub('tts.gen', { audio_url: 'u', voice: 'nova', speed: 1, duration_seconds: 1 }), getTTSForNote: stub('x', null), getVoices: stub('x', []) });
  swap('services/meetingService.js', { createMeeting: stub('meeting.create', { meeting: { id: 'm1' }, recallBotId: 'b1' }), getMeetings: stub('x', { meetings: [] }) });
  swap('services/recallService.js', { validateMeetingUrl: () => true, detectPlatform: () => 'zoom', getSupportedPlatforms: () => [] });
  swap('services/pdfService.js', { processPDF: stub('pdf', {}), processFromBuffer: stub('pdf', {}) });
  swap('services/videoService.js', {});
  swap('services/scanService.js', { processScannedDocument: stub('scan', {}), processBatchScan: stub('scan', {}) });
  swap('services/youtubeTranscriptService.js', { processVideoUrl: stub('video', { noteId: 'n1' }) });
  swap('services/creatorService.js', { getUserActiveRedemption: async () => null });
}

const harness = { db, resetDb, install, calls, shares: [] };

function makeApp(mounts) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const [p, r] of Object.entries(mounts)) app.use(p, r);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ success: false, error: err.message }));
  return app;
}

const listen = (app) => new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });

async function call(server, method, p, { user, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers['x-test-user'] = user;
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  let json = null;
  try { json = await res.json(); } catch { /* binary or empty body */ }
  return { status: res.status, body: json, headers: res.headers };
}

const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
/** n usage_tracking rows for a user (created now unless an offset is given). */
const usage = (userId, type, n, offsetMs = -1000) => Array.from({ length: n }, () => ({ user_id: userId, feature_type: type, created_at: nowIso(offsetMs) }));

Object.assign(harness, { makeApp, listen, call, nowIso, usage });
module.exports = harness;
