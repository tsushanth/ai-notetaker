const test = require('node:test');
const assert = require('node:assert/strict');
const { db, supabaseAdmin, recall, meetings, settle, seed, recallReturns, change, bot, T } = require('./helpers/meetingFakes');
const { sweepStaleMeetings, startMeetingSweeper } = require('../src/services/meetingSweeper');
const { MESSAGES } = require('../src/utils/recallStatus');

const MIN = 60 * 1000;
const NOW = Date.parse(T(0)) + 30 * MIN;
const LATER = Date.parse(T(0)) + 25 * 60 * MIN;
const sweep = (now = NOW) => sweepStaleMeetings({ db: supabaseAdmin, recall, meetings, now });
const meeting = () => db.meetings[0];
const waiting = bot([change('joining_call', 0), change('in_waiting_room', 1)]);

test('a stale bot_joining meeting whose bot failed is resolved with the reason', async () => {
  seed({ run: { recall_status: { event: 'bot.joining_call', data: { data: { code: 'joining_call', created_at: T(0) } } } } });
  recallReturns({ status: bot([change('joining_call', 0), change('fatal', 1, 'meeting_not_found')]) });
  const counts = await sweep();
  assert.equal(counts.reconciled, 1);
  assert.equal(meeting().status, 'failed');
  assert.equal(db.bot_runs[0].error_code, 'meeting_not_found');
  assert.match(meeting().error_message, /could not be found/);
});

test('a finished, never admitted bot ends failed; a second pass has nothing to do', async () => {
  seed();
  recallReturns({ status: bot([change('joining_call', 0), change('call_ended', 10, 'timeout_exceeded_waiting_room'), change('done', 10)]) });
  await sweep();
  await settle();
  assert.equal(meeting().status, 'failed');
  assert.match(meeting().error_message, /waiting room/);
  assert.equal((await sweep()).checked, 0);
});

test('quiet period: a recently updated meeting is not read', async () => {
  seed({ meeting: { updated_at: new Date(NOW - MIN).toISOString() } });
  const calls = recallReturns({ status: waiting });
  assert.equal((await sweep()).checked, 0);
  assert.equal(calls.status, 0);
});

test('a bot scheduled for later is left alone', async () => {
  seed({ meeting: { scheduled_start: new Date(NOW + 60 * MIN).toISOString() } });
  const calls = recallReturns({ status: waiting });
  assert.equal((await sweep()).skipped, 1);
  assert.equal(calls.status, 0);
});

test('a live bot is brought up to date; after a day without an outcome it is given up on', async () => {
  seed();
  recallReturns({ status: bot([change('joining_call', 0), change('in_call_recording', 2)]) });
  await sweep();
  assert.equal(meeting().status, 'recording');
  seed();
  recallReturns({ status: waiting });
  await sweep(LATER);
  assert.equal(meeting().status, 'failed');
  assert.equal(meeting().error_message, MESSAGES.NO_OUTCOME);
});

test('Recall errors are retried; only a missing bot older than a day fails', async () => {
  for (const [status, now, expected] of [[500, LATER, 'bot_joining'], [429, LATER, 'bot_joining'], [404, NOW, 'bot_joining'], [404, LATER, 'failed']]) {
    seed();
    recallReturns({ status: Object.assign(new Error('Failed to get bot status'), { status }) });
    await sweep(now);
    assert.equal(meeting().status, expected, `${status}`);
  }
});

test('a meeting with no bot fails after an hour, not before', async () => {
  seed({ noRun: true, meeting: { status: 'pending' } });
  await sweep();
  assert.equal(meeting().status, 'pending');
  await sweep(Date.parse(T(0)) + 61 * MIN);
  assert.equal(meeting().error_message, MESSAGES.NOT_SENT);
});

test('transcribing is left alone while fresh and failed when processing died', async () => {
  seed({ meeting: { status: 'transcribing' }, run: { status: 'done' } });
  recallReturns();
  await sweep();
  assert.equal(meeting().status, 'transcribing');
  await sweep(Date.parse(T(0)) + 121 * MIN);
  assert.equal(meeting().error_message, MESSAGES.INTERRUPTED);
  assert.equal(db.bot_runs[0].status, 'done');
});

test('final meetings are never read', async () => {
  for (const status of ['completed', 'failed', 'cancelled']) {
    seed({ meeting: { status } });
    recallReturns({ status: waiting });
    assert.equal((await sweep(LATER)).checked, 0);
  }
});

test('a database error does not throw', async () => {
  const broken = { from: () => { throw new Error('down'); } };
  assert.deepEqual(await sweepStaleMeetings({ db: broken, recall, meetings }), { checked: 0, failed: 0, reconciled: 0, skipped: 0 });
});

test('the timer does not start in tests, without a Recall key, or when disabled', () => {
  assert.equal(startMeetingSweeper({ NODE_ENV: 'test', RECALL_API_KEY: 'x' }), false);
  assert.equal(startMeetingSweeper({ NODE_ENV: 'production' }), false);
  assert.equal(startMeetingSweeper({ NODE_ENV: 'production', RECALL_API_KEY: 'x', MEETING_SWEEPER_DISABLED: '1' }), false);
});
