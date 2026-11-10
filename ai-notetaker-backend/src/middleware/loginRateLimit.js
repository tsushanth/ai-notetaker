'use strict';
/**
 * Brute-force limits for POST /api/auth/login. Only FAILED attempts are counted (a correct password never uses up a
 * budget), in two independent buckets:
 *   - per account (the e-mail being tried), so one account cannot be ground down from many addresses
 *   - per client address, so one address cannot try many accounts
 * The general API limiter is too loose for this (1000 requests per 15 minutes) and keys on X-Forwarded-For, which a
 * client can set itself; here the address comes from Fly-Client-IP, which Fly's proxy overwrites. Counters are in memory,
 * per machine, so with N machines the real ceiling is N times the number below.
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

const make = (max, keyGenerator) =>
  rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator,
    handler: tooMany,
    validate: false,
  });

module.exports = {
  loginLimiters: [make(MAX_PER_IP, (req) => `ip:${clientAddress(req)}`), make(MAX_PER_ACCOUNT, (req) => `acct:${accountKey(req)}`)],
  clientAddress,
  accountKey,
};
