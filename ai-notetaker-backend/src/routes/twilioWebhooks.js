/**
 * Twilio webhook routes (phone-call flow).
 *
 * Ported from Meeting Mind's webhooks.ts (Twilio section). These routes
 * receive callbacks from Twilio during the call lifecycle:
 *   - verification-voice: TwiML to read the user the verification code
 *   - verification-status: status callback from Twilio (logging only)
 *   - caller-connect: user answered, bridge them to recipient w/ recording
 *   - voip-outbound: Voice SDK initiated outbound call
 *   - recipient-whisper: recording warning before recipient is bridged
 *   - call-status, dial-complete: lifecycle updates
 *   - recording-complete: post-call recording metadata + storage
 *
 * NOTE: These webhooks are public — Twilio signs them with TWILIO_AUTH_TOKEN
 * which the TwilioService.validateWebhookSignature helper checks. We accept
 * unsigned requests in development; production should add a middleware
 * that validates X-Twilio-Signature against the request URL.
 */

const express = require('express');
const router = express.Router();
const { twiml: TwiML } = require('twilio');
const { supabaseAdmin } = require('../config/supabase');
const { TwilioService } = require('../services/twilioService');

// ───────────────────────────────────────────────────────────────────────────
// Verification
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /v1/webhooks/twilio/verification-voice
 * Returns TwiML that reads the 6-digit verification code to the user.
 */
router.post('/verification-voice', (req, res) => {
  const code = req.query.code;
  if (!code || code.length !== 6) {
    console.error('[Twilio Webhook] Invalid verification code in query params');
    return res.status(400).send('Invalid code');
  }
  res.type('text/xml').send(TwilioService.buildVerificationTwiml(code));
});

/**
 * POST /v1/webhooks/twilio/verification-status
 * Twilio call status callback for the verification call. Logging only —
 * the actual verification happens when the user enters the code in-app.
 */
router.post('/verification-status', (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body || {};
  const phone = req.query.phone;
  console.log(
    `[Twilio Webhook] verification-status: ${CallSid}, status: ${CallStatus}, phone: ${phone}, duration: ${CallDuration}s`
  );
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────────────
// Call lifecycle (server-initiated outbound)
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /v1/webhooks/twilio/caller-connect
 * Called when the USER answers their phone (for a server-initiated call).
 * Bridges them to the recipient with recording enabled.
 */
router.post('/caller-connect', async (req, res) => {
  const { CallSid, CallStatus } = req.body || {};
  const callId = req.query.call_id;
  const toNumber = req.query.to;
  console.log(
    `[Twilio Webhook] caller-connect: ${CallSid}, status: ${CallStatus}, call_id: ${callId}, to: ${toNumber}`
  );

  const errorTwiml = () => {
    const response = new TwiML.VoiceResponse();
    response.say('Sorry, there was an error with your call.');
    return response.toString();
  };

  if (!callId || !toNumber) {
    console.error('[Twilio Webhook] caller-connect missing call_id or to');
    return res.type('text/xml').send(errorTwiml());
  }

  try {
    await supabaseAdmin
      .from('phone_calls')
      .update({
        twilio_call_sid: CallSid,
        status: 'in_progress',
        answered_at: new Date().toISOString(),
      })
      .eq('id', callId);

    const xml = TwilioService.buildCallerConnectTwiml(toNumber, callId);
    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('[Twilio Webhook] caller-connect error:', err);
    res.type('text/xml').send(errorTwiml());
  }
});

/**
 * POST /v1/webhooks/twilio/voip-outbound
 * TwiML App webhook — called when a VoIP client (Voice SDK) initiates an
 * outbound call. Bridges the VoIP caller to the recipient via a conference
 * with recording enabled.
 */
router.post('/voip-outbound', async (req, res) => {
  const { From, To, CallSid, call_id: bodyCallId, to: bodyTo } = req.body || {};
  const queryCallId = req.query.call_id;
  const queryTo = req.query.to;

  const targetCallId = bodyCallId || queryCallId;
  const targetNumber = bodyTo || queryTo || To;

  console.log(
    `[Twilio Webhook] voip-outbound: from=${From}, to=${targetNumber}, call_id=${targetCallId}`
  );

  const errorTwiml = (msg = 'Sorry, there was an error placing your call.') => {
    const response = new TwiML.VoiceResponse();
    response.say(msg);
    return response.toString();
  };

  if (!targetCallId) {
    console.error('[Twilio Webhook] voip-outbound missing call_id');
    return res.type('text/xml').send(errorTwiml());
  }

  try {
    const { data: phoneCall } = await supabaseAdmin
      .from('phone_calls')
      .select('conference_name, to_number, from_number')
      .eq('id', targetCallId)
      .single();

    if (!phoneCall) {
      console.error('[Twilio Webhook] voip-outbound: phone_call not found:', targetCallId);
      return res.type('text/xml').send(errorTwiml('Sorry, call record not found.'));
    }

    const conferenceName = phoneCall.conference_name;
    const recipientNumber =
      phoneCall.to_number || TwilioService.formatPhoneNumber(targetNumber);
    const callerIdNumber = phoneCall.from_number;

    await supabaseAdmin
      .from('phone_calls')
      .update({ twilio_call_sid: CallSid, status: 'ringing' })
      .eq('id', targetCallId);

    const xml = TwilioService.buildVoipOutboundTwiml(
      recipientNumber,
      targetCallId,
      conferenceName,
      callerIdNumber
    );
    res.type('text/xml').send(xml);
  } catch (err) {
    console.error('[Twilio Webhook] voip-outbound error:', err);
    res.type('text/xml').send(errorTwiml());
  }
});

/**
 * POST /v1/webhooks/twilio/recipient-whisper
 * Plays the "this call is being recorded" warning to the recipient before
 * they are bridged into the conversation.
 */
router.post('/recipient-whisper', async (req, res) => {
  const { CallSid } = req.body || {};
  const callId = req.query.call_id;
  console.log(`[Twilio Webhook] recipient-whisper: ${CallSid}, call_id: ${callId}`);

  try {
    if (callId) {
      await supabaseAdmin
        .from('phone_calls')
        .update({
          status: 'recording',
          answered_at: new Date().toISOString(),
          recording_started_at: new Date().toISOString(),
        })
        .eq('id', callId);
    }

    const response = new TwiML.VoiceResponse();
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'This call is being recorded. Please be advised that this conversation may be monitored.'
    );
    response.pause({ length: 1 });
    res.type('text/xml').send(response.toString());
  } catch (err) {
    console.error('[Twilio Webhook] recipient-whisper error:', err);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

/**
 * POST /v1/webhooks/twilio/call-status
 * Twilio call lifecycle status callback. Updates phone_calls.status,
 * answered_at, ended_at, recording_duration.
 */
router.post('/call-status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body || {};
  const callId = req.query.call_id;
  console.log(`[Twilio Webhook] call-status: ${CallSid}, status: ${CallStatus}, call_id: ${callId}`);
  if (!callId) return res.json({ ok: true });

  try {
    let status;
    switch (CallStatus) {
      case 'queued':
      case 'ringing':
        status = 'ringing';
        break;
      case 'in-progress':
        status = 'in_progress';
        break;
      case 'completed':
        status = 'completed';
        break;
      case 'busy':
        status = 'busy';
        break;
      case 'no-answer':
        status = 'no_answer';
        break;
      case 'canceled':
        status = 'cancelled';
        break;
      case 'failed':
        status = 'failed';
        break;
      default:
        status = CallStatus;
    }

    const updates = { status };
    if (CallStatus === 'in-progress') {
      updates.answered_at = new Date().toISOString();
    }
    if (['completed', 'failed', 'busy', 'no-answer'].includes(CallStatus)) {
      updates.ended_at = new Date().toISOString();
      if (CallDuration) updates.recording_duration = parseInt(CallDuration, 10);
    }

    await supabaseAdmin.from('phone_calls').update(updates).eq('id', callId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Twilio Webhook] call-status error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /v1/webhooks/twilio/dial-complete
 * Called when the dialed leg ends. Closes out the phone_calls row.
 */
router.post('/dial-complete', async (req, res) => {
  const { CallSid, DialCallStatus, DialCallDuration } = req.body || {};
  const callId = req.query.call_id;
  console.log(
    `[Twilio Webhook] dial-complete: ${CallSid}, dial_status: ${DialCallStatus}, call_id: ${callId}`
  );

  if (callId) {
    try {
      let status;
      switch (DialCallStatus) {
        case 'completed':
          status = 'completed';
          break;
        case 'busy':
          status = 'busy';
          break;
        case 'no-answer':
          status = 'no_answer';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'canceled':
          status = 'cancelled';
          break;
        default:
          status = 'completed';
      }
      await supabaseAdmin
        .from('phone_calls')
        .update({
          status,
          ended_at: new Date().toISOString(),
          recording_duration: DialCallDuration ? parseInt(DialCallDuration, 10) : null,
        })
        .eq('id', callId);
    } catch (err) {
      console.error('[Twilio Webhook] dial-complete error:', err);
    }
  }

  // Return empty TwiML so Twilio hangs up the parent call.
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

/**
 * POST /v1/webhooks/twilio/recording-complete
 * Final webhook of the call lifecycle. Twilio has finished recording and
 * is handing us the recording metadata.
 *
 * For this initial port we save the recording URL + duration to
 * `phone_calls`. We do NOT yet download to Supabase storage and feed
 * through the recording/transcription pipeline — that requires the
 * processingService integration which is out of scope for the MVP port.
 * The recording remains downloadable from Twilio via the saved URL.
 */
router.post('/recording-complete', async (req, res) => {
  const {
    RecordingSid,
    RecordingUrl,
    RecordingStatus,
    RecordingDuration,
    ConferenceSid,
  } = req.body || {};
  const callId = req.query.call_id;

  console.log(
    `[Twilio Webhook] recording-complete: ${RecordingSid}, conference: ${ConferenceSid}, call_id: ${callId}, status: ${RecordingStatus}`
  );

  if (RecordingStatus !== 'completed') {
    return res.json({ ok: true });
  }

  try {
    let call = null;
    if (callId) {
      const { data } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('id', callId)
        .single();
      call = data;
    }
    if (!call && ConferenceSid) {
      const { data } = await supabaseAdmin
        .from('phone_calls')
        .select('*')
        .eq('conference_sid', ConferenceSid)
        .single();
      call = data;
    }
    if (!call) {
      console.error(`[Twilio Webhook] phone_call not found for ${RecordingSid}`);
      return res.json({ ok: true, ignored: true });
    }

    await supabaseAdmin
      .from('phone_calls')
      .update({
        recording_sid: RecordingSid,
        recording_url: RecordingUrl,
        recording_duration: RecordingDuration ? parseInt(RecordingDuration, 10) : null,
        is_recording: false,
      })
      .eq('id', call.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Twilio Webhook] recording-complete error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
