import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { downloadExport, exportFileName, PremiumRequiredError, EXPORT_API_BASE_URL } from '../src/lib/noteExport.ts';

const API = 'https://ai-notetaker-backend.fly.dev';

function mockFetch(make: () => Response) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: String(init.method || 'GET'), headers: (init.headers || {}) as Record<string, string> });
    return make();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('downloadExport fetches the PDF with the bearer token and returns the bytes as a blob', async () => {
  const m = mockFetch(() => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
  try {
    const blob = await downloadExport('tok', 'note-1', 'pdf');
    assert.equal(m.calls[0].url, `${API}/api/notes/note-1/export/pdf`);
    assert.equal(m.calls[0].method, 'GET');
    assert.equal(m.calls[0].headers.Authorization, 'Bearer tok');
    assert.equal(blob.size, 4);
  } finally { m.restore(); }
});

test('downloadExport uses the docx route for Word', async () => {
  const m = mockFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
  try {
    await downloadExport('tok', 'note-1', 'docx');
    assert.equal(m.calls[0].url, `${API}/api/notes/note-1/export/docx`);
  } finally { m.restore(); }
});

test('403 PREMIUM_REQUIRED becomes PremiumRequiredError so the page can show the upgrade path', async () => {
  const m = mockFetch(() => new Response(JSON.stringify({ success: false, error: 'Premium subscription required to export notes', code: 'PREMIUM_REQUIRED' }), { status: 403 }));
  try {
    await assert.rejects(() => downloadExport('tok', 'n', 'pdf'), (e: unknown) => e instanceof PremiumRequiredError);
  } finally { m.restore(); }
});

test('other failures keep the server message; a 401 asks to sign in again', async () => {
  let m = mockFetch(() => new Response(JSON.stringify({ success: false, error: 'Note not found' }), { status: 404 }));
  try {
    await assert.rejects(() => downloadExport('tok', 'n', 'pdf'), (e: unknown) => e instanceof Error && !(e instanceof PremiumRequiredError) && e.message === 'Note not found');
  } finally { m.restore(); }
  m = mockFetch(() => new Response('not json', { status: 500 }));
  try {
    await assert.rejects(() => downloadExport('tok', 'n', 'docx'), /export/i);
  } finally { m.restore(); }
  m = mockFetch(() => new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 }));
  try {
    await assert.rejects(() => downloadExport('tok', 'n', 'pdf'), /sign in again/i);
  } finally { m.restore(); }
});

test('exportFileName is safe for every OS and has the right extension', () => {
  assert.equal(exportFileName('Lecture 1: Intro/Basics?', 'pdf'), 'Lecture 1 Intro Basics.pdf');
  assert.equal(exportFileName('   ', 'docx'), 'note.docx');
  assert.equal(exportFileName('a'.repeat(200), 'pdf').length, 80 + '.pdf'.length);
});

test('the export host is the same one lib/api.ts talks to', () => {
  const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  assert.ok(api.includes(`API_BASE_URL = '${EXPORT_API_BASE_URL}'`));
});
