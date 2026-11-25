// Access checks: scheduled-job endpoints, user webhook addresses and App Store notifications.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./helpers/routeHarness');
h.install();

const { cronAuth } = require('../src/middleware/cronAuth');
const { checkPublicUrl, postJson, isPublicAddress } = require('../src/utils/safeOutbound');
const { verifyAppleJws } = require('../src/utils/appleJws');

const app = h.makeApp({ '/api/subscriptions': require('../src/routes/subscriptions') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());
test.beforeEach(() => { h.resetDb(); delete process.env.CRON_SECRET_TOKEN; });

const post = (url, headers = {}, body = {}) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}).then((r) => r.status);

test('fix-stale-trials: any Authorization or scheduler header is no longer enough', async () => {
  const url = '/api/subscriptions/fix-stale-trials';
  const spoofs = [{ Authorization: 'x' }, { Authorization: 'Bearer anything' }, { 'x-cloudscheduler': 'true' }, { 'x-appengine-cron': 'true' }, {}];
  for (const headers of spoofs) assert.equal(await post(url, headers), 503, 'closed with no secret configured');
  process.env.CRON_SECRET_TOKEN = 'the-secret';
  for (const headers of spoofs) assert.equal(await post(url, headers), 401);
});

test('cron auth accepts only the exact secret, in either header', () => {
  process.env.CRON_SECRET_TOKEN = 'the-secret';
  const run = (headers) => {
    const out = { status: null, passed: false };
    cronAuth({ headers, baseUrl: '', path: '/x' }, { status: (c) => { out.status = c; return { json: () => {} }; } }, () => { out.passed = true; });
    return out;
  };
  assert.equal(run({ authorization: 'Bearer the-secret' }).passed, true);
  assert.equal(run({ 'x-cron-token': 'the-secret' }).passed, true);
  assert.equal(run({ authorization: 'Bearer the-secreT' }).status, 401);
  assert.equal(run({ authorization: 'the-secret' }).status, 401);
});

test('no job or cron route trusts scheduler headers any more', () => {
  for (const f of ['jobs/creatorPayoutJobs.js', 'routes/subscriptions.js', 'routes/creators.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    assert.doesNotMatch(src, /headers\['x-(cloudscheduler|appengine-cron)'\]/, f);
  }
});

test('revenue metrics and Apple history are for the admin only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'subscriptions.js'), 'utf8');
  for (const route of ["'/metrics'", "'/apple/request-history'", "'/apple/transaction-history'"]) {
    assert.ok(src.includes(`(${route}, authenticate, adminOnly,`), route);
  }
});

// ---- SSRF ----
const resolves = (...ips) => async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

test('private, loopback, link-local, metadata and internal addresses are not public', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fc00::1', 'fdaa:0:1::3', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'ff02::1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('a webhook URL must be https and resolve only to public addresses', async () => {
  const ok = await checkPublicUrl('https://hooks.zapier.com/x', { lookup: resolves('8.8.8.8') });
  assert.equal(ok.address, '8.8.8.8');
  const refused = [
    ['http://example.com/x', resolves('8.8.8.8')], ['https://user:pw@example.com/', resolves('8.8.8.8')], ['file:///etc/passwd', resolves('8.8.8.8')],
    ['https://internal.example/', resolves('10.0.0.5')], ['https://mixed.example/', resolves('8.8.8.8', '127.0.0.1')],
    ['https://[::1]/', resolves('8.8.8.8')], ['https://169.254.169.254/latest', resolves('8.8.8.8')], ['https://2130706433/', resolves('8.8.8.8')],
    ['https://app.internal/', resolves('fdaa:0:1::3')], ['nonsense', resolves('8.8.8.8')],
  ];
  for (const [url, lookup] of refused) await assert.rejects(checkPublicUrl(url, { lookup }), { name: 'UnsafeUrlError' }, url);
  await assert.rejects(checkPublicUrl('https://evil.example/', { lookup: resolves('8.8.8.8'), allowHosts: ['hooks.slack.com'] }), { reason: 'host not allowed' });
});

test('the request connects to the checked address and a redirect is not followed', async () => {
  let seen; let calls = 0;
  const request = (url, options, onResponse) => {
    calls += 1; seen = options;
    return { on() {}, end() { onResponse({ statusCode: 302, resume() {} }); } };
  };
  await assert.rejects(postJson('https://hooks.example/x', { a: 1 }, { request, lookup: resolves('8.8.4.4') }), /HTTP 302/);
  assert.equal(calls, 1);
  seen.lookup('hooks.example', {}, (_e, address) => assert.equal(address, '8.8.4.4'));
  seen.lookup('hooks.example', { all: true }, (_e, list) => assert.deepEqual(list, [{ address: '8.8.4.4', family: 4 }]));
});

test('webhooks are checked at registration and at every send', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'integrationService.js'), 'utf8');
  assert.match(src, /await checkPublicUrl\(webhookUrl\)/);
  assert.match(src, /postJson\(hook\.webhook_url/);
  assert.doesNotMatch(src, /axios\.post\((hook\.webhook_url|webhookUrl)/);
});

// ---- Apple notifications ----
/** A throwaway three-certificate chain with Apple's marker extensions, made with openssl for this run only. */
function makeChain() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-chain-'));
  const ssl = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  const key = (name) => ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}.key`);
  fs.writeFileSync(path.join(dir, 'ca.ext'), 'basicConstraints=critical,CA:TRUE\n1.2.840.113635.100.6.2.1=DER:0500\n');
  fs.writeFileSync(path.join(dir, 'leaf.ext'), 'basicConstraints=CA:FALSE\n1.2.840.113635.100.6.11.1=DER:0500\n');
  fs.writeFileSync(path.join(dir, 'plain.ext'), 'basicConstraints=CA:FALSE\n');
  for (const n of ['root', 'int', 'leaf', 'plain']) key(n);
  ssl('req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Test Root', '-days', '2', '-out', 'root.pem');
  const issue = (name, ca, ext) => {
    ssl('req', '-new', '-key', `${name}.key`, '-subj', `/CN=Test ${name}`, '-out', `${name}.csr`);
    ssl('x509', '-req', '-in', `${name}.csr`, '-CA', `${ca}.pem`, '-CAkey', `${ca}.key`, '-CAcreateserial', '-days', '2', '-extfile', ext, '-out', `${name}.pem`);
  };
  issue('int', 'root', 'ca.ext'); issue('leaf', 'int', 'leaf.ext'); issue('plain', 'int', 'plain.ext');
  const cert = (n) => new crypto.X509Certificate(fs.readFileSync(path.join(dir, `${n}.pem`)));
  const keys = { leaf: fs.readFileSync(path.join(dir, 'leaf.key')), plain: fs.readFileSync(path.join(dir, 'plain.key')) };
  const certs = { root: cert('root'), int: cert('int'), leaf: cert('leaf'), plain: cert('plain') };
  fs.rmSync(dir, { recursive: true, force: true });
  return { certs, keys, rootSha256: crypto.createHash('sha256').update(certs.root.raw).digest('hex') };
}
function sign(chain, payload, { leaf = 'leaf' } = {}) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b({ alg: 'ES256', x5c: [leaf, 'int', 'root'].map((n) => chain.certs[n].raw.toString('base64')) });
  const data = `${head}.${b(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: crypto.createPrivateKey(chain.keys[leaf]), dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

let chain = null;
try { chain = makeChain(); } catch { chain = null; }

test('a correctly signed App Store message verifies; every kind of forgery is rejected', { skip: !chain && 'openssl not available' }, () => {
  const opts = { rootSha256: chain.rootSha256 };
  const good = sign(chain, { notificationType: 'SUBSCRIBED' });
  assert.equal(verifyAppleJws(good, opts).notificationType, 'SUBSCRIBED');
  const reason = (jws, o = opts) => { try { verifyAppleJws(jws, o); return 'accepted'; } catch (e) { return e.reason; } };
  assert.equal(reason(good, {}), 'untrusted_root', 'only Apple\'s own root is trusted outside tests');
  const [head, , sig] = good.split('.');
  const forged = `${head}.${Buffer.from('{"notificationType":"DID_RENEW"}').toString('base64url')}.${sig}`;
  assert.equal(reason(forged), 'bad_signature');
  assert.equal(reason(sign(chain, {}, { leaf: 'plain' })), 'not_app_store');
  assert.equal(reason(good, { ...opts, now: Date.now() + 30 * 86400_000 }), 'certificate_dates');
  assert.equal(reason(`${Buffer.from('{"alg":"none"}').toString('base64url')}.e30.`), 'unreadable');
  assert.equal(reason('a.b'), 'not_a_jws');
});

test('the Apple webhook rejects an unsigned notification and changes nothing', async () => {
  h.db.subscriptions = [{ id: 's1', user_id: 'u', platform: 'ios', product_id: 'p', status: 'active', original_transaction_id: 'o1' }];
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const txn = `${b({ alg: 'ES256' })}.${b({ originalTransactionId: 'o1', productId: 'p' })}.x`;
  const signedPayload = `${b({ alg: 'ES256' })}.${b({ notificationType: 'EXPIRED', data: { signedTransactionInfo: txn } })}.x`;
  assert.equal(await post('/api/subscriptions/webhook/apple', {}, { signedPayload }), 401);
  assert.equal(h.db.subscriptions[0].status, 'active');
});
