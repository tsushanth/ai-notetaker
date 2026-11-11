const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/routeHarness');
h.install();

// The Android client no longer sends a device id with POST /api/subscriptions/sync. The server never used one
// there (the trial / metric endpoints take their own deviceId), so a sync without it must succeed and a stale
// client that still sends one must be tolerated and the value must not be stored.

const U = '11111111-1111-1111-1111-111111111111';
const app = h.makeApp({ '/api/subscriptions': require('../src/routes/subscriptions') });
let server;
test.before(async () => { server = await h.listen(app); });
test.after(() => server.close());
test.beforeEach(() => h.resetDb());

const body = { productId: 'scribeai_monthly', platform: 'android', status: 'active', transactionId: 'GPA.1' };

test('sync without any device id succeeds', async () => {
  const r = await h.call(server, 'POST', '/api/subscriptions/sync', { user: U, body });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(h.db.subscriptions.length, 1);
});

test('sync from an older client that still sends deviceId is accepted and the id is ignored', async () => {
  const r = await h.call(server, 'POST', '/api/subscriptions/sync', { user: U, body: { ...body, deviceId: 'android_abc123' } });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(h.db).includes('android_abc123'));
});
