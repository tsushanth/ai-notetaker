// Boots the real app with stand-in settings and a limit of 2: no header a client can send may lift the limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SHARED_VALUE = 'value-an-app-build-could-carry';

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function boot(t) {
  const port = await freePort();
  const required = ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_WEB_CLIENT_ID',
    'GOOGLE_IOS_CLIENT_ID', 'GOOGLE_ANDROID_CLIENT_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPGRAM_API_KEY',
    'SUPADATA_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY', 'STRIPE_WEBHOOK_SECRET'];
  // Nothing is inherited from the parent environment, and the working directory holds no .env file.
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    PORT: String(port),
    SUPABASE_URL: 'http://127.0.0.1:9',
    ...Object.fromEntries(required.map((n) => [n, 'test-stand-in-value-0123456789'])),
    RATE_LIMIT_MAX_REQUESTS: '2',
    RATE_LIMIT_BYPASS_TOKEN: SHARED_VALUE,
    LLM_PROBE_INTERVAL_MIN: '0',
  };
  const child = spawn(process.execPath, [path.join(__dirname, '../src/app.js')], { cwd: os.tmpdir(), env });
  t.after(() => child.kill('SIGKILL'));
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

test('a client-sent x-bypass-rate-limit header does not lift the limit', async (t) => {
  const base = await boot(t);
  const ask = async () => (await fetch(`${base}/api/no-such-route`, { headers: { 'x-bypass-rate-limit': SHARED_VALUE } })).status;
  assert.deepEqual([await ask(), await ask(), await ask()], [404, 404, 429]);
});
