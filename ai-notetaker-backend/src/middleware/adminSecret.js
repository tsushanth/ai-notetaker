// Shared-secret check for admin and migration endpoints (header x-admin-secret). There is deliberately NO default value: when
// ADMIN_SECRET is not configured, no request can match, and the endpoint reports itself as disabled.
const crypto = require('crypto');

function adminSecretMatches(provided, expected) {
  if (typeof expected !== 'string' || !expected) return false;
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { adminSecretMatches };
