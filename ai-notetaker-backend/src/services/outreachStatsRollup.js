/**
 * Daily outreach stats rollup.
 *
 * READ/AGGREGATE ONLY. This never sends, queues or modifies an email and never touches a contact. It reads rows
 * that already exist in outreach_emails (sent_at, delivered_at, bounced_at, opened_at, replied_at, status) and
 * upserts one row per (domain, UTC date) into outreach_daily_stats.
 *
 * Counting is by SEND DATE (a cohort): "of the emails sent on day D, how many have since been delivered /
 * bounced / complained / opened / replied". Re-running a day therefore picks up late events, which is why the
 * cron re-rolls the last few days, not just yesterday.
 *
 * Rates are percentages with 2 decimals (the column is DECIMAL(5,2)). A rate is NULL, not 0, when no feedback
 * event of that kind could have been observed: if no delivery/bounce/complaint event was recorded for the cohort,
 * "0% bounced" would claim a clean result we cannot know (the event webhook may not be wired for the sender).
 */

const { logger } = require('../utils/logger');

const DEFAULT_DOMAIN = process.env.OUTREACH_FROM_DOMAIN || 'scribeai.online';
const PAGE_SIZE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Round-trips through Date so impossible days such as 2026-02-30 (which V8 would silently roll to March) are rejected.
const isDateString = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};

/** UTC YYYY-MM-DD for a Date or ms timestamp. */
function utcDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Inclusive list of UTC dates from..to. Throws on bad input or a range over maxDays. */
function dateRange(from, to, maxDays = 120) {
  if (!isDateString(from) || !isDateString(to)) throw new Error('from and to must be YYYY-MM-DD');
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (end < start) throw new Error('to must not be before from');
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > maxDays) throw new Error(`range too long (${days} days, max ${maxDays})`);
  return Array.from({ length: days }, (_, i) => utcDate(start + i * DAY_MS));
}

const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : null);

/**
 * Pure aggregation: the emails sent on one day -> one outreach_daily_stats row.
 * @param {Array<object>} emails outreach_emails rows sent on `date`
 */
function buildDailyRow(emails, { domain = DEFAULT_DOMAIN, date }) {
  const sent = emails.length;
  const delivered = emails.filter((e) => e.delivered_at).length;
  const bounced = emails.filter((e) => e.bounced_at || e.status === 'bounced').length;
  const complained = emails.filter((e) => e.status === 'complained').length;
  const opened = emails.filter((e) => e.opened_at).length;
  const replied = emails.filter((e) => e.replied_at).length;

  // Feedback events seen for this cohort. With none, deliverability rates are unknown.
  const feedbackSeen = delivered + bounced + complained;

  return {
    domain,
    date,
    sent_count: sent,
    delivered_count: delivered,
    bounced_count: bounced,
    complained_count: complained,
    opened_count: opened,
    replied_count: replied,
    bounce_rate: feedbackSeen > 0 ? pct(bounced, sent) : null,
    complaint_rate: feedbackSeen > 0 ? pct(complained, sent) : null,
    // Opens need a tracking pixel; no recorded open means "unknown", same rule.
    open_rate: opened > 0 ? pct(opened, sent) : null,
  };
}

/** Read every outreach_emails row sent during the UTC day `date` (paged; PostgREST caps a page at 1000). */
async function fetchSentOn(db, date) {
  const startIso = `${date}T00:00:00.000Z`;
  const endIso = utcDate(Date.parse(startIso) + DAY_MS) + 'T00:00:00.000Z';
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('outreach_emails')
      .select('status, sent_at, delivered_at, bounced_at, opened_at, replied_at')
      .gte('sent_at', startIso)
      .lt('sent_at', endIso)
      .order('sent_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`outreach_emails read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Roll up one day. Days with no sends are skipped (no row), so an idle outreach program leaves the table empty
 * rather than filling it with zero rows. Returns the row written, or null.
 */
async function rollupDay(db, date, { domain = DEFAULT_DOMAIN, dryRun = false } = {}) {
  const emails = await fetchSentOn(db, date);
  if (emails.length === 0) return null;
  const row = buildDailyRow(emails, { domain, date });
  if (!dryRun) {
    const { error } = await db.from('outreach_daily_stats').upsert(row, { onConflict: 'domain,date' });
    if (error) throw new Error(`outreach_daily_stats upsert failed: ${error.message}`);
  }
  return row;
}

async function rollupRange(db, from, to, opts = {}) {
  const rows = [];
  for (const date of dateRange(from, to)) {
    const row = await rollupDay(db, date, opts);
    if (row) rows.push(row);
  }
  return rows;
}

/** The last `days` complete UTC days (yesterday back), as [from, to]. */
function recentWindow(now = Date.now(), days = 7) {
  return [utcDate(now - days * DAY_MS), utcDate(now - DAY_MS)];
}

/**
 * Cron registration. OFF unless OUTREACH_STATS_ROLLUP_CRON === 'true' (independent of ENABLE_CRON_JOBS so turning on
 * the creator-payout jobs does not also turn this on). Runs 06:10 UTC and re-rolls the last 7 complete days.
 */
function initializeOutreachRollupCron({ db, cron } = {}) {
  if (process.env.OUTREACH_STATS_ROLLUP_CRON !== 'true') return false;
  let scheduler = cron;
  if (!scheduler) {
    try {
      scheduler = require('node-cron');
    } catch (e) {
      logger.warn('node-cron not installed; outreach stats rollup will not run in-process');
      return false;
    }
  }
  const client = db || require('../config/supabase').supabaseAdmin;
  scheduler.schedule('10 6 * * *', async () => {
    try {
      const [from, to] = recentWindow();
      const rows = await rollupRange(client, from, to);
      logger.info('Outreach stats rollup done', { from, to, days: rows.length });
    } catch (error) {
      logger.error('Outreach stats rollup failed', { error: error.message });
      try {
        require('../utils/failureReporter').reportFailure('cron_job_failed', error, { job: 'Outreach stats rollup' });
      } catch (_) { /* reporter is best effort */ }
    }
  }, { timezone: 'UTC' });
  logger.info('Outreach stats rollup cron initialized (daily 06:10 UTC)');
  return true;
}

module.exports = {
  buildDailyRow, dateRange, recentWindow, rollupDay, rollupRange, initializeOutreachRollupCron, utcDate, DEFAULT_DOMAIN,
};
