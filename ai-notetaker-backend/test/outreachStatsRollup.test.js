const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/services/outreachStatsRollup');

// A tiny in-memory stand-in for the two tables the rollup touches. Records every write so tests can prove what is written.
function fakeDb(emails) {
  const writes = [];
  const db = {
    writes,
    from(table) {
      const q = { table, filters: [] };
      const chain = {
        select() { return chain; },
        gte(col, v) { q.filters.push((row) => row[col] >= v); return chain; },
        lt(col, v) { q.filters.push((row) => row[col] < v); return chain; },
        order() { return chain; },
        range(a, b) {
          const rows = emails.filter((row) => q.filters.every((f) => f(row))).slice(a, b + 1);
          return Promise.resolve({ data: rows, error: null });
        },
        upsert(row, opts) { writes.push({ table, row, opts }); return Promise.resolve({ error: null }); },
      };
      return chain;
    },
  };
  return db;
}

const mail = (o) => ({ status: 'sent', sent_at: '2026-01-26T10:00:00Z', delivered_at: null, bounced_at: null, opened_at: null, replied_at: null, ...o });

test('buildDailyRow counts each event and computes percentage rates', () => {
  const emails = [
    mail({ status: 'delivered', delivered_at: '2026-01-26T10:01:00Z', opened_at: '2026-01-26T11:00:00Z' }),
    mail({ status: 'delivered', delivered_at: '2026-01-26T10:01:00Z', replied_at: '2026-01-27T09:00:00Z' }),
    mail({ status: 'bounced', bounced_at: '2026-01-26T10:02:00Z' }),
    mail({ status: 'complained' }),
  ];
  const row = r.buildDailyRow(emails, { domain: 'd.test', date: '2026-01-26' });
  assert.deepEqual(row, {
    domain: 'd.test', date: '2026-01-26', sent_count: 4, delivered_count: 2, bounced_count: 1, complained_count: 1,
    opened_count: 1, replied_count: 1, bounce_rate: 25, complaint_rate: 25, open_rate: 25,
  });
});

test('with no delivery, bounce or complaint events the rates are NULL, never a clean-looking 0', () => {
  const row = r.buildDailyRow([mail({}), mail({}), mail({})], { date: '2026-01-26' });
  assert.equal(row.sent_count, 3);
  assert.equal(row.bounce_rate, null);
  assert.equal(row.complaint_rate, null);
  assert.equal(row.open_rate, null);
});

test('a bounce status without a bounced_at timestamp still counts as bounced', () => {
  const row = r.buildDailyRow([mail({ status: 'bounced' }), mail({ delivered_at: 'x' })], { date: '2026-01-26' });
  assert.equal(row.bounced_count, 1);
  assert.equal(row.bounce_rate, 50);
});

test('dateRange is inclusive, validates input and caps the span', () => {
  assert.deepEqual(r.dateRange('2026-01-30', '2026-02-02'), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  assert.throws(() => r.dateRange('2026-1-3', '2026-01-04'), /YYYY-MM-DD/);
  assert.throws(() => r.dateRange('2026-02-30', '2026-03-01'), /YYYY-MM-DD/);
  assert.throws(() => r.dateRange('2026-02-02', '2026-02-01'), /before/);
  assert.throws(() => r.dateRange('2025-01-01', '2026-01-01'), /too long/);
});

test('recentWindow is the last complete UTC days, today excluded', () => {
  assert.deepEqual(r.recentWindow(Date.parse('2026-11-03T15:00:00Z'), 7), ['2026-10-27', '2026-11-02']);
});

test('rollupRange writes one upsert per day that had sends, keyed on domain,date, and only to outreach_daily_stats', async () => {
  const db = fakeDb([
    mail({ sent_at: '2026-01-25T23:59:59Z' }),
    mail({ sent_at: '2026-01-26T00:00:00Z', delivered_at: 'x' }),
    mail({ sent_at: '2026-01-26T12:00:00Z' }),
    // 2026-01-27 has no sends -> no row
    mail({ sent_at: '2026-01-28T05:00:00Z' }),
  ]);
  const rows = await r.rollupRange(db, '2026-01-25', '2026-01-28', { domain: 'd.test' });
  assert.deepEqual(rows.map((x) => [x.date, x.sent_count]), [['2026-01-25', 1], ['2026-01-26', 2], ['2026-01-28', 1]]);
  assert.equal(db.writes.length, 3);
  for (const w of db.writes) {
    assert.equal(w.table, 'outreach_daily_stats');
    assert.deepEqual(w.opts, { onConflict: 'domain,date' });
  }
});

test('dryRun reads and returns rows but performs no write', async () => {
  const db = fakeDb([mail({})]);
  const rows = await r.rollupRange(db, '2026-01-26', '2026-01-26', { dryRun: true });
  assert.equal(rows.length, 1);
  assert.equal(db.writes.length, 0);
});

test('an idle program writes nothing', async () => {
  const db = fakeDb([]);
  assert.deepEqual(await r.rollupRange(db, '2026-01-26', '2026-01-28'), []);
  assert.equal(db.writes.length, 0);
});

test('the cron is OFF by default and registers a schedule only when the flag is exactly "true"', () => {
  const calls = [];
  const cron = { schedule: (...a) => calls.push(a) };
  delete process.env.OUTREACH_STATS_ROLLUP_CRON;
  assert.equal(r.initializeOutreachRollupCron({ db: {}, cron }), false);
  process.env.OUTREACH_STATS_ROLLUP_CRON = '1';
  assert.equal(r.initializeOutreachRollupCron({ db: {}, cron }), false);
  assert.equal(calls.length, 0);
  process.env.OUTREACH_STATS_ROLLUP_CRON = 'true';
  assert.equal(r.initializeOutreachRollupCron({ db: {}, cron }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '10 6 * * *');
  delete process.env.OUTREACH_STATS_ROLLUP_CRON;
});

test('the module reads outreach_emails and writes only outreach_daily_stats (no send, no contact update)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/services/outreachStatsRollup'), 'utf8');
  assert.deepEqual([...new Set([...src.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort(), ['outreach_daily_stats', 'outreach_emails']);
  assert.ok(!/sendgrid|sgMail|\.send\(|faculty_contacts|company_campaigns/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
});
