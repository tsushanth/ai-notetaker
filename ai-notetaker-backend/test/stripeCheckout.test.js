const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrCreateCustomer, findOpenSession, createSession } = require('../src/utils/stripeCheckout');

function fakeStripe({ retrieve, list = [], search = [], listThrows, searchThrows, sessions = [] } = {}) {
  const calls = { create: [], customersList: [], search: [], sessionCreate: [] };
  let n = 0;
  const keys = new Map();
  return {
    calls,
    customers: {
      retrieve: async (id) => { if (retrieve instanceof Error) throw retrieve; return retrieve || { id }; },
      list: async (q) => { calls.customersList.push(q); if (listThrows) throw new Error('boom'); return { data: list }; },
      search: async (q) => { calls.search.push(q); if (searchThrows) throw new Error('no search'); return { data: search }; },
      create: async (params, opts) => {
        calls.create.push({ params, opts });
        if (keys.has(opts.idempotencyKey)) return keys.get(opts.idempotencyKey);
        const c = { id: `cus_new${++n}` }; keys.set(opts.idempotencyKey, c); return c;
      },
    },
    checkout: {
      sessions: {
        list: async () => { if (sessions === 'throw') throw new Error('x'); return { data: sessions }; },
        create: async (cfg, opts) => {
          calls.sessionCreate.push({ cfg, opts });
          if (keys.has(opts.idempotencyKey)) return keys.get(opts.idempotencyKey);
          const s = { id: `cs_new${++n}`, url: 'https://checkout.stripe.com/x' }; keys.set(opts.idempotencyKey, s); return s;
        },
      },
    },
  };
}
const base = { userId: 'u1', email: 'a@example.test', name: 'A', now: 1_800_000_000_000 };

test('a stored customer id that still exists is reused with no other calls', async () => {
  const s = fakeStripe();
  const r = await getOrCreateCustomer({ ...base, stripe: s, storedCustomerId: 'cus_stored' });
  assert.deepEqual(r, { customerId: 'cus_stored', source: 'stored' });
  assert.equal(s.calls.customersList.length, 0);
  assert.equal(s.calls.create.length, 0);
});

test('REGRESSION: no stored id but the user already has a customer in Stripe (earlier abandoned attempt) -> reuse the newest, create none', async () => {
  const s = fakeStripe({ list: [
    { id: 'cus_old', created: 1, metadata: { userId: 'u1' } },
    { id: 'cus_newest', created: 9, metadata: { userId: 'u1' } },
    { id: 'cus_other_user_same_email', created: 99, metadata: { userId: 'u2' } },
    { id: 'cus_no_meta', created: 100, metadata: {} },
  ] });
  const r = await getOrCreateCustomer({ ...base, stripe: s });
  assert.deepEqual(r, { customerId: 'cus_newest', source: 'email' });
  assert.equal(s.calls.create.length, 0);
});

test('a deleted stored customer is skipped; falls through to lookup', async () => {
  const s = fakeStripe({ retrieve: { id: 'cus_stored', deleted: true }, list: [{ id: 'cus_b', created: 1, metadata: { userId: 'u1' } }] });
  const r = await getOrCreateCustomer({ ...base, stripe: s, storedCustomerId: 'cus_stored' });
  assert.equal(r.customerId, 'cus_b');
});

test('a changed email is still found through metadata search', async () => {
  const s = fakeStripe({ search: [{ id: 'cus_s', created: 5, metadata: { userId: 'u1' } }] });
  const r = await getOrCreateCustomer({ ...base, stripe: s });
  assert.deepEqual(r, { customerId: 'cus_s', source: 'search' });
  assert.match(s.calls.search[0].query, /metadata\['userId'\]:'u1'/);
});

test('search query strips quotes from the user id (no query injection)', async () => {
  const s = fakeStripe();
  await getOrCreateCustomer({ ...base, userId: "u1' OR email:'x", stripe: s });
  assert.doesNotMatch(s.calls.search[0].query, /OR email/);
});

test('nothing exists -> creates exactly one, with userId metadata and an idempotency key; lookups failing does not block', async () => {
  const s = fakeStripe({ listThrows: true, searchThrows: true });
  const r = await getOrCreateCustomer({ ...base, stripe: s });
  assert.equal(r.source, 'created');
  assert.equal(s.calls.create.length, 1);
  assert.deepEqual(s.calls.create[0].params.metadata, { userId: 'u1' });
  assert.match(s.calls.create[0].opts.idempotencyKey, /^scribe-customer:u1:/);
});

test('concurrent double-tap (same 5 min) gets the same customer back from Stripe via the idempotency key', async () => {
  const s = fakeStripe();
  const [a, b] = await Promise.all([getOrCreateCustomer({ ...base, stripe: s }), getOrCreateCustomer({ ...base, stripe: s })]);
  assert.equal(a.customerId, b.customerId);
});

const open = (over = {}) => ({ id: 'cs_open', url: 'https://c', status: 'open', expires_at: 1_800_000_000 + 7200, metadata: { userId: 'u1', priceId: 'price_m', discount: '0' }, ...over });
const find = (sessions, over = {}) => findOpenSession({ stripe: fakeStripe({ sessions }), customerId: 'cus_1', userId: 'u1', priceId: 'price_m', discount: false, now: 1_800_000_000_000, ...over });

test('a still-open session for the same user, price and discount state is returned', async () => {
  assert.equal((await find([open()])).id, 'cs_open');
});

test('sessions that are the wrong price, wrong discount state, nearly expired, other user or have no url are not reused', async () => {
  assert.equal(await find([open({ metadata: { userId: 'u1', priceId: 'price_y', discount: '0' } })]), null);
  assert.equal(await find([open()], { discount: true }), null);
  assert.equal(await find([open({ expires_at: 1_800_000_000 + 60 })]), null);
  assert.equal(await find([open({ metadata: { userId: 'u2', priceId: 'price_m', discount: '0' } })]), null);
  assert.equal(await find([open({ url: null })]), null);
  assert.equal(await find([open({ metadata: undefined })]), null); // sessions made before this change carry no metadata
});

test('a failing session lookup never blocks checkout', async () => {
  assert.equal(await find('throw'), null);
});

test('createSession passes the config through untouched with an idempotency key; identical repeats collapse', async () => {
  const s = fakeStripe();
  const cfg = { customer: 'cus_1', mode: 'subscription', line_items: [{ price: 'price_m', quantity: 1 }], subscription_data: { trial_period_days: 7 } };
  const a = await createSession({ stripe: s, sessionConfig: cfg, userId: 'u1', now: 1_800_000_000_000 });
  const b = await createSession({ stripe: s, sessionConfig: cfg, userId: 'u1', now: 1_800_000_020_000 });
  assert.equal(a.id, b.id);
  assert.deepEqual(s.calls.sessionCreate[0].cfg, cfg);
  const c = await createSession({ stripe: s, sessionConfig: { ...cfg, customer: 'cus_2' }, userId: 'u1', now: 1_800_000_000_000 });
  assert.notEqual(c.id, a.id);
});
