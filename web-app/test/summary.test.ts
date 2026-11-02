import test from 'node:test';
import assert from 'node:assert/strict';
import { aiApi } from '../src/lib/api.ts';
import { extractSummaryText } from '../src/lib/summary.ts';

const API = 'https://ai-notetaker-backend.fly.dev';

function mockFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; method: string; body: unknown; auth: string | undefined }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: String(init.method), body: init.body, auth: (init.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('generateSummary posts note_id and the language to /api/ai/summary and returns the text', async () => {
  const m = mockFetch(200, { success: true, data: { id: 'c1', summary: 'Short summary.', length: 'medium', note_id: 'n1' } });
  try {
    const out = await aiApi.generateSummary('tok', 'n1', 'spanish');
    assert.equal(out.summary, 'Short summary.');
    assert.equal(m.calls[0].url, `${API}/api/ai/summary`);
    assert.equal(m.calls[0].method, 'POST');
    assert.equal(m.calls[0].auth, 'Bearer tok');
    assert.deepEqual(JSON.parse(String(m.calls[0].body)), { note_id: 'n1', options: { language: 'spanish' } });
  } finally { m.restore(); }
});

test('generateSummary: the daily-limit 429 reaches the caller with the server text intact', async () => {
  const msg = "You have reached today's limit of 20 AI generations. It resets on a rolling 24-hour basis, so please try again later.";
  const m = mockFetch(429, { success: false, error: msg, code: 'DAILY_LIMIT_REACHED' });
  try {
    await assert.rejects(() => aiApi.generateSummary('tok', 'n1', 'english'), (e: unknown) => e instanceof Error && e.message === msg);
  } finally { m.restore(); }
});

test('generateSummary: an empty summary from the server is an error, not a blank section', async () => {
  const m = mockFetch(200, { success: true, data: { summary: '   ' } });
  try {
    await assert.rejects(() => aiApi.generateSummary('tok', 'n1', 'english'), /summary/i);
  } finally { m.restore(); }
});

test('extractSummaryText reads what the backend stores ({ summary, length, model }) and plain strings', () => {
  assert.equal(extractSummaryText({ summary: 'Hello', length: 'short', model: 'x' }), 'Hello');
  assert.equal(extractSummaryText('Plain text'), 'Plain text');
  assert.equal(extractSummaryText({ summary: '  trimmed  ' }), 'trimmed');
});

test('extractSummaryText returns null for anything without usable text', () => {
  for (const v of [null, undefined, '', '   ', {}, { summary: '' }, { summary: 5 }, [], 42]) assert.equal(extractSummaryText(v), null, String(JSON.stringify(v)));
});
