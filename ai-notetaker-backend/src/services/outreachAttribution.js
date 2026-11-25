// Outreach metrics bound to the service-role Supabase client (see ../utils/outreachEvents.js). Entry points are fire and forget.
const { supabaseAdmin } = require('../config/supabase');
const { attributionFromAppMetadata, outreachAppMetadata, reportActivationForUser, reportOutreachEvent, outreachAttribution } = require('../utils/outreachEvents');

/** app_metadata to store on a new account when the sign-up request carried an outreach first touch (else undefined). */
function signupAppMetadata(signupSource) {
  return outreachAppMetadata(signupSource) || undefined;
}

/** A new account was created. Fire and forget; never affects sign-up. */
function noteSignup(email, signupSource) {
  try {
    const attribution = outreachAttribution(signupSource);
    if (attribution && email) reportOutreachEvent({ event: 'signup', attribution, email });
  } catch { /* never affects sign-up */ }
}

async function lookupActivation(userId) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data || !data.user) return null;
  const attribution = attributionFromAppMetadata(data.user.app_metadata);
  return attribution && data.user.email ? { attribution, email: data.user.email } : null;
}

/** First successful transcription or summary for this user. Fire and forget; a no-op while OUTREACH_EVENTS_URL is unset. */
function noteActivation(userId) {
  try { reportActivationForUser(userId, lookupActivation); } catch { /* never affects a request */ }
}

module.exports = { signupAppMetadata, noteSignup, noteActivation, lookupActivation };
