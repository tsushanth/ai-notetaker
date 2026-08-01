/**
 * Twilio Service
 * Handles phone verification, outbound calls, and conference-based recording.
 *
 * Direct port of Meeting Mind's TypeScript twilioService.ts. ScribeAI's
 * backend is plain CommonJS JS, so type annotations are stripped and the
 * config object is replaced with process.env lookups. Logic is unchanged.
 */

const Twilio = require('twilio');
const { twiml: TwiML } = require('twilio');

const env = (name) => process.env[name];

class TwilioService {
  static #client = null;

  /**
   * Get the Twilio client (singleton)
   */
  static getClient() {
    if (!this.#client) {
      const accountSid = env('TWILIO_ACCOUNT_SID');
      const authToken = env('TWILIO_AUTH_TOKEN');

      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured');
      }

      this.#client = new Twilio.Twilio(accountSid, authToken);
    }
    return this.#client;
  }

  /**
   * Check if Twilio is configured
   */
  static isConfigured() {
    return !!(
      env('TWILIO_ACCOUNT_SID') &&
      env('TWILIO_AUTH_TOKEN') &&
      env('TWILIO_PHONE_NUMBER')
    );
  }

  /**
   * Check if Twilio VoIP is properly configured
   */
  static isVoipConfigured() {
    return !!(
      this.isConfigured() &&
      env('TWILIO_API_KEY_SID') &&
      env('TWILIO_API_KEY_SECRET') &&
      env('TWILIO_TWIML_APP_SID')
    );
  }

  /**
   * Send verification code via phone call
   */
  static async sendVerificationCall(phoneNumber, code) {
    const client = this.getClient();
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');

    if (!webhookBaseUrl) {
      throw new Error('BACKEND_URL/SERVICE_URL not configured');
    }

    const call = await client.calls.create({
      to: phoneNumber,
      from: env('TWILIO_PHONE_NUMBER'),
      url: `${webhookBaseUrl}/v1/webhooks/twilio/verification-voice?code=${code}`,
      statusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/verification-status?phone=${encodeURIComponent(phoneNumber)}`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
      statusCallbackMethod: 'POST',
      timeout: 30,
    });

    return call.sid;
  }

  /**
   * Build TwiML for verification call - reads the code to the user
   */
  static buildVerificationTwiml(code) {
    const response = new TwiML.VoiceResponse();
    const digits = code.split('').join('. ');

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Hello! This is ScribeAI calling with your verification code.'
    );
    response.pause({ length: 1 });
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Your verification code is: ${digits}.`
    );
    response.pause({ length: 1 });
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `I repeat, your code is: ${digits}.`
    );
    response.pause({ length: 1 });
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Enter this code in the app to verify your phone number. Goodbye!'
    );

    return response.toString();
  }

  /**
   * Generate a 6-digit verification code
   */
  static generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Initiate an outbound call (server-initiated, for clients without VoIP SDK)
   */
  static async initiateCall(params) {
    const client = this.getClient();
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');

    if (!webhookBaseUrl) {
      throw new Error('BACKEND_URL/SERVICE_URL not configured');
    }

    const call = await client.calls.create({
      to: params.from,
      from: env('TWILIO_PHONE_NUMBER'),
      url: `${webhookBaseUrl}/v1/webhooks/twilio/caller-connect?call_id=${params.callId}&to=${encodeURIComponent(params.to)}`,
      statusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/call-status?call_id=${params.callId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: 30,
    });

    return call.sid;
  }

  /**
   * Build TwiML for when the caller answers the callback
   */
  static buildCallerConnectTwiml(toNumber, callId) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when the other party answers.'
    );

    const dial = response.dial({
      callerId: env('TWILIO_PHONE_NUMBER'),
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
      timeout: 30,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
      recordingStatusCallbackEvent: ['completed'],
    });

    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Generate an access token for Twilio Voice SDK (VoIP)
   */
  static generateVoiceAccessToken(identity) {
    const AccessToken = Twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accessToken = new AccessToken(
      env('TWILIO_ACCOUNT_SID'),
      env('TWILIO_API_KEY_SID'),
      env('TWILIO_API_KEY_SECRET'),
      { identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: env('TWILIO_TWIML_APP_SID'),
      incomingAllow: false,
    });

    accessToken.addGrant(voiceGrant);
    return accessToken.toJwt();
  }

  /**
   * Start recording by creating a conference and adding both parties
   */
  static async startRecording(callSid, callId) {
    const client = this.getClient();
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');

    if (!webhookBaseUrl) {
      throw new Error('BACKEND_URL/SERVICE_URL not configured');
    }

    const conferenceName = `phone-call-${callId}`;
    await client.calls(callSid).update({
      twiml: this.buildConferenceTwiml(conferenceName, true),
    });

    return { conferenceName };
  }

  /**
   * Stop recording by ending the conference recording
   */
  static async stopRecording(conferenceSid) {
    const client = this.getClient();
    const recordings = await client.conferences(conferenceSid).recordings.list();

    for (const recording of recordings) {
      if (recording.status === 'in-progress') {
        await client
          .conferences(conferenceSid)
          .recordings(recording.sid)
          .update({ status: 'stopped' });
      }
    }
  }

  /**
   * End a call
   */
  static async endCall(callSid) {
    const client = this.getClient();
    try {
      await client.calls(callSid).update({ status: 'completed' });
    } catch (error) {
      if (!error.message?.includes('not found')) {
        throw error;
      }
    }
  }

  /**
   * Get call details
   */
  static async getCall(callSid) {
    const client = this.getClient();
    const call = await client.calls(callSid).fetch();
    return {
      callSid: call.sid,
      status: call.status,
      duration: call.duration ? parseInt(call.duration) : undefined,
    };
  }

  /**
   * Download recording from Twilio
   */
  static async downloadRecording(recordingSid) {
    const client = this.getClient();
    const recording = await client.recordings(recordingSid).fetch();
    const mediaUrl = `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`;

    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${env('TWILIO_ACCOUNT_SID')}:${env('TWILIO_AUTH_TOKEN')}`
        ).toString('base64')}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download recording: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    return { buffer, contentType };
  }

  /**
   * Delete recording from Twilio (after we've stored it)
   */
  static async deleteRecording(recordingSid) {
    const client = this.getClient();
    await client.recordings(recordingSid).remove();
  }

  /**
   * @deprecated Use buildAutoRecordDialTwiml
   */
  static buildDialTwiml(toNumber, callId) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();
    response.say('Connecting your call.');
    const dial = response.dial({
      callerId: env('TWILIO_PHONE_NUMBER'),
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
    });
    dial.number(toNumber);
    return response.toString();
  }

  /**
   * Build TwiML for auto-recording calls
   */
  static buildAutoRecordDialTwiml(toNumber, callId) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when connected.'
    );

    const dial = response.dial({
      callerId: env('TWILIO_PHONE_NUMBER'),
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
    });

    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Build TwiML for VoIP outbound calls
   */
  static buildVoipOutboundTwiml(toNumber, callId, conferenceName, callerIdNumber) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when connected.'
    );

    const callerId = callerIdNumber || env('TWILIO_PHONE_NUMBER');

    const dial = response.dial({
      callerId: callerId,
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
      timeout: 30,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
      recordingStatusCallbackEvent: ['completed'],
    });

    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Build TwiML for recipient joining conference with recording warning
   */
  static buildRecipientJoinConferenceTwiml(conferenceName, callId) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'This call is being recorded. Please be advised that this conversation may be monitored.'
    );
    response.pause({ length: 1 });

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        record: 'record-from-start',
        recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
        recordingStatusCallbackEvent: ['completed'],
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML for caller to join conference (after recipient whisper)
   */
  static buildCallerConferenceTwiml(callId) {
    const response = new TwiML.VoiceResponse();
    const conferenceName = `phone-call-${callId}`;

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: false,
        endConferenceOnExit: true,
        beep: 'false',
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML to join a conference
   */
  static buildConferenceTwiml(conferenceName, record = false) {
    const webhookBaseUrl = env('BACKEND_URL') || env('SERVICE_URL');
    const response = new TwiML.VoiceResponse();

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        record: record ? 'record-from-start' : 'do-not-record',
        recordingStatusCallback: record
          ? `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete`
          : undefined,
        recordingStatusCallbackEvent: ['completed'],
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML for the recording bot (silent participant)
   */
  static buildRecordingBotTwiml(conferenceName) {
    const response = new TwiML.VoiceResponse();

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: false,
        endConferenceOnExit: false,
        muted: true,
        beep: 'false',
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Validate Twilio webhook signature
   */
  static validateWebhookSignature(signature, url, params) {
    const authToken = env('TWILIO_AUTH_TOKEN');
    if (!authToken) return false;
    return Twilio.validateRequest(authToken, signature, url, params);
  }

  /**
   * Format phone number to E.164 format
   */
  static formatPhoneNumber(phone) {
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+')) {
      if (cleaned.length === 10) {
        cleaned = '+1' + cleaned;
      } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+' + cleaned;
      }
    }
    return cleaned;
  }

  /**
   * Validate phone number format
   */
  static isValidPhoneNumber(phone) {
    const formatted = this.formatPhoneNumber(phone);
    return /^\+[1-9]\d{1,14}$/.test(formatted);
  }
}

module.exports = { TwilioService };
