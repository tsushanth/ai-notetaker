/**
 * Pure helpers for Recall.ai bot status: reading webhook payloads, ordering status events, summarising a bot and
 * explaining in plain words why a meeting has no recording.
 *
 * Webhook shape (https://docs.recall.ai/docs/bot-status-change-events):
 *   { event: 'bot.fatal', data: { data: { code, sub_code, updated_at }, bot: { id, metadata } } }
 * A flat `data: { code, sub_code }` is accepted too. Sub-codes (https://docs.recall.ai/docs/sub-codes) are an open
 * list, so unknown ones fall back to a general sentence.
 */

// Recall status code -> bot_runs.status. Codes not listed here do not change any status.
const BOT_STATUS = {
  joining_call: 'joining',
  in_waiting_room: 'joining',
  in_call_not_recording: 'in_call',
  in_call_recording: 'recording',
  call_ended: 'done',
  done: 'done',
  fatal: 'failed',
  analysis_done: 'done',
};

const RANK = { pending: 0, joining: 1, in_call: 2, recording: 3, leaving: 4, done: 5, failed: 5 };
const TERMINAL_BOT_STATUSES = ['done', 'failed'];

function extractStatus(payload = {}) {
  const data = payload.data || {};
  const inner = data.data || data.status || {};
  return {
    botId: data.bot?.id || data.bot_id || payload.bot_id,
    code: inner.code || data.code || (typeof payload.status === 'string' ? payload.status : undefined) || payload.event?.replace('bot.', ''),
    subCode: inner.sub_code || data.sub_code || payload.sub_code || null,
    at: inner.updated_at || inner.created_at || data.updated_at || data.created_at || null,
  };
}

/**
 * True when an incoming status must not overwrite the stored one. A finished bot never becomes active again and a failed
 * bot never becomes done. Otherwise Recall's own timestamps decide (a bot may legitimately step back, e.g. recording
 * paused); without timestamps a status may only move forward.
 */
function isOutOfOrder(current, incomingStatus, incomingAt) {
  if (TERMINAL_BOT_STATUSES.includes(current.status) && !TERMINAL_BOT_STATUSES.includes(incomingStatus)) return true;
  if (current.status === 'failed' && incomingStatus === 'done') return true;
  const stored = Date.parse(current.at);
  const incoming = Date.parse(incomingAt);
  if (Number.isFinite(stored) && Number.isFinite(incoming)) return incoming < stored;
  return (RANK[incomingStatus] ?? 0) < (RANK[current.status] ?? 0);
}

/**
 * Summary of a `GET /bot/{id}` response.
 * - terminal: 'fatal' | 'done' | null
 * - recorded: the bot started recording, or Recall holds a recording that did not fail
 * - subCode:  the most telling reason (fatal, then recording permission denied, then call ended)
 * - change:   the status change to reconcile with (a terminal one if present, else the latest one we understand)
 */
function summarizeBot(bot) {
  const changes = bot?.status_changes || [];
  const reversed = [...changes].reverse();
  const find = (code) => reversed.find((c) => c.code === code);
  const fatal = find('fatal');
  const done = find('done');
  const reason = [fatal, find('recording_permission_denied'), find('call_ended')].find((c) => c?.sub_code);
  return {
    terminal: fatal ? 'fatal' : done ? 'done' : null,
    recorded: changes.some((c) => c.code === 'in_call_recording')
      || (bot?.recordings || []).some((r) => r?.status?.code !== 'failed'),
    subCode: reason?.sub_code || null,
    change: fatal || done || reversed.find((c) => BOT_STATUS[c.code]) || null,
  };
}

const MESSAGES = {
  NEVER_RECORDED: 'The meeting ended before the bot recorded anything.',
  NOTHING_RETRIEVED: 'No recording or transcript could be retrieved for this meeting.',
  PROCESSING_FAILED: 'We could not process this recording. Please contact support if you need it.',
  INTERRUPTED: 'Processing was interrupted before it finished. Please contact support if you need this recording.',
  NOT_SENT: 'The bot was never sent to this meeting. Please try again.',
  NO_OUTCOME: 'The bot did not report what happened in this meeting. Please try again.',
};

const REASONS = [
  [['meeting_password_incorrect', 'webex_password_required', 'webex_pin_required'],
    'The meeting passcode was missing or wrong. Paste the full invite link, including the passcode part (?pwd=...), and send the bot again.'],
  [['meeting_not_found', 'meeting_link_invalid'],
    'The meeting could not be found. Paste the full invite link and check that the meeting has not been deleted.'],
  [['meeting_link_expired'], 'This meeting link has expired. Send the bot again with a current invite link.'],
  [['meeting_not_started'], 'The meeting had not started. Send the bot again once the host has started it.'],
  [['meeting_ended'], 'The meeting had already ended when the bot tried to join.'],
  [['timeout_exceeded_waiting_room', 'call_ended_by_platform_waiting_room_timeout', 'zoom_bot_in_waiting_room'],
    'The bot was never let in from the waiting room. Ask the host to admit "ScribeAI Notetaker", then send the bot again.'],
  [['bot_kicked_from_waiting_room'], 'The host removed the bot from the waiting room, so it never joined.'],
  [['timeout_exceeded_noone_joined'], 'Nobody joined the meeting, so there was nothing to record.'],
  [['timeout_exceeded_recording_permission_denied', 'zoom_local_recording_disabled', 'zoom_local_recording_request_disabled',
    'zoom_local_recording_request_disabled_by_host', 'zoom_local_recording_request_denied_by_host', 'zoom_local_recording_denied',
    'zoom_local_recording_grant_not_supported', 'zoom_host_not_present'],
    'The bot joined but was not allowed to record. Ask the host to allow recording for "ScribeAI Notetaker".'],
  [['meeting_requires_registration', 'zoom_registration_required'],
    'This meeting requires registration. Use the personal join link you receive after registering.'],
  [['meeting_requires_sign_in', 'meeting_not_accessible', 'zoom_anonymous_join_not_allowed', 'zoom_authorized_participants_only',
    'zoom_sso_login_required', 'zoom_email_required', 'google_meet_knocking_disabled', 'google_meet_organisation_restricted'],
    'This meeting only allows signed-in or approved participants, so the bot could not join.'],
  [['zoom_obf_or_zak_missing_or_invalid', 'zoom_obf_user_not_in_meeting', 'zoom_sdk_app_not_published', 'zoom_sdk_credentials_missing',
    'zoom_sdk_key_blocked_by_host_admin', 'zoom_invalid_join_token', 'zoom_token_expired', 'zoom_invalid_signature'],
    'Zoom did not authorize the bot to join this meeting. Please contact support.'],
  [['meeting_locked'], 'The meeting was locked, so the bot could not join.'],
  [['meeting_full'], 'The meeting was full, so the bot could not join.'],
  [['zoom_government_not_supported'], 'Zoom for Government meetings are not supported.'],
  [['bot_kicked_from_call'], 'The host removed the bot from the meeting before it recorded anything.'],
  [['call_ended_by_host'], 'The host ended the meeting before the bot could record.'],
  [['failed_to_launch_in_time', 'bot_errored'], 'The bot could not start. Please send it again.'],
];

const BY_SUB_CODE = new Map(REASONS.flatMap(([codes, text]) => codes.map((c) => [c, text])));

/** Plain-language reason for a sub-code. `fallback` is used when there is no sub-code or we do not know it. */
function describeFailure(subCode, fallback = 'The bot could not join the meeting. Check the link and send it again.') {
  return BY_SUB_CODE.get(subCode) || fallback;
}

module.exports = {
  BOT_STATUS, TERMINAL_BOT_STATUSES, MESSAGES,
  extractStatus, isOutOfOrder, summarizeBot, describeFailure,
};
