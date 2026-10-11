import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext, loginUrl, isExpiredSession, hasBearer } from '../src/lib/session.ts';

const API = 'https://ai-notetaker-backend.fly.dev';

test('safeNext keeps ordinary in-site paths, with query strings', () => {
  assert.equal(safeNext('/notes'), '/notes');
  assert.equal(safeNext('/notes/abc?tab=quiz'), '/notes/abc?tab=quiz');
  assert.equal(safeNext('/admin'), '/admin');
});

test('safeNext refuses other sites, protocol-relative and backslash tricks, control characters and the login pages', () => {
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'evil.com', 'javascript:alert(1)', '/ok\nbad', '/login', '/login?reason=expired', '/signup', '', null, undefined, '/' + 'a'.repeat(600)]) {
    assert.equal(safeNext(bad as string), null, String(bad).slice(0, 30));
  }
});

test('loginUrl adds the expiry reason and a safe return path, and drops an unsafe one', () => {
  assert.equal(loginUrl('/notes', true), '/login?reason=expired&next=%2Fnotes');
  assert.equal(loginUrl('/notes'), '/login?next=%2Fnotes');
  assert.equal(loginUrl(null, true), '/login?reason=expired');
  assert.equal(loginUrl('https://evil.com', true), '/login?reason=expired');
  assert.equal(loginUrl(), '/login');
});

test('only a 401 on an authenticated call to our API counts as an expired session', () => {
  const base = { url: `${API}/api/notes`, apiBase: API, hadBearer: true, status: 401 };
  assert.equal(isExpiredSession(base), true);
  assert.equal(isExpiredSession({ ...base, status: 403 }), false);
  assert.equal(isExpiredSession({ ...base, status: 500 }), false);
  assert.equal(isExpiredSession({ ...base, hadBearer: false }), false, 'a wrong password at sign-in has no token');
  assert.equal(isExpiredSession({ ...base, url: 'https://other.example.com/x' }), false, 'never react to another site');
  assert.equal(isExpiredSession({ ...base, url: `${API}.evil.com/x` }), false, 'a look-alike host is not our API');
});

test('hasBearer reads the Authorization header from plain objects, Headers and arrays, in any case', () => {
  assert.equal(hasBearer({ headers: { Authorization: 'Bearer abc' } }), true);
  assert.equal(hasBearer({ headers: { authorization: 'bearer abc' } }), true);
  assert.equal(hasBearer({ headers: new Headers({ Authorization: 'Bearer abc' }) }), true);
  assert.equal(hasBearer({ headers: [['Authorization', 'Bearer abc']] }), true);
  assert.equal(hasBearer({ headers: { Authorization: 'Basic abc' } }), false);
  assert.equal(hasBearer({ headers: { Authorization: 'Bearer ' } }), false);
  assert.equal(hasBearer({}), false);
  assert.equal(hasBearer(undefined), false);
  assert.equal(hasBearer(undefined, new Request('https://x.test', { headers: { Authorization: 'Bearer t' } })), true);
});
