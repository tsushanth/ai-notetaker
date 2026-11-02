import test from 'node:test';
import assert from 'node:assert/strict';
import { notesApi, ApiError, normalizeVideoUrl, limitAwareMessage } from '../src/lib/api.ts';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockFetch(replies: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: String(init.method || 'GET'), headers: (init.headers || {}) as Record<string, string>, body: init.body });
    const r = replies[calls.length - 1] || { status: 500, json: { error: 'unexpected extra call' } };
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const API = 'https://ai-notetaker-backend.fly.dev';

test('uploadAudio: uploads to /api/recordings/upload, then transcribes by recording_id, and returns the note id', async () => {
  const m = mockFetch([
    { status: 201, json: { success: true, data: { id: 'rec-1', status: 'uploaded' } } },
    { json: { success: true, data: { recording_id: 'rec-1', status: 'completed', note_id: 'note-9', transcription: 'hi' } } },
  ]);
  try {
    const stages: string[] = [];
    const blob = new Blob(['abc'], { type: 'audio/webm' });
    const out = await notesApi.uploadAudio('tok', blob, { title: 'Standup', onStage: (s) => stages.push(s) });
    assert.equal(out.noteId, 'note-9');
    assert.deepEqual(stages, ['uploading', 'transcribing']);
    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].url, `${API}/api/recordings/upload`);
    assert.equal(m.calls[0].method, 'POST');
    assert.equal(m.calls[0].headers.Authorization, 'Bearer tok');
    assert.equal(m.calls[0].headers['Content-Type'], undefined, 'multipart: the browser must set the boundary');
    const form = m.calls[0].body as FormData;
    assert.ok(form.get('audio') instanceof Blob);
    assert.equal(form.get('title'), 'Standup');
    assert.equal(m.calls[1].url, `${API}/api/recordings/transcribe`);
    assert.deepEqual(JSON.parse(String(m.calls[1].body)), { recording_id: 'rec-1' });
  } finally { m.restore(); }
});

test('uploadAudio: a daily-limit 429 on transcribe surfaces the server message as an ApiError with status 429', async () => {
  const msg = "You have reached today's limit of 5 voice transcriptions. It resets on a rolling 24-hour basis, so please try again later.";
  const m = mockFetch([
    { status: 201, json: { success: true, data: { id: 'rec-1' } } },
    { status: 429, json: { success: false, error: msg, code: 'DAILY_LIMIT_REACHED' } },
  ]);
  try {
    await assert.rejects(
      () => notesApi.uploadAudio('tok', new Blob(['a'], { type: 'audio/webm' })),
      (e: unknown) => e instanceof ApiError && e.status === 429 && e.message === msg && e.code === 'DAILY_LIMIT_REACHED'
    );
  } finally { m.restore(); }
});

test('uploadAudio: a missing recording id from the server is an error, not a silent undefined', async () => {
  const m = mockFetch([{ status: 201, json: { success: true, data: {} } }]);
  try {
    await assert.rejects(() => notesApi.uploadAudio('tok', new Blob(['a'], { type: 'audio/webm' })), /recording/i);
  } finally { m.restore(); }
});

test('uploadPdf: posts the file under the "file" field to /api/uploads/pdf and reads data.note.id', async () => {
  const m = mockFetch([{ status: 201, json: { success: true, data: { note: { id: 'note-pdf' }, stats: { pages: 2 } } } }]);
  try {
    const file = new File(['%PDF-1.4'], 'lecture.pdf', { type: 'application/pdf' });
    const out = await notesApi.uploadPdf('tok', file, 'Lecture');
    assert.equal(out.noteId, 'note-pdf');
    assert.equal(m.calls[0].url, `${API}/api/uploads/pdf`);
    const form = m.calls[0].body as FormData;
    assert.ok(form.get('file') instanceof Blob, 'the backend (multer) reads the "file" field');
    assert.equal(form.get('pdf'), null);
    assert.equal(form.get('title'), 'Lecture');
  } finally { m.restore(); }
});

test('processYoutube: posts { url } to /api/uploads/video-url and reads data.note.id', async () => {
  const m = mockFetch([{ status: 201, json: { success: true, data: { note: { id: 'note-yt' } } } }]);
  try {
    const out = await notesApi.processYoutube('tok', 'youtu.be/abc123');
    assert.equal(out.noteId, 'note-yt');
    assert.equal(m.calls[0].url, `${API}/api/uploads/video-url`);
    assert.equal(m.calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(String(m.calls[0].body)), { url: 'https://youtu.be/abc123' });
  } finally { m.restore(); }
});

test('create: sends source_type and returns the created note from data (the old code read response.note and crashed)', async () => {
  const m = mockFetch([{ status: 201, json: { success: true, data: { id: 'note-txt', title: 'T' } } }]);
  try {
    const out = await notesApi.create('tok', { title: 'T', content: 'body', sourceType: 'text' });
    assert.equal((out.note as { id: string }).id, 'note-txt');
    assert.deepEqual(JSON.parse(String(m.calls[0].body)), { title: 'T', content: 'body', source_type: 'text' });
  } finally { m.restore(); }
});

test('normalizeVideoUrl adds the scheme the backend validator requires and trims', () => {
  assert.equal(normalizeVideoUrl('  youtube.com/watch?v=abc '), 'https://youtube.com/watch?v=abc');
  assert.equal(normalizeVideoUrl('www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(normalizeVideoUrl('http://youtu.be/abc'), 'http://youtu.be/abc');
  assert.equal(normalizeVideoUrl('https://youtu.be/abc'), 'https://youtu.be/abc');
});

test('limitAwareMessage: a 429 keeps the server text (never a "failed" prefix or an upgrade nudge); others get the fallback only when empty', () => {
  assert.equal(limitAwareMessage(new ApiError("You have reached today's free limit", 429), 'Failed'), "You have reached today's free limit");
  assert.equal(limitAwareMessage(new ApiError('', 429), 'Failed'), "You have reached today's free limit, try again later");
  assert.equal(limitAwareMessage(new ApiError('Could not extract text from document', 400), 'Failed'), 'Could not extract text from document');
  assert.equal(limitAwareMessage(new Error('boom'), 'Failed to process'), 'boom');
  assert.equal(limitAwareMessage('weird', 'Failed to process'), 'Failed to process');
});
