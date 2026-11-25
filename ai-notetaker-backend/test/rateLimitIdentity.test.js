// Boots the real app with stand-in settings and a limit of 2: only a verified user or Fly's client address decides
// which allowance a request counts against.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SECRET = 'test-stand-in-value-0123456789';
const ALLOWED = '10.9.9.9';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const freePort = async () => { const s = net.createServer(); const port = await listen(s); await new Promise((r) => s.close(r)); return port; };

// Stands in for Supabase Auth: it knows one token that cannot be checked with the app's own secret.
const supabaseToken = jwt.sign({ sub: 'supa-user' }, 'a-different-signing-secret', { expiresIn: '1h' });
function supabaseStandIn() {
  return http.createServer((req, res) => {
    const known = req.headers.authorization === `Bearer ${supabaseToken}`;
    if (req.url.startsWith('/auth/v1/user') && known) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'supa-user', email: 'someone@example.com' }));
    }
    if (req.url.startsWith('/auth/v1/logout')) return res.writeHead(204).end();
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"msg":"invalid"}');
  });
}

async function boot(t) {
  const supabase = supabaseStandIn();
  const supabasePort = await listen(supabase);
  const port = await freePort();
  const required = ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_WEB_CLIENT_ID',
    'GOOGLE_IOS_CLIENT_ID', 'GOOGLE_ANDROID_CLIENT_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPGRAM_API_KEY',
    'SUPADATA_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY', 'STRIPE_WEBHOOK_SECRET'];
  // Nothing is inherited from the parent environment, and the working directory holds no .env file.
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    PORT: String(port),
    SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
    ...Object.fromEntries(required.map((n) => [n, SECRET])),
    RATE_LIMIT_MAX_REQUESTS: '2',
    RATE_LIMIT_ALLOWLIST: ` ${ALLOWED} `,
    LLM_PROBE_INTERVAL_MIN: '0',
  };
  const child = spawn(process.execPath, [path.join(__dirname, '../src/app.js')], { cwd: os.tmpdir(), env });
  t.after(() => { child.kill('SIGKILL'); supabase.closeAllConnections(); supabase.close(); });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`app did not start:\n${output}`)), 30_000);
    const read = (d) => { output += d; if (output.includes('Server running on port')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`app exited ${code}:\n${output}`)); });
  });
  return `http://127.0.0.1:${port}`;
}

test('the API limit counts verified users and real client addresses only', async (t) => {
  const base = await boot(t);
  const ask = async (headers, route = '/api/no-such-route', method = 'GET') => (await fetch(base + route, { method, headers })).status;
  const from = (ip, more = {}) => ({ 'fly-client-ip': ip, ...more });
  const bearer = (token) => ({ authorization: `Bearer ${token}` });
  const three = async (make) => [await ask(make(0)), await ask(make(1)), await ask(make(2))];
  const LIMITED = [404, 404, 429];

  await t.test('a new X-Forwarded-For value does not give a new allowance', async () => {
    assert.deepEqual(await three((i) => from('10.0.0.1', { 'x-forwarded-for': `9.9.9.${i}` })), LIMITED);
  });
  await t.test('an unverified token does not give a new allowance, in the header or the query', async () => {
    const forged = (i) => jwt.sign({ sub: `made-up-${i}` }, 'not-the-secret');
    const unsigned = (i) => jwt.sign({ sub: `unsigned-${i}` }, null, { algorithm: 'none' });
    assert.deepEqual(await three((i) => from('10.0.0.2', bearer(forged(i)))), LIMITED);
    assert.deepEqual(await three((i) => from('10.0.0.3', bearer(unsigned(i)))), LIMITED);
    assert.equal(await ask(from('10.0.0.2'), `/api/no-such-route?token=${forged(9)}`), 429);
    assert.equal(await ask(from('10.0.0.2', bearer(jwt.sign({ sub: 'old', exp: 1 }, SECRET)))), 429);
  });
  await t.test('a forged token naming a real user does not use up that user\'s allowance', async () => {
    await three((i) => from('10.0.0.4', bearer(jwt.sign({ sub: 'victim', n: i }, 'not-the-secret'))));
    assert.equal(await ask(from('10.0.0.5', bearer(jwt.sign({ sub: 'victim' }, SECRET)))), 404);
  });
  await t.test('verified users behind one address each have their own allowance, across addresses', async () => {
    const a = bearer(jwt.sign({ sub: 'user-a' }, SECRET));
    const b = bearer(jwt.sign({ sub: 'user-b' }, SECRET));
    assert.deepEqual(await three(() => from('10.0.0.6', a)), LIMITED);
    assert.equal(await ask(from('10.0.0.6', b)), 404);
    assert.equal(await ask(from('10.0.0.7', a)), 429);
    assert.equal(await ask(from('10.0.0.6')), 404);
  });
  await t.test('a token Supabase has confirmed counts against its user from then on', async () => {
    // First sight: counted against the address, then confirmed by the route's sign-in check.
    assert.equal(await ask(from('10.0.0.8', bearer(supabaseToken)), '/api/auth/logout', 'POST'), 200);
    assert.deepEqual(await three(() => from('10.0.0.8', bearer(supabaseToken))), LIMITED);
    assert.equal(await ask(from('10.0.0.8')), 404); // the address spent only the first request
  });
  await t.test('the allowlist reads the real client address, exactly', async () => {
    assert.deepEqual(await three(() => from(ALLOWED)), [404, 404, 404]);
    assert.deepEqual(await three(() => from('10.0.0.9', { 'x-forwarded-for': ALLOWED })), LIMITED);
    assert.deepEqual(await three(() => from(`1${ALLOWED}`)), LIMITED);
  });
});
