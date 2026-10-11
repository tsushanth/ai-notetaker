const test = require('node:test');
const assert = require('node:assert/strict');
const { adminOnly, isAdminEmail } = require('../src/middleware/adminOnly');

const run = (email) => { let code = null; let nexted = false; const res = { status(c) { code = c; return this; }, json() { return this; } }; adminOnly({ userEmail: email }, res, () => { nexted = true; }); return { code, nexted }; };

test('the owner address passes, any case and with stray spaces', () => {
  delete process.env.ADMIN_EMAILS;
  assert.deepEqual(run('t.sushanth@gmail.com'), { code: null, nexted: true });
  assert.equal(run('  T.Sushanth@Gmail.com ').nexted, true);
});

test('anyone else, or no email, gets 404 and never reaches the route', () => {
  delete process.env.ADMIN_EMAILS;
  for (const e of ['someone@example.com', '', undefined, null, 't.sushanth@gmail.com.evil.com', 'xt.sushanth@gmail.com']) assert.deepEqual(run(e), { code: 404, nexted: false }, String(e));
});

test('ADMIN_EMAILS overrides the default allowlist', () => {
  process.env.ADMIN_EMAILS = 'a@x.com, B@y.com';
  assert.equal(isAdminEmail('b@y.com'), true);
  assert.equal(isAdminEmail('t.sushanth@gmail.com'), false);
  delete process.env.ADMIN_EMAILS;
});
