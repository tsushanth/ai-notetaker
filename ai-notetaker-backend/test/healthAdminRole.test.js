const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness'); // dummy env; install() is not used: this file fakes config/supabase itself
const path = require('node:path');

const chain = () => { const q = { select: () => q, limit: () => q, then: (res) => Promise.resolve({ data: [], error: null }).then(res) }; return q; };
function fakeAdmin({ session = null, rpc = async () => ({ data: [], error: null }) } = {}) {
  return {
    from: chain,
    storage: { getBucket: async () => ({ data: {}, error: null }) },
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    rpc,
  };
}
const state = { rpc: async () => ({ data: [], error: null }) };
const routeAdmin = fakeAdmin({ rpc: (...a) => state.rpc(...a) });
let admin = routeAdmin;
const supPath = require.resolve(path.join(__dirname, '..', 'src', 'config', 'supabase.js'));
require.cache[supPath] = { id: supPath, filename: supPath, loaded: true, exports: { supabase: { from: chain }, get supabaseAdmin() { return admin; } } };
process.env.NODE_ENV = 'production'; // reporter stays disabled under the test runner anyway
const health = require('../src/routes/health');
const { checkAdminRole } = health;

test('healthy: no session and the lookup RPC is allowed', async () => {
  const r = await checkAdminRole(fakeAdmin());
  assert.equal(r.status, 'healthy');
});

test('unhealthy: a user session is attached to the admin client', async () => {
  const r = await checkAdminRole(fakeAdmin({ session: { access_token: 'x' } }));
  assert.equal(r.status, 'unhealthy');
  assert.match(r.error, /session/);
});

test('unhealthy: the RPC answers permission denied (the exact production failure)', async () => {
  const r = await checkAdminRole(fakeAdmin({ rpc: async () => ({ data: null, error: { message: 'permission denied for function get_user_id_by_email', code: '42501' } }) }));
  assert.equal(r.status, 'unhealthy');
  assert.match(r.error, /service-role/);
});

test('unknown, not unhealthy: other RPC errors, timeouts and exceptions never flip health', async () => {
  let r = await checkAdminRole(fakeAdmin({ rpc: async () => ({ data: null, error: { message: 'connection reset' } }) }));
  assert.equal(r.status, 'unknown');
  r = await checkAdminRole(fakeAdmin({ rpc: async () => { throw new Error('network down'); } }));
  assert.equal(r.status, 'unknown');
});

test('GET /health: 200 with checks.adminRole healthy, 503 when the admin client lost the service role', async () => {
  const app = h.makeApp({ '/health': health });
  const server = await h.listen(app);
  try {
    state.rpc = async () => ({ data: [], error: null });
    let r = await h.call(server, 'GET', '/health', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.checks.adminRole.status, 'healthy');
    state.rpc = async () => ({ data: null, error: { message: 'permission denied for function get_user_id_by_email', code: '42501' } });
    r = await h.call(server, 'GET', '/health', {});
    assert.equal(r.status, 503);
    assert.equal(r.body.status, 'unhealthy');
    assert.equal(r.body.checks.adminRole.status, 'unhealthy');
    state.rpc = async () => ({ data: null, error: { message: 'timeout' } });
    r = await h.call(server, 'GET', '/health', {});
    assert.equal(r.status, 200, 'an unknown probe result must not fail /health');
  } finally { server.close(); }
});
