import test from 'node:test';
import assert from 'node:assert/strict';
import { userApi } from '../src/lib/api.ts';
import { DELETE_REASONS, isDeleteConfirmed, deletionBlocker, exportFilename, serializeExport, DELETE_CONFIRM_WORD } from '../src/lib/account.ts';

const API = 'https://ai-notetaker-backend.fly.dev';

function mockFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: String(init.method), body: init.body, headers: (init.headers || {}) as Record<string, string> });
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('deleteAccount sends DELETE /api/user/delete-account with the bearer token and the reason', async () => {
  const m = mockFetch(200, { success: true, message: 'Account and all associated data have been permanently deleted.' });
  try {
    const out = await userApi.deleteAccount('tok', 'TOO_EXPENSIVE');
    assert.equal(out.success, true);
    assert.equal(m.calls[0].url, `${API}/api/user/delete-account`);
    assert.equal(m.calls[0].method, 'DELETE');
    assert.equal(m.calls[0].headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(String(m.calls[0].body)), { reason: 'TOO_EXPENSIVE' });
  } finally { m.restore(); }
});

test('deleteAccount without a reason sends no body', async () => {
  const m = mockFetch(200, { success: true });
  try {
    await userApi.deleteAccount('tok');
    assert.equal(m.calls[0].body, undefined);
  } finally { m.restore(); }
});

test('deleteAccount surfaces a server failure instead of pretending it worked', async () => {
  const m = mockFetch(500, { success: false, error: 'Failed to delete account. Please try again or contact support.' });
  try {
    await assert.rejects(() => userApi.deleteAccount('tok'), /Failed to delete account/);
  } finally { m.restore(); }
});

test('exportData calls GET /api/user/data-export and returns the data object', async () => {
  const m = mockFetch(200, { success: true, data: { exportDate: '2026-11-01T00:00:00.000Z', notes: [{ id: 'n1' }], recordings: [], aiContent: [] } });
  try {
    const out = await userApi.exportData('tok');
    assert.equal(m.calls[0].url, `${API}/api/user/data-export`);
    assert.equal(m.calls[0].method, 'GET');
    assert.equal((out as { notes: unknown[] }).notes.length, 1);
  } finally { m.restore(); }
});

test('exportData rejects a response with no data', async () => {
  const m = mockFetch(200, { success: true });
  try {
    await assert.rejects(() => userApi.exportData('tok'), /export/i);
  } finally { m.restore(); }
});

test('typed confirmation: only the word DELETE (any case, surrounding spaces ignored) counts', () => {
  assert.equal(DELETE_CONFIRM_WORD, 'DELETE');
  assert.equal(isDeleteConfirmed('DELETE'), true);
  assert.equal(isDeleteConfirmed('  delete '), true);
  for (const bad of ['', 'del', 'DELETE ME', 'delet', 'yes', 'DELETEE']) assert.equal(isDeleteConfirmed(bad), false, bad);
});

test('reasons use the same keys as the Android DeletionReason enum', () => {
  assert.deepEqual(DELETE_REASONS.map((r) => r.id), ['NOT_USEFUL', 'TOO_EXPENSIVE', 'FOUND_ALTERNATIVE', 'PRIVACY_CONCERNS', 'TOO_COMPLICATED', 'BUGS_ISSUES', 'OTHER']);
});

test('an active web (Stripe) subscription blocks deletion until cancelled; store subscriptions only warn', () => {
  const web = deletionBlocker({ isSubscribed: true, platform: 'web' })!;
  assert.equal(web.blocking, true);
  assert.match(web.message, /cancel your subscription/i);
  const android = deletionBlocker({ isSubscribed: true, platform: 'android' })!;
  assert.equal(android.blocking, false);
  assert.match(android.message, /Play Store/);
  const ios = deletionBlocker({ isSubscribed: true, platform: 'ios' })!;
  assert.equal(ios.blocking, false);
  assert.match(ios.message, /App Store/);
  assert.equal(deletionBlocker({ isSubscribed: false, platform: 'web' }), null);
  assert.equal(deletionBlocker(null), null);
});

test('export file name and content', () => {
  assert.equal(exportFilename(new Date('2026-11-01T15:00:00Z')), 'scribeai-data-2026-11-01.json');
  const text = serializeExport({ a: 1 });
  assert.equal(text, '{\n  "a": 1\n}');
});
