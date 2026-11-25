/**
 * Server-side resolution of meetings stuck in a non-final status.
 *
 * Meeting statuses otherwise move only when a Recall webhook arrives or while the owner has the meetings screen open. Every
 * INTERVAL this pass takes meetings that have been quiet for a few minutes, reads their bot from Recall and applies the
 * result through the same handler the webhook uses (which also starts processing for a finished bot). Meetings that can
 * no longer finish (no bot was created, processing died, no outcome after a day) are ended as failed with a reason.
 * Safe to run on several machines: every write is conditional on the status that was read, and processing is claimed
 * atomically. Set MEETING_SWEEPER_DISABLED=1 to turn it off.
 */
const { logger } = require('../utils/logger');
const { summarizeBot, MESSAGES } = require('../utils/recallStatus');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const CFG = {
  intervalMs: 5 * MIN,
  firstPassMs: 1 * MIN,
  quietMin: 5,
  noBotMin: 60,
  transcribingStuckMin: 120,
  giveUpHours: 24,
  batch: 100,
};

const UNSETTLED = ['pending', 'bot_joining', 'in_progress', 'recording', 'processing', 'transcribing'];

async function failMeeting(db, meeting, botRun, message) {
  const { error } = await db
    .from('meetings')
    .update({ status: 'failed', error_message: message })
    .eq('id', meeting.id)
    .eq('status', meeting.status);
  if (error) throw new Error(error.message);
  if (botRun) {
    await db
      .from('bot_runs')
      .update({ status: 'failed', error_message: message })
      .eq('id', botRun.id)
      .not('status', 'in', '("done","failed")');
  }
  logger.info('Stale meeting marked failed', { meetingId: meeting.id, previousStatus: meeting.status });
}

/** Returns what was done with one meeting: 'failed', 'reconciled' or 'skipped'. */
async function resolveMeeting(meeting, { db, recall, meetings, now }) {
  const start = Math.max(Date.parse(meeting.created_at), Date.parse(meeting.scheduled_start) || 0);
  if (start > now) return 'skipped';
  const age = now - start;
  const botRun = [...(meeting.bot_runs || [])]
    .filter((r) => r.recall_bot_id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const fail = async (message) => { await failMeeting(db, meeting, botRun, message); return 'failed'; };

  if (meeting.status === 'transcribing') {
    return now - Date.parse(meeting.updated_at) > CFG.transcribingStuckMin * MIN ? fail(MESSAGES.INTERRUPTED) : 'skipped';
  }
  if (!botRun) return age > CFG.noBotMin * MIN ? fail(MESSAGES.NOT_SENT) : 'skipped';

  const expired = age > CFG.giveUpHours * HOUR;
  let bot;
  try {
    bot = await recall.getBotStatus(botRun.recall_bot_id);
  } catch (e) {
    // Only a bot Recall no longer knows is given up on; outages and rate limits are retried on the next pass.
    return e.status === 404 && expired ? fail(MESSAGES.NO_OUTCOME) : 'skipped';
  }
  if (!summarizeBot(bot).terminal && expired) return fail(MESSAGES.NO_OUTCOME);
  await meetings.reconcileFromRecall(botRun.recall_bot_id, bot);
  return 'reconciled';
}

/** One pass. Dependencies are injectable for tests. Never throws. */
async function sweepStaleMeetings({ db, recall, meetings, now = Date.now() } = {}) {
  const counts = { checked: 0, failed: 0, reconciled: 0, skipped: 0 };
  try {
    const deps = {
      db: db || require('../config/supabase').supabaseAdmin,
      recall: recall || require('./recallService'),
      meetings: meetings || require('./meetingService'),
      now,
    };
    const { data, error } = await deps.db
      .from('meetings')
      .select('*, bot_runs(*)')
      .in('status', UNSETTLED)
      .lt('updated_at', new Date(now - CFG.quietMin * MIN).toISOString())
      .order('updated_at', { ascending: true })
      .limit(CFG.batch);
    if (error) throw new Error(error.message);

    for (const meeting of data || []) {
      counts.checked += 1;
      try {
        counts[await resolveMeeting(meeting, deps)] += 1;
      } catch (e) {
        logger.warn('Meeting sweep could not resolve a meeting', { meetingId: meeting.id, error: e.message });
      }
    }
    if (counts.checked) logger.info('Meeting sweep finished', counts);
  } catch (e) {
    logger.error('Meeting sweep failed', { error: e.message });
  }
  return counts;
}

let timer = null;
function startMeetingSweeper(env = process.env) {
  if (timer || env.MEETING_SWEEPER_DISABLED === '1' || !env.RECALL_API_KEY
    || env.NODE_ENV === 'test' || env.NODE_ENV === 'development') return false;
  setTimeout(() => { void sweepStaleMeetings(); }, CFG.firstPassMs).unref();
  timer = setInterval(() => { void sweepStaleMeetings(); }, CFG.intervalMs);
  timer.unref();
  logger.info('Meeting sweeper started', { intervalMin: CFG.intervalMs / MIN });
  return true;
}

module.exports = { sweepStaleMeetings, startMeetingSweeper, CFG };
