const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();

let upsertResult = { error: null };
const upserts = [];
const supaPath = require.resolve(path.join(__dirname, '..', 'src', 'config', 'supabase.js'));
require.cache[supaPath] = {
  id: supaPath, filename: supaPath, loaded: true,
  exports: { supabase: {}, supabaseAdmin: { from: (t) => ({ upsert: async (row, opts) => { upserts.push([t, row, opts]); return upsertResult; } }) } }
};
const app = h.makeApp({ '/api/onboarding': require('../src/routes/onboarding') });

test('POST /api/onboarding: saved when the table exists', async () => {
  const server = await h.listen(app);
  try {
    upsertResult = { error: null };
    const r = await h.call(server, 'POST', '/api/onboarding', { user: 'u1', body: { user_type: 'student', use_cases: ['lectures'] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(r.body.saved, true);
    assert.equal(upserts[0][0], 'user_profiles');
    assert.equal(upserts[0][1].user_id, 'u1');
    assert.deepEqual(upserts[0][1].use_cases, ['lectures']);
  } finally { server.close(); }
});

test('POST /api/onboarding: missing table (PGRST205, as seen in production) does not block onboarding and says nothing was saved', async () => {
  const server = await h.listen(app);
  try {
    upsertResult = { error: { code: 'PGRST205', message: "Could not find the table 'public.user_profiles' in the schema cache" } };
    const r = await h.call(server, 'POST', '/api/onboarding', { user: 'u1', body: { user_type: 'student' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.equal(r.body.saved, false);
  } finally { server.close(); }
});

test('POST /api/onboarding: requires auth', async () => {
  const server = await h.listen(app);
  try {
    assert.equal((await h.call(server, 'POST', '/api/onboarding', { body: {} })).status, 401);
  } finally { server.close(); }
});
