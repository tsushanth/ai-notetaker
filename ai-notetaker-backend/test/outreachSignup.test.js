const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness'); // dummy env

// Fake supabase-js: records admin.createUser arguments; getUserById serves stored app_metadata.
const created = []; const users = new Map();
function makeClient() {
  const c = {};
  c.auth = {
    signInWithPassword: async ({ email }) => ({ data: { user: { id: 'new-1', email }, session: { access_token: 'tok' } }, error: null }),
    admin: {
      createUser: async (args) => { created.push(args); const user = { id: 'new-1', email: args.email, app_metadata: args.app_metadata || {} }; users.set(user.id, user); return { data: { user }, error: null }; },
      getUserById: async (id) => ({ data: { user: users.get(id) || null }, error: null }),
      updateUserById: async () => ({ data: {}, error: null }),
    },
  };
  c.rpc = async () => ({ data: [], error: null });
  const q = () => { const p = Promise.resolve({ data: null, error: null }); p.eq = () => p; p.single = async () => ({ data: null, error: null }); p.select = () => p; return p; };
  c.from = () => ({ upsert: q, insert: q, select: q, update: q });
  return c;
}
const pkg = require.resolve('@supabase/supabase-js');
require.cache[pkg] = { id: pkg, filename: pkg, loaded: true, exports: { createClient: makeClient } };

const app = h.makeApp({ '/api/auth': require('../src/routes/auth') });
const { lookupActivation } = require('../src/services/outreachAttribution');
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

const realFetch = globalThis.fetch;
const register = (body) => realFetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
async function withLayer(fn) {
  const sent = [];
  process.env.OUTREACH_EVENTS_URL = 'https://calldesk.example/api/outreach/event'; process.env.OUTREACH_EVENT_SECRET = 's'.repeat(32);
  const log = console.log; console.log = () => {};
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://calldesk.example')) { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } return realFetch(url, init); };
  try { await fn(); await new Promise((r) => setTimeout(r, 30)); } finally { console.log = log; globalThis.fetch = realFetch; delete process.env.OUTREACH_EVENTS_URL; delete process.env.OUTREACH_EVENT_SECRET; }
  return sent;
}
const src = { utm_source: 'outreach', utm_medium: 'email', utm_campaign: 'sc-2026-12-a', utm_content: 'abc123' };

test('register without signup_source behaves as before: no app_metadata, no event', async () => {
  created.length = 0;
  const sent = await withLayer(async () => { assert.equal((await register({ email: 'a@x.test', password: 'secret1' })).status, 201); });
  assert.equal(created[0].app_metadata, undefined);
  assert.equal(sent.length, 0);
});

test('register with an outreach signup_source stores admin-only app_metadata and reports a signup when the layer is on', async () => {
  created.length = 0;
  const sent = await withLayer(async () => { assert.equal((await register({ email: 'b@x.test', password: 'secret1', signup_source: src })).status, 201); });
  assert.deepEqual(created[0].app_metadata, { outreach: { campaign: 'sc-2026-12-a', code: 'abc123' } });
  assert.equal(sent.length, 1);
  assert.deepEqual({ p: sent[0].product, c: sent[0].campaign, e: sent[0].event, l: sent[0].link_code, m: sent[0].email }, { p: 'scribeai', c: 'sc-2026-12-a', e: 'signup', l: 'abc123', m: 'b@x.test' });
});

test('with the layer off the account still stores the first touch but nothing is sent', async () => {
  created.length = 0; let fetched = 0;
  globalThis.fetch = async (url, init) => { if (String(url).startsWith('https://calldesk.example')) fetched++; return realFetch(url, init); };
  try { assert.equal((await register({ email: 'c@x.test', password: 'secret1', signup_source: src })).status, 201); await new Promise((r) => setTimeout(r, 20)); } finally { globalThis.fetch = realFetch; }
  assert.equal(created[0].app_metadata.outreach.campaign, 'sc-2026-12-a'); assert.equal(fetched, 0);
});

test('a non-outreach or malformed signup_source is ignored', async () => {
  created.length = 0;
  const sent = await withLayer(async () => {
    await register({ email: 'd@x.test', password: 'secret1', signup_source: { utm_source: 'google', utm_campaign: 'x' } });
    await register({ email: 'e@x.test', password: 'secret1', signup_source: 'outreach' });
  });
  assert.equal(created[0].app_metadata, undefined); assert.equal(created[1].app_metadata, undefined); assert.equal(sent.length, 0);
});

test('activation lookup reads the stored attribution and email back from the auth user', async () => {
  users.set('u-out', { id: 'u-out', email: 'o@x.test', app_metadata: { outreach: { campaign: 'sc-2026-12-a', code: 'abc123' } } });
  users.set('u-plain', { id: 'u-plain', email: 'p@x.test', app_metadata: { provider: 'email' } });
  assert.deepEqual(await lookupActivation('u-out'), { attribution: { campaign: 'sc-2026-12-a', linkCode: 'abc123' }, email: 'o@x.test' });
  assert.equal(await lookupActivation('u-plain'), null);
  assert.equal(await lookupActivation('missing'), null);
});
