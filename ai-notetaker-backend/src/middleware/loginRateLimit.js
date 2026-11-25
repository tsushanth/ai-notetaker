'use strict';
/**
 * Brute-force limits for POST /api/auth/login. Only FAILED attempts are counted (a correct password never uses up a
 * budget), in two independent buckets:
 *   - per account (the e-mail being tried), so one account cannot be ground down from many addresses
 *   - per client address, so one address cannot try many accounts
 * The general API limiter is far too loose for this. The address comes from Fly-Client-IP, which Fly's proxy overwrites.
 * Counters are in memory, per machine, so with N machines the real ceiling is N times the number below.
 */
const rateLimit = require('express-rate-limit');

const WINDOW_MS = parseInt(process.env.LOGIN_RATE_WINDOW_MS, 10) || 15 * 60 * 1000;
const MAX_PER_ACCOUNT = parseInt(process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT, 10) || 8;
const MAX_PER_IP = parseInt(process.env.LOGIN_MAX_FAILURES_PER_IP, 10) || 30;

function clientAddress(req) {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.trim()) return fly.trim();
  return req.socket?.remoteAddress || 'unknown';
}

function accountKey(req) {
  const email = req.body && req.body.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

const tooMany = (req, res) =>
  res.status(429).json({ success: false, error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });

const make = (max, keyGenerator, { countSuccess = false, handler = tooMany } = {}) =>
  rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: !countSuccess,
    keyGenerator,
    handler,
    validate: false,
  });

// Password reset: every request counts (each one can send an email), per address and per account.
const tooManyResets = (req, res) =>
  res.status(429).json({ success: false, error: 'Too many password reset attempts. Please wait a few minutes and try again.' });

module.exports = {
  resetRequestLimiters: [
    make(10, (req) => `ip:${clientAddress(req)}`, { countSuccess: true, handler: tooManyResets }),
    make(3, (req) => `acct:${accountKey(req)}`, { countSuccess: true, handler: tooManyResets }),
  ],
  passwordUpdateLimiters: [make(20, (req) => `ip:${clientAddress(req)}`, { handler: tooManyResets })],
  loginLimiters: [make(MAX_PER_IP, (req) => `ip:${clientAddress(req)}`), make(MAX_PER_ACCOUNT, (req) => `acct:${accountKey(req)}`)],
  clientAddress,
  accountKey,
};
