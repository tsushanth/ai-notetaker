const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/routeHarness');
h.install();
const { webLink, playLink, isStaleOutreachBody } = require('../src/utils/outreachContent');

// Run the real router with admin check and sender stubbed: no mail can leave this test.
const sent = [];
const stub = (rel, exports) => { const full = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
stub('services/sendgridOutreachService.js', { sendBatch: async (emails) => { sent.push(...emails); return { sent: emails.length }; }, sendEmail: async (e) => { sent.push(e); return { success: true }; } });
stub('services/universityScraperService.js', {});
stub('services/companyScraperService.js', {});
let queued = [];
const chain = (data) => { const p = Promise.resolve({ data, error: null }); for (const m of ['select', 'eq', 'update', 'limit', 'order', 'range', 'in', 'is']) p[m] = () => p; p.single = async () => ({ data, error: null }); return p; };
stub('config/supabase.js', { supabaseAdmin: {
  from: (t) => (t === 'users' ? chain({ role: 'admin' }) : t === 'outreach_campaigns' ? chain({ id: 'c1', status: 'active' }) : t === 'outreach_emails' ? chain(queued.slice()) : chain(null)),
  rpc: async () => ({ data: null, error: null }),
} });
const app = h.makeApp({ '/api/outreach': require('../src/routes/outreach') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());

test('educator templates: no Apple link, Play and web links tagged utm_source=email, no other product', async () => {
  const r = await h.call(server, 'GET', '/api/outreach/templates', { user: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 3);
  for (const t of r.body.data) {
    const text = t.subject + t.body;
    assert.ok(!/apple|ios|iphone|ipad|app store|securevox|premium/i.test(text), t.name);
    const hrefs = [...t.body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 2, t.name);
    for (const href of hrefs) {
      const u = new URL(href);
      assert.ok(['scribeai.online', 'play.google.com'].includes(u.hostname), href);
      if (u.hostname === 'scribeai.online' && u.pathname === '/') assert.equal(u.searchParams.get('utm_source'), 'email', href);
      if (u.hostname === 'play.google.com') {
        assert.equal(u.searchParams.get('id'), 'com.kreativekoala.scribeai');
        assert.equal(new URLSearchParams(u.searchParams.get('referrer')).get('utm_source'), 'email');
      }
    }
    assert.match(t.body, /Founder, <a href="https:\/\/scribeai\.online\/\?utm_source=email[^"]*">Scribe AI<\/a>|Sushanth\n?$/);
  }
});

test('the SecureVox template route is gone and the source has no SecureVox copy', async () => {
  const r = await h.call(server, 'GET', '/api/outreach/templates/securevox', { user: 'admin' });
  assert.equal(r.status, 404);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'outreach.js'), 'utf8');
  assert.ok(!/<strong>SecureVox/.test(src));
  assert.ok(!/apps\.apple\.com/.test(src));
});

test('stale content is detected; current content is not', () => {
  assert.equal(isStaleOutreachBody('<a href="https://apps.apple.com/us/app/x/id1">iOS</a>'), true);
  assert.equal(isStaleOutreachBody('<p>Founder, SecureVox</p>'), true);
  assert.equal(isStaleOutreachBody(`<a href="${webLink('educator', 'intro')}">x</a><a href="${playLink('educator')}">y</a>`), false);
  assert.equal(isStaleOutreachBody(null), false);
});

test('send: queued mail with an App Store link stays queued and is never handed to the sender', async () => {
  sent.length = 0;
  queued = [
    { id: 'e1', to_email: 'a@x.test', subject: 's', body_html: '<a href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602">iOS</a>', contact_id: 'k1' },
    { id: 'e2', to_email: 'b@x.test', subject: 's', body_html: `<a href="${webLink('educator')}">web</a>`, contact_id: 'k2' },
  ];
  let r = await h.call(server, 'POST', '/api/outreach/campaigns/c1/send', { user: 'admin', body: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(sent.map((e) => e.emailId), ['e2']);
  assert.equal(r.body.skippedStale, 1);

  sent.length = 0;
  queued = [queued[0]];
  r = await h.call(server, 'POST', '/api/outreach/campaigns/c1/send', { user: 'admin', body: {} });
  assert.equal(r.body.sent, 0);
  assert.equal(sent.length, 0);
  assert.equal(r.body.skippedStale, 1);
});

test('send-test refuses stale bodies', async () => {
  sent.length = 0;
  const r = await h.call(server, 'POST', '/api/outreach/send-test', { user: 'admin', body: { to: 'me@x.test', subject: 's', body: '<a href="https://apps.apple.com/x">ios</a>' } });
  assert.equal(r.status, 400);
  assert.equal(sent.length, 0);
});

test('nothing in the backend schedules outreach: no cron or timer reaches the outreach services', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'));
  const schedulers = files.filter((f) => /cron\.schedule|setInterval\(/.test(fs.readFileSync(f, 'utf8')));
  for (const f of schedulers) assert.ok(!/OutreachService|outreach/i.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} schedules something that mentions outreach`);
});
