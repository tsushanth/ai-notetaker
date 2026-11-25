'use strict';
/**
 * Who a request counts against in the general API limiter. Only things the caller cannot make up are used:
 *   - the user, when the token's signature checks out here (our own sign-in tokens), or when the auth middleware has
 *     already had Supabase confirm that exact token (Supabase tokens cannot be checked locally)
 *   - otherwise the client address from Fly-Client-IP, which Fly's proxy overwrites
 * The first request with a new Supabase token therefore counts against the address. Memory only, per machine.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { clientAddress } = require('./loginRateLimit');

const MAX_REMEMBERED = 5000;
const confirmed = new Map(); // sha256(token) -> { userId, expiresAt }

const digest = (token) => crypto.createHash('sha256').update(token).digest('base64');

/** Call only with a token that has just been verified. */
function rememberVerifiedToken(token, userId) {
  const exp = jwt.decode(token)?.exp;
  if (!userId || !exp) return;
  if (confirmed.size >= MAX_REMEMBERED) confirmed.delete(confirmed.keys().next().value);
  confirmed.set(digest(token), { userId, expiresAt: exp * 1000 });
}

function verifiedUserId(token) {
  const known = confirmed.get(digest(token));
  if (known && known.expiresAt > Date.now()) return known.userId;
  const secret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }).sub || null;
  } catch (_) {
    return null;
  }
}

// The token rides on the Authorization header (API clients) or on ?token= (pages loaded in a WebView).
function requestToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.substring(7).trim();
  return typeof req.query?.token === 'string' ? req.query.token : null;
}

function rateLimitKey(req) {
  const token = requestToken(req);
  const userId = token ? verifiedUserId(token) : null;
  return userId ? `user:${userId}` : `ip:${clientAddress(req)}`;
}

/** Exact addresses only. */
function isAllowlisted(req, allowlist) {
  return allowlist.includes(clientAddress(req));
}

const parseAllowlist = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = { rateLimitKey, isAllowlisted, parseAllowlist, rememberVerifiedToken };
