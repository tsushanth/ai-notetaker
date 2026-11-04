const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness'); // sets dummy env; install() is not used: this file fakes supabase-js itself

// Fake supabase-js: every client remembers the key it was created with and whether a user session was attached to it
// (as the real library does after signInWithPassword), which turns later RPC calls into the "authenticated" role.
const clients = [];
function makeClient(url, key) {
  const c = { key, sessionAttached: false, rpcAs: [] };
  c.auth = {
    signInWithPassword: async () => { c.sessionAttached = true; return { data: { user: { id: 'u1', email: 'a@b.c' }, session: { access_token: 't', refresh_token: 'r', expires_in: 3600 } }, error: null }; },
    admin: { createUser: async () => ({ data: { user: { id: 'u1' } }, error: null }), updateUserById: async () => ({ data: {}, error: null }) },
  };
  c.rpc = async () => { c.rpcAs.push(c.sessionAttached ? 'authenticated' : 'service'); return { data: [], error: null }; };
  const q = () => { const p = Promise.resolve({ data: null, error: null }); p.eq = () => p; p.single = async () => ({ data: null, error: null }); p.select = () => p; return p; };
  c.from = () => ({ upsert: q, insert: q, select: q, update: q });
  clients.push(c);
  return c;
}
const pkg = require.resolve('@supabase/supabase-js');
require.cache[pkg] = { id: pkg, filename: pkg, loaded: true, exports: { createClient: makeClient } };

process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_ANON_KEY = 'anon-key';
const app = h.makeApp({ '/api/auth': require('../src/routes/auth') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

test('email/password login and signup never attach a user session to the shared admin client', async () => {
  const admin = clients.find((c) => c.key === 'service-key');
  assert.ok(admin, 'admin client exists');
  let r = await h.call(server, 'POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'pw123456' } });
  assert.equal(r.status, 200);
  r = await h.call(server, 'POST', '/api/auth/register', { body: { email: 'a@b.c', password: 'pw123456', name: 'A' } });
  assert.ok([200, 201].includes(r.status), 'register status ' + r.status);
  assert.equal(admin.sessionAttached, false, 'admin client must stay on the service key');
  const signIns = clients.filter((c) => c.sessionAttached);
  assert.ok(signIns.length >= 2, 'sign-ins happened on throwaway clients');
  assert.ok(signIns.every((c) => c.key === 'anon-key'), 'sign-ins use the anon key, not the service key');
});

test('each password sign-in uses its own client (no session carried between users)', async () => {
  const before = clients.length;
  await h.call(server, 'POST', '/api/auth/login', { body: { email: 'x@y.z', password: 'pw123456' } });
  await h.call(server, 'POST', '/api/auth/login', { body: { email: 'p@q.r', password: 'pw123456' } });
  const fresh = clients.slice(before).filter((c) => c.sessionAttached);
  assert.equal(fresh.length, 2);
});
