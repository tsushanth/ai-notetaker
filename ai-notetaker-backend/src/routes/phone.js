/**
 * Phone Routes
 * Handles phone verification and call management.
 *
 * Ported from Meeting Mind's phone.ts. TypeScript + zod schemas replaced
 * with plain JS + manual validation to match ScribeAI's existing route
 * conventions (AppError + asyncHandler + req.userId).
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { supabaseAdmin } = require('../config/supabase');
const { TwilioService } = require('../services/twilioService');

// All routes require authentication
router.use(authenticate);

// ───────────────────────────────────────────────────────────────────────────
// Validation helpers (replacing zod schemas to keep dep surface small)
// ───────────────────────────────────────────────────────────────────────────

function requirePhoneNumberField(body) {
  const phoneNumber = body && body.phone_number;
  if (typeof phoneNumber !== 'string' || phoneNumber.length < 10 || phoneNumber.length > 20) {
    throw new AppError('Invalid phone number', 400);
  }
  return phoneNumber;
}

function requireVerifyCodeBody(body) {
  const phoneNumber = requirePhoneNumberField(body);
  const code = body && body.code;
  if (typeof code !== 'string' || code.length !== 6) {
    throw new AppError('Invalid verification code', 400);
  }
  return { phoneNumber, code };
}

function requireInitiateCallBody(body) {
  const from = body && body.from;
  const to = body && body.to;
  if (typeof from !== 'string' || from.length < 10 || from.length > 20) {
    throw new AppError('Invalid "from" number', 400);
  }
  if (typeof to !== 'string' || to.length < 10 || to.length > 20) {
    throw new AppError('Invalid "to" number', 400);
  }
  const toName = body.to_name;
  if (toName != null && (typeof toName !== 'string' || toName.length > 100)) {
    throw new AppError('Invalid "to_name"', 400);
  }
  return {
    from,
    to,
    to_name: toName,
    server_initiated: body.server_initiated === true,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Phone Verification
// ───────────────────────────────────────────────────────────────────────────

/**
 * Send verification code via phone call
 * POST /api/phone/verify/send
 */
router.post(
  '/verify/send',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const raw = requirePhoneNumberField(req.body);

    if (!TwilioService.isConfigured()) {
      throw new AppError('Phone service not configured', 500);
    }

    const phoneNumber = TwilioService.formatPhoneNumber(raw);
    if (!TwilioService.isValidPhoneNumber(phoneNumber)) {
      throw new AppError('Invalid phone number format', 400);
    }

    // Rate limit: max 10 verifications per day
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count } = await supabaseAdmin
      .from('verified_phones')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today.toISOString());
    if ((count || 0) >= 10) {
      throw new AppError('Too many verification attempts today', 400);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { data: existing } = await supabaseAdmin
      .from('verified_phones')
      .select('id, verified_at')
      .eq('user_id', userId)
      .eq('phone_number', phoneNumber)
      .single();

    if (existing && existing.verified_at) {
      throw new AppError('This phone number is already verified', 400);
    }

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('verified_phones')
        .update({
          verification_code: code,
          verification_expires_at: expiresAt.toISOString(),
        })
        .eq('id', existing.id);
      if (updateError) {
        console.error('[Phone] update verification error:', updateError);
        throw new AppError('Failed to update verification record', 500);
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('verified_phones')
        .insert({
          user_id: userId,
          phone_number: phoneNumber,
          verification_code: code,
          verification_expires_at: expiresAt.toISOString(),
        });
      if (insertError) {
        console.error('[Phone] insert verification error:', insertError);
        throw new AppError('Failed to create verification record', 500);
      }
    }

    try {
      const callSid = await TwilioService.sendVerificationCall(phoneNumber, code);
      console.log(`[Phone] Verification call initiated: ${callSid} to ${phoneNumber}`);
    } catch (err) {
      console.error('[Phone] Failed to initiate verification call:', err.message);
      throw new AppError('Failed to send verification code', 500);
    }

    res.json({ message: 'Verification call initiated - answer your phone!' });
  })
);

/**
 * Check verification code
 * POST /api/phone/verify/check
 */
router.post(
  '/verify/check',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { phoneNumber: raw, code } = requireVerifyCodeBody(req.body);

    const phoneNumber = TwilioService.formatPhoneNumber(raw);

    const { data: phone } = await supabaseAdmin
      .from('verified_phones')
      .select('*')
      .eq('user_id', userId)
      .eq('phone_number', phoneNumber)
      .is('verified_at', null)
      .single();

    if (!phone) {
      throw new AppError('Verification not found. Please request a new verification call.', 404);
    }

    if (new Date(phone.verification_expires_at) < new Date()) {
      throw new AppError('Verification code expired. Please request a new call.', 400);
    }

    if (phone.verification_code !== code) {
      throw new AppError('Invalid verification code', 400);
    }

    const { data: updatedPhone, error: updateError } = await supabaseAdmin
      .from('verified_phones')
      .update({
        verified_at: new Date().toISOString(),
        verification_code: null,
        verification_expires_at: null,
      })
      .eq('id', phone.id)
      .select()
      .single();

    if (updateError || !updatedPhone) {
      console.error('[Phone] Failed to update verified phone:', updateError);
      throw new AppError('Failed to verify phone number', 500);
    }

    res.json({
      verified: true,
      phone: {
        id: updatedPhone.id,
        phone_number: updatedPhone.phone_number,
        verified_at: updatedPhone.verified_at,
        created_at: updatedPhone.created_at,
      },
    });
  })
);

/**
 * List verified phone numbers
 * GET /api/phone/verified
 */
router.get(
  '/verified',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { data: phones, error } = await supabaseAdmin
      .from('verified_phones')
      .select('id, phone_number, verified_at, created_at')
      .eq('user_id', userId)
      .not('verified_at', 'is', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ phones: phones || [] });
  })
);

/**
 * Delete verified phone number
 * DELETE /api/phone/verified/:id
 */
router.delete(
  '/verified/:id',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const phoneId = req.params.id;
    const { error } = await supabaseAdmin
      .from('verified_phones')
      .delete()
      .eq('id', phoneId)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ deleted: true });
  })
);

// ───────────────────────────────────────────────────────────────────────────
// VoIP Access Token
// ───────────────────────────────────────────────────────────────────────────

/**
 * GET /api/phone/voip/token
 */
router.get(
  '/voip/token',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!TwilioService.isVoipConfigured()) {
      throw new AppError('VoIP service not configured', 500);
    }
    const token = TwilioService.generateVoiceAccessToken(userId);
    res.json({ token });
  })
);

// ───────────────────────────────────────────────────────────────────────────
// Phone Calls
// ───────────────────────────────────────────────────────────────────────────

/**
 * Create a phone call record. The actual call is initiated by the Twilio
 * Voice SDK on the client (VoIP) OR by us via REST when server_initiated=true.
 * POST /api/phone/calls
 */
router.post(
  '/calls',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const parsed = requireInitiateCallBody(req.body);

    if (!TwilioService.isConfigured()) {
      throw new AppError('Phone service not configured', 500);
    }

    const fromNumber = TwilioService.formatPhoneNumber(parsed.from);
    const toNumber = TwilioService.formatPhoneNumber(parsed.to);

    const { data: verifiedPhone } = await supabaseAdmin
      .from('verified_phones')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_number', fromNumber)
      .not('verified_at', 'is', null)
      .single();
    if (!verifiedPhone) {
      throw new AppError('From number is not verified', 400);
    }

    const conferenceName = `phone-call-${Date.now()}`;
    const { data: phoneCall, error: insertError } = await supabaseAdmin
      .from('phone_calls')
      .insert({
        user_id: userId,
        from_number: fromNumber,
        to_number: toNumber,
        to_name: parsed.to_name,
        status: 'initiated',
        started_at: new Date().toISOString(),
        is_recording: true,
        conference_name: conferenceName,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    let twilioCallSid = null;
    if (parsed.server_initiated) {
      try {
        twilioCallSid = await TwilioService.initiateCall({
          from: fromNumber,
          to: toNumber,
          userId,
          callId: phoneCall.id,
        });
        await supabaseAdmin
          .from('phone_calls')
          .update({ twilio_call_sid: twilioCallSid, status: 'ringing' })
          .eq('id', phoneCall.id);
      } catch (err) {
        console.error('[Phone] Failed to place server-initiated call:', err.message);
        await supabaseAdmin
          .from('phone_calls')
          .update({ status: 'failed' })
          .eq('id', phoneCall.id);
        throw new AppError('Failed to place call: ' + err.message, 500);
      }
    }

    res.status(201).json({
      call_id: phoneCall.id,
      status: parsed.server_initiated ? 'ringing' : 'initiated',
      conference_name: conferenceName,
      to_number: toNumber,
      twilio_call_sid: twilioCallSid,
    });
  })
);

/**
 * GET /api/phone/calls
 */
router.get(
  '/calls',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { data: calls, error, count } = await supabaseAdmin
      .from('phone_calls')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    res.json({
      calls: calls || [],
      total: count || 0,
      limit,
      offset,
    });
  })
);

/**
 * GET /api/phone/calls/:id
 */
router.get(
  '/calls/:id',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { data: call, error } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', userId)
      .single();
    if (error || !call) throw new AppError('Call not found', 404);
    res.json({ call });
  })
);

/**
 * POST /api/phone/calls/:id/record
 */
router.post(
  '/calls/:id/record',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const callId = req.params.id;

    const { data: call } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();
    if (!call) throw new AppError('Call not found', 404);
    if (call.status !== 'in_progress') throw new AppError('Call is not in progress', 400);
    if (call.is_recording) throw new AppError('Already recording', 400);
    if (!call.twilio_call_sid) throw new AppError('Call SID not available', 400);

    try {
      const { conferenceName } = await TwilioService.startRecording(call.twilio_call_sid, callId);
      await supabaseAdmin
        .from('phone_calls')
        .update({
          is_recording: true,
          conference_name: conferenceName,
          recording_started_at: new Date().toISOString(),
          status: 'recording',
        })
        .eq('id', callId);
      res.json({ recording: true, conference_name: conferenceName });
    } catch (err) {
      console.error('[Phone] Failed to start recording:', err.message);
      throw new AppError('Failed to start recording', 500);
    }
  })
);

/**
 * DELETE /api/phone/calls/:id/record
 */
router.delete(
  '/calls/:id/record',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const callId = req.params.id;

    const { data: call } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();
    if (!call) throw new AppError('Call not found', 404);
    if (!call.is_recording) throw new AppError('Not recording', 400);

    if (call.conference_sid) {
      try {
        await TwilioService.stopRecording(call.conference_sid);
      } catch (err) {
        // Recording may already have stopped — log and continue.
        console.error('[Phone] Failed to stop recording:', err.message);
      }
    }

    await supabaseAdmin
      .from('phone_calls')
      .update({ is_recording: false, status: 'in_progress' })
      .eq('id', callId);

    res.json({ recording: false });
  })
);

/**
 * POST /api/phone/calls/:id/hangup
 */
router.post(
  '/calls/:id/hangup',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const callId = req.params.id;

    const { data: call } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();
    if (!call) throw new AppError('Call not found', 404);

    if (call.twilio_call_sid) {
      try {
        await TwilioService.endCall(call.twilio_call_sid);
      } catch (err) {
        console.error('[Phone] Failed to end call:', err.message);
      }
    }

    await supabaseAdmin
      .from('phone_calls')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', callId);

    res.json({ ended: true });
  })
);

module.exports = router;
