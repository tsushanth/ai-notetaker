import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOutreachParams, captureOutreachTouch, getSignupSource, clearOutreachTouch, OUTREACH_STORAGE_KEY, OUTREACH_TTL_MS,
} from '../src/lib/outreachUtm.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}
const T0 = 1_800_000_000_000;
const LINK = '?utm_source=outreach&utm_medium=email&utm_campaign=nz-pilot-1&utm_content=Ab_9-x';

test('parseOutreachParams keeps only source, campaign and code, and only for outreach links', () => {
  assert.deepEqual(parseOutreachParams(LINK), { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' });
  assert.deepEqual(parseOutreachParams('?utm_source=Outreach&utm_campaign=NZ-1'), { utm_source: 'outreach', utm_campaign: 'nz-1' });
  assert.equal(parseOutreachParams('?utm_source=google&utm_campaign=x'), null);
  assert.equal(parseOutreachParams('?utm_campaign=x'), null);
  assert.equal(parseOutreachParams(''), null);
  assert.equal(parseOutreachParams('?utm_source=outreach'), null, 'a campaign is required');
  assert.equal(parseOutreachParams('?utm_source=outreach&utm_campaign=bad%20value'), null);
  assert.equal(parseOutreachParams('?utm_source=outreach&utm_campaign=' + 'a'.repeat(65)), null);
  assert.deepEqual(parseOutreachParams('?utm_source=outreach&utm_campaign=c1&utm_content=' + encodeURIComponent('<script>')), { utm_source: 'outreach', utm_campaign: 'c1' }, 'a bad code is dropped, the campaign kept');
});

test('captures an outreach link and returns it as signup_source without the timestamp', () => {
  const s = fakeStorage();
  assert.equal(captureOutreachTouch(LINK, s, T0), true);
  assert.deepEqual(getSignupSource(s, T0 + 1000), { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' });
  assert.deepEqual(Object.keys(JSON.parse(s.raw.get(OUTREACH_STORAGE_KEY)!)).sort(), ['ts', 'utm_campaign', 'utm_content', 'utm_source']);
});

test('first touch wins while unexpired, a later touch replaces an expired one', () => {
  const s = fakeStorage();
  captureOutreachTouch('?utm_source=outreach&utm_campaign=first&utm_content=a', s, T0);
  assert.equal(captureOutreachTouch('?utm_source=outreach&utm_campaign=second&utm_content=b', s, T0 + 5 * 86400_000), false);
  assert.equal(getSignupSource(s, T0 + 6 * 86400_000)?.utm_campaign, 'first');
  const later = T0 + OUTREACH_TTL_MS + 1000;
  assert.equal(getSignupSource(s, later), undefined, '30 days later it has expired');
  assert.equal(captureOutreachTouch('?utm_source=outreach&utm_campaign=second&utm_content=b', s, later), true);
  assert.equal(getSignupSource(s, later)?.utm_campaign, 'second');
});

test('non-outreach visits store nothing and do not disturb a stored touch', () => {
  const s = fakeStorage();
  assert.equal(captureOutreachTouch('?utm_source=newsletter&utm_campaign=x', s, T0), false);
  assert.equal(s.raw.size, 0);
  captureOutreachTouch(LINK, s, T0);
  assert.equal(captureOutreachTouch('?q=1', s, T0 + 1), false);
  assert.ok(getSignupSource(s, T0 + 2));
});

test('corrupt or tampered storage is ignored and cleaned, never thrown', () => {
  for (const bad of ['not json', '{"ts":"x"}', JSON.stringify({ ts: T0, utm_source: 'outreach', utm_campaign: 'BAD CAMPAIGN' }), JSON.stringify({ ts: T0 + 10 * OUTREACH_TTL_MS, utm_source: 'outreach', utm_campaign: 'ok' })]) {
    const s = fakeStorage({ [OUTREACH_STORAGE_KEY]: bad });
    assert.equal(getSignupSource(s, T0), undefined, bad);
  }
});

test('storage that throws, or no storage, never breaks the page', () => {
  const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(captureOutreachTouch(LINK, boom, T0), false);
  assert.equal(getSignupSource(boom, T0), undefined);
  assert.doesNotThrow(() => clearOutreachTouch(boom));
  assert.equal(captureOutreachTouch(LINK, null, T0), false);
  assert.equal(getSignupSource(null, T0), undefined);
});

test('clearOutreachTouch forgets the touch', () => {
  const s = fakeStorage();
  captureOutreachTouch(LINK, s, T0);
  clearOutreachTouch(s);
  assert.equal(getSignupSource(s, T0), undefined);
});

test('authApi.loginWithGoogle and register send signup_source only when a touch is stored, then clear it', async () => {
  const store = fakeStorage();
  (globalThis as any).window = { localStorage: store };
  const calls: { url: string; body: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ token: 't', user: {} }) };
  };
  try {
    const { authApi } = await import('../src/lib/api.ts');
    await authApi.loginWithGoogle('idtok');
    assert.deepEqual(calls[0].body, { idToken: 'idtok' }, 'no touch: body unchanged');

    captureOutreachTouch(LINK, store);
    await authApi.loginWithGoogle('idtok');
    assert.ok(calls[1].url.endsWith('/api/auth/google'));
    assert.deepEqual(calls[1].body, { idToken: 'idtok', signup_source: { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' } });
    assert.equal(getSignupSource(store), undefined, 'cleared after the account was created');

    captureOutreachTouch(LINK, store);
    await authApi.register('a@b.co', 'pw', 'N');
    assert.ok(calls[2].url.endsWith('/api/auth/register'));
    assert.deepEqual(calls[2].body.signup_source, { utm_source: 'outreach', utm_campaign: 'nz-pilot-1', utm_content: 'Ab_9-x' });
    assert.equal(calls[2].body.email, 'a@b.co');
  } finally {
    delete (globalThis as any).window;
  }
});
