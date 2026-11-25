const test = require('node:test');
const assert = require('node:assert/strict');
const { db, notes, storage, meetings, settle, seed, recallReturns, change, bot, T } = require('./helpers/meetingFakes');
const { extractStatus, isOutOfOrder, summarizeBot, describeFailure, MESSAGES } = require('../src/utils/recallStatus');

const meeting = () => db.meetings[0];
const run = () => db.bot_runs[0];
/** Documented webhook shape. */
const event = (code, minute, subCode = null) => ({
  event: `bot.${code}`,
  data: { data: { code, sub_code: subCode, updated_at: T(minute) }, bot: { id: 'bot-1', metadata: {} } },
});
const LINES = [{ participant: { name: 'Ada' }, words: [{ text: 'We' }, { text: 'agreed' }, { text: 'to' }, { text: 'ship' }, { text: 'the' }, { text: 'release' }, { text: 'on' }, { text: 'Friday' }, { text: 'after' }, { text: 'testing' }] }];

test('extractStatus reads the documented nested shape and a flat one', () => {
  const nested = extractStatus(event('fatal', 1, 'meeting_password_incorrect'));
  assert.deepEqual(nested, { botId: 'bot-1', code: 'fatal', subCode: 'meeting_password_incorrect', at: T(1) });
  const flat = extractStatus({ event: 'bot.fatal', data: { code: 'fatal', sub_code: 'meeting_not_found', created_at: T(2), bot_id: 'bot-1' } });
  assert.deepEqual(flat, { botId: 'bot-1', code: 'fatal', subCode: 'meeting_not_found', at: T(2) });
  assert.equal(extractStatus({ event: 'bot.done', data: { bot: { id: 'b' } } }).code, 'done');
  assert.equal(extractStatus({}).subCode, null);
});

test('describeFailure: plain words for passcode, not found and never admitted; unknown codes get the fallback', () => {
  assert.match(describeFailure('meeting_password_incorrect'), /passcode was missing or wrong.*full invite link/i);
  assert.match(describeFailure('meeting_not_found'), /could not be found/i);
  assert.match(describeFailure('timeout_exceeded_waiting_room'), /never let in from the waiting room/i);
  assert.match(describeFailure('bot_kicked_from_waiting_room'), /removed the bot from the waiting room/i);
  assert.equal(describeFailure('something_new', 'fallback'), 'fallback');
  assert.match(describeFailure(null), /could not join/i);
});

test('summarizeBot: never admitted, fatal, and recorded bots', () => {
  const never = summarizeBot(bot([change('joining_call', 0), change('in_waiting_room', 0), change('call_ended', 10, 'timeout_exceeded_waiting_room'), change('done', 10)]));
  assert.deepEqual([never.terminal, never.recorded, never.subCode, never.change.code], ['done', false, 'timeout_exceeded_waiting_room', 'done']);
  const fatal = summarizeBot(bot([change('joining_call', 0), change('fatal', 0, 'meeting_password_incorrect')]));
  assert.deepEqual([fatal.terminal, fatal.subCode, fatal.change.code], ['fatal', 'meeting_password_incorrect', 'fatal']);
  const ok = summarizeBot(bot([change('in_call_recording', 1), change('call_ended', 5, 'call_ended_by_host'), change('recording_done', 5)]));
  assert.deepEqual([ok.terminal, ok.recorded, ok.change.code], [null, true, 'call_ended']);
  assert.equal(summarizeBot(bot([change('done', 1)], [{ status: { code: 'failed' } }])).recorded, false);
  const denied = summarizeBot(bot([change('recording_permission_denied', 1, 'zoom_local_recording_request_denied_by_host'), change('call_ended', 2, 'timeout_exceeded_recording_permission_denied')]));
  assert.equal(denied.subCode, 'zoom_local_recording_request_denied_by_host');
});

test('isOutOfOrder: finished bots stay finished; timestamps decide; without them only forward', () => {
  assert.equal(isOutOfOrder({ status: 'failed' }, 'joining', T(9)), true);
  assert.equal(isOutOfOrder({ status: 'done' }, 'recording', T(9)), true);
  assert.equal(isOutOfOrder({ status: 'failed' }, 'done', T(9)), true);
  assert.equal(isOutOfOrder({ status: 'recording', at: T(5) }, 'joining', T(4)), true);
  assert.equal(isOutOfOrder({ status: 'recording', at: T(5) }, 'in_call', T(6)), false); // recording paused
  assert.equal(isOutOfOrder({ status: 'recording' }, 'in_call'), true);
  assert.equal(isOutOfOrder({ status: 'joining' }, 'failed', T(1)), false);
});

for (const [shape, payload] of [
  ['documented', event('fatal', 1, 'meeting_password_incorrect')],
  ['flat', { event: 'bot.fatal', data: { bot: { id: 'bot-1' }, code: 'fatal', sub_code: 'meeting_password_incorrect' } }],
]) {
  test(`fatal (${shape} shape) saves the sub-code and a readable reason`, async () => {
    seed(); recallReturns();
    await meetings.handleBotStatusWebhook(payload);
    assert.equal(run().status, 'failed');
    assert.equal(run().error_code, 'meeting_password_incorrect');
    assert.equal(meeting().status, 'failed');
    assert.match(meeting().error_message, /full invite link/);
  });
}

test('a late joining_call after fatal changes nothing', async () => {
  seed(); recallReturns();
  await meetings.handleBotStatusWebhook(event('fatal', 1, 'meeting_not_found'));
  await meetings.handleBotStatusWebhook(event('joining_call', 0));
  assert.equal(run().status, 'failed');
  assert.equal(meeting().status, 'failed');
});

test('an older event does not move a recording bot back', async () => {
  seed(); recallReturns();
  await meetings.handleBotStatusWebhook(event('in_call_recording', 3));
  await meetings.handleBotStatusWebhook(event('in_waiting_room', 2));
  assert.equal(run().status, 'recording');
  assert.equal(meeting().status, 'recording');
  assert.equal(run().join_time, T(3));
});

test('cancelled and transcribing meetings are not overwritten by events', async () => {
  for (const status of ['cancelled', 'transcribing', 'completed']) {
    seed({ meeting: { status } }); recallReturns();
    await meetings.handleBotStatusWebhook(event('call_ended', 5, 'bot_received_leave_call'));
    await meetings.handleBotStatusWebhook(event('done', 6));
    await settle();
    assert.equal(meeting().status, status);
  }
});

test('artifact events other than recording.done do not touch statuses', async () => {
  seed({ meeting: { status: 'recording' }, run: { status: 'recording' } }); recallReturns();
  await meetings.handleBotStatusWebhook({ event: 'transcript.processing', data: { data: { code: 'processing', updated_at: T(9) }, bot: { id: 'bot-1' } } });
  assert.equal(run().status, 'recording');
  assert.deepEqual(run().recall_status, {});
});

test('reconcileFromRecall applies the fatal change even when it is not the last entry', async () => {
  seed(); recallReturns();
  await meetings.reconcileFromRecall('bot-1', bot([change('joining_call', 0), change('fatal', 1, 'meeting_not_found'), change('recording_done', 2)]));
  assert.equal(meeting().status, 'failed');
  assert.match(meeting().error_message, /could not be found/);
});

test('never admitted: ends failed with the waiting room reason, without fetching files', async () => {
  seed();
  const calls = recallReturns({ status: bot([change('joining_call', 0), change('in_waiting_room', 0), change('call_ended', 10, 'timeout_exceeded_waiting_room'), change('done', 10)]) });
  await meetings.handleBotStatusWebhook(event('done', 10));
  await settle();
  assert.equal(meeting().status, 'failed');
  assert.match(meeting().error_message, /never let in/);
  assert.equal(run().error_code, 'timeout_exceeded_waiting_room');
  assert.equal(calls.transcript, 0);
  assert.equal(notes.length, 0);
});

const recordedBot = bot([change('in_call_recording', 1), change('call_ended', 5, 'call_ended_by_host'), change('done', 6)], [{ status: { code: 'done' } }]);

test('recorded, but no recording or transcript can be fetched: failed', async () => {
  seed({ meeting: { status: 'processing' }, run: { status: 'done' } });
  recallReturns({ status: recordedBot });
  await meetings.processRecordingAsync('r1', 'bot-1');
  assert.equal(meeting().status, 'failed');
  assert.equal(meeting().error_message, MESSAGES.NOTHING_RETRIEVED);
});

test('upload failure with an empty transcript: failed, and no recording path is stored', async () => {
  seed({ meeting: { status: 'processing' }, run: { status: 'done' } });
  recallReturns({ status: recordedBot, transcript: [], recording: { download_url: 'https://example.test/r.mp4', duration_seconds: 240 } });
  storage.uploadError = { message: 'too large' };
  await meetings.processRecordingAsync('r1', 'bot-1');
  assert.equal(meeting().status, 'failed');
  assert.equal(run().recording_path, null);
});

test('transcript and recording: completed with a note', async () => {
  seed({ meeting: { status: 'processing' }, run: { status: 'done' } });
  recallReturns({ status: recordedBot, transcript: LINES, recording: { download_url: 'https://example.test/r.mp4', duration_seconds: 240 } });
  await meetings.processRecordingAsync('r1', 'bot-1');
  assert.equal(meeting().status, 'completed');
  assert.equal(meeting().note_id, 'note-1');
  assert.equal(db.meeting_recordings.length, 1);
});

test('a silent meeting with a stored recording still completes', async () => {
  seed({ meeting: { status: 'processing' }, run: { status: 'done' } });
  recallReturns({ status: recordedBot, transcript: [], recording: { download_url: 'https://example.test/r.mp4', duration_seconds: 240 } });
  await meetings.processRecordingAsync('r1', 'bot-1');
  assert.equal(meeting().status, 'completed');
});

test('Recall unreadable and nothing fetched: the meeting goes back to processing to be retried', async () => {
  seed({ meeting: { status: 'processing' }, run: { status: 'done' } });
  recallReturns();
  await meetings.processRecordingAsync('r1', 'bot-1');
  assert.equal(meeting().status, 'processing');
});

test('createMeeting refuses zoomgov links with its own message', async () => {
  await assert.rejects(meetings.createMeeting('u1', 'https://agency.zoomgov.com/j/1234567890'), (e) => e.statusCode === 400 && /Zoom for Government/.test(e.message));
});
