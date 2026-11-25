/**
 * Password reset through Supabase Auth.
 *
 * Request: Supabase emails a one-time link. `redirect_to` asks for our web page; Supabase honours it only when the URL is
 * on the project's redirect allow list, otherwise it falls back to the project's site URL (the app link the Android app
 * registers). Both destinations can set the new password.
 * Update: the link carries a short-lived recovery session. Setting the password is the same call a client would make to
 * Supabase directly; this proxy adds no ability a holder of that token does not already have.
 */
const { getWebAppUrl } = require('../utils/webAppUrl');

const RESET_PATH = '/reset-password';
const TIMEOUT_MS = 15_000;

const resetPageUrl = (env = process.env) => `${getWebAppUrl(env)}${RESET_PATH}`;

async function call(path, { method, token, body }, { env = process.env, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, code: data.error_code || data.code, message: data.msg || data.message || data.error_description };
  } catch (e) {
    return { ok: false, status: 0, code: e.name, message: 'auth service unreachable' };
  }
}

/** { status, body } for the route. Supabase answers 200 for unknown addresses too, so nothing leaks. */
async function requestReset(email, deps) {
  const env = deps?.env || process.env;
  const r = await call(`/recover?redirect_to=${encodeURIComponent(resetPageUrl(env))}`, { method: 'POST', body: { email } }, deps);
  if (r.ok) return { status: 200, body: { success: true } };
  if (r.status === 429) {
    return { status: 429, body: { success: false, code: 'RESET_RATE_LIMITED', error: 'Too many reset emails were requested. Please wait an hour and try again.' } };
  }
  if (r.status === 400 || r.status === 422) {
    return { status: 400, body: { success: false, error: 'Please check the email address and try again.' } };
  }
  return { status: 502, body: { success: false, code: 'RESET_SEND_FAILED', error: 'The reset email could not be sent. Please try again.' } };
}

async function updatePassword(accessToken, password, deps) {
  const r = await call('/user', { method: 'PUT', token: accessToken, body: { password } }, deps);
  if (r.ok) return { status: 200, body: { success: true } };
  if (r.status === 401 || r.status === 403) {
    return { status: 400, body: { success: false, code: 'RESET_LINK_EXPIRED', error: 'This reset link has expired. Request a new one.' } };
  }
  if (r.status === 422) {
    const message = r.code === 'same_password' ? 'Choose a password different from your old one.' : 'That password was not accepted. Use a longer, harder to guess password.';
    return { status: 400, body: { success: false, code: 'PASSWORD_REJECTED', error: message } };
  }
  if (r.status === 429) return { status: 429, body: { success: false, error: 'Too many attempts. Please wait a few minutes.' } };
  return { status: 502, body: { success: false, code: 'PASSWORD_UPDATE_FAILED', error: 'The password could not be changed. Please try again.' } };
}

module.exports = { requestReset, updatePassword, resetPageUrl, RESET_PATH };
