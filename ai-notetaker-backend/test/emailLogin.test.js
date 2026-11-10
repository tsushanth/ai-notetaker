const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness'); // dummy env; supabase-js is faked below

// Fake supabase-js: the password "right-pw" works for known@x.test; everything else fails the way Supabase does
// (the same "Invalid login credentials" error for a wrong password and for an unknown address).
let upstream = null; // set to force an upstream failure
function makeClient() {
  const c = {};
  c.auth = {
    signInWithPassword: async ({ email, password }) => {
      if (upstream) return { data: { user: null, session: null }, error: upstream };
      if (email === 'known@x.test' && password === 'right-pw') {
        return { data: { user: { id: 'u1', email, user_metadata: { name: 'Known' } }, session: { access_token: 'supabase-short-token' } }, error: null };
      }
      return { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } };
    },
    admin: {},
  };
  c.rpc = async () => ({ data: [], error: null });
  const q = () => { const p = Promise.resolve({ data: null, error: null }); p.eq = () => p; p.single = async () => ({ data: null, error: null }); p.select = () => p; return p; };
  c.from = () => ({ upsert: q, insert: q, select: q, update: q });
  return c;
}
const pkg = require.resolve('@supabase/supabase-js');
require.cache[pkg] = { id: pkg, filename: pkg, loaded: true, exports: { createClient: makeClient } };

process.env.JWT_SECRET = 'test-secret';
process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT = '3';
process.env.LOGIN_MAX_FAILURES_PER_IP = '6';
const jwt = require('jsonwebtoken');
const app = h.makeApp({ '/api/auth': require('../src/routes/auth') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

const login = (email, password, ip) =>
  fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'fly-client-ip': ip } : {}) },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a correct password returns a 7-day token the API middleware can verify, never the short Supabase token', async () => {
  const r = await login('known@x.test', 'right-pw', '10.0.0.1');
  assert.equal(r.status, 200);
  assert.notEqual(r.body.token, 'supabase-short-token');
  const decoded = jwt.verify(r.body.token, 'test-secret');
  assert.equal(decoded.sub, 'u1');
  assert.equal(decoded.aud, 'authenticated');
  assert.ok(decoded.exp - decoded.iat >= 6 * 24 * 3600);
  assert.deepEqual(r.body.user, { id: 'u1', email: 'known@x.test', name: 'Known' });
});

test('wrong password and unknown address get the identical response (no account enumeration)', async () => {
  const wrong = await login('known@x.test', 'nope', '10.0.0.2');
  const unknown = await login('nobody@x.test', 'nope', '10.0.0.3');
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown, wrong);
  assert.equal(wrong.body.error, 'Invalid email or password');
});

test('other upstream errors are not echoed to the caller', async () => {
  upstream = { message: 'Email not confirmed (internal detail)', status: 400, code: 'email_not_confirmed' };
  const r = await login('someone@x.test', 'pw', '10.0.0.4');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Invalid email or password');
  upstream = { message: 'db down', status: 500 };
  const s = await login('someone@x.test', 'pw', '10.0.0.4');
  assert.equal(s.status, 503);
  assert.doesNotMatch(JSON.stringify(s.body), /db down/);
  upstream = null;
});

test('malformed bodies are refused without calling Supabase', async () => {
  for (const [e, p] of [[undefined, 'x'], ['a@b.c', undefined], [{ $ne: 1 }, 'x'], ['a@b.c', ['x']], ['a'.repeat(300) + '@b.c', 'x']]) {
    const r = await login(e, p, '10.0.0.5');
    assert.equal(r.status, 400, JSON.stringify([e, p]).slice(0, 40));
  }
});

test('failed attempts against one account are cut off even from many addresses, and the cut-off is case-insensitive', async () => {
  const email = 'victim@x.test';
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await login(i % 2 ? email.toUpperCase() : email, 'guess' + i, `10.1.0.${i}`)).status);
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
  const r = await login(email, 'guess', '10.1.0.9');
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Too many sign-in attempts/);
});

test('failed attempts from one address are cut off across accounts', async () => {
  const statuses = [];
  for (let i = 0; i < 8; i++) statuses.push((await login(`user${i}@x.test`, 'guess', '10.2.0.1')).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 429, 429]);
});

test('the address comes from Fly-Client-IP, so a forged X-Forwarded-For does not reset the budget', async () => {
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'fly-client-ip': '10.3.0.1', 'x-forwarded-for': `9.9.9.${i}` },
      body: JSON.stringify({ email: `spoof${i}@x.test`, password: 'guess' }),
    });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses.slice(0, 6), [401, 401, 401, 401, 401, 401]);
  assert.deepEqual(statuses.slice(6), [429, 429]);
});

test('successful sign-ins never use up the budget', async () => {
  for (let i = 0; i < 12; i++) assert.equal((await login('known@x.test', 'right-pw', '10.4.0.1')).status, 200);
});
