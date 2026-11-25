const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness');
const pkg = require.resolve('@supabase/supabase-js');
require.cache[pkg] = { id: pkg, filename: pkg, loaded: true, exports: { createClient: () => ({ auth: {}, from: () => ({}) }) } };

const upstream = [];
let answer = () => new Response('{}', { status: 200 });
const realFetch = global.fetch;
global.fetch = (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  upstream.push({ url: String(url), init });
  return Promise.resolve(answer());
};
const app = h.makeApp({ '/api/auth': require('../src/routes/auth') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

let ip = 0;
const post = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/password/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'fly-client-ip': `10.1.0.${++ip}` }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test('a reset request asks Supabase for a link to the web reset page', async () => {
  upstream.length = 0; answer = () => new Response('{}', { status: 200 });
  const r = await post('reset', { email: 'a@x.test' });
  assert.equal(r.status, 200);
  const u = new URL(upstream[0].url);
  assert.equal(u.pathname, '/auth/v1/recover');
  assert.equal(u.searchParams.get('redirect_to'), 'https://scribeai.online/reset-password');
});

test('a refused or failed email is an error, never success', async () => {
  answer = () => new Response('{"error_code":"over_email_send_rate_limit"}', { status: 429 });
  assert.equal((await post('reset', { email: 'b@x.test' })).status, 429);
  answer = () => new Response('{}', { status: 500 });
  const r = await post('reset', { email: 'c@x.test' });
  assert.equal(r.status, 502);
  assert.equal(r.body.success, false);
  assert.equal((await post('reset', { email: 'nope' })).status, 400);
});

test('a mailer that will not send to this recipient is a send failure, not a bad address', async () => {
  answer = () => new Response('{"error_code":"email_address_not_authorized","msg":"Email address not authorized"}', { status: 400 });
  const r = await post('reset', { email: 'd@x.test' });
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'RESET_SEND_FAILED');
});

test('reset requests per account are limited even when they succeed', async () => {
  answer = () => new Response('{}', { status: 200 });
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await post('reset', { email: 'many@x.test' })).status);
  assert.deepEqual(results, [200, 200, 200, 429]);
});

test('setting the new password uses the recovery token from the link', async () => {
  upstream.length = 0; answer = () => new Response('{"id":"u"}', { status: 200 });
  const r = await post('update', { access_token: 'recovery.token', password: 'new-password' });
  assert.equal(r.status, 200);
  assert.match(upstream[0].url, /\/auth\/v1\/user$/);
  assert.equal(upstream[0].init.method, 'PUT');
  assert.equal(upstream[0].init.headers.Authorization, 'Bearer recovery.token');
});

test('expired link, weak password and missing fields are clear 400s', async () => {
  answer = () => new Response('{"msg":"invalid JWT"}', { status: 401 });
  const expired = await post('update', { access_token: 't', password: 'new-password' });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.code, 'RESET_LINK_EXPIRED');
  answer = () => new Response('{"error_code":"same_password"}', { status: 422 });
  assert.match((await post('update', { access_token: 't', password: 'new-password' })).body.error, /different from your old one/);
  assert.equal((await post('update', { access_token: 't', password: '123' })).status, 400);
  assert.equal((await post('update', { password: 'new-password' })).status, 400);
});
