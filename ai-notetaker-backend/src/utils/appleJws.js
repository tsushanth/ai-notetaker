/**
 * Verify a JWS signed by the App Store (server notifications v2 and the transaction data inside them): the certificate
 * chain in its header must end at Apple Root CA - G3 (pinned by fingerprint), carry Apple's App Store marker extensions,
 * be within date, and the leaf must have signed the content. Without this anyone can post a "notification".
 */
const crypto = require('crypto');

// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer (SHA-256, fetched 2026-11-25)
const APPLE_ROOT_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
// DER encodings of the marker OIDs 1.2.840.113635.100.6.11.1 (leaf) and 1.2.840.113635.100.6.2.1 (intermediate).
const LEAF_OID = Buffer.from('060a2a864886f76364060b01', 'hex');
const INTERMEDIATE_OID = Buffer.from('060a2a864886f76364060201', 'hex');

class AppleSignatureError extends Error {
  constructor(reason) { super(`Apple signature rejected: ${reason}`); this.name = 'AppleSignatureError'; this.reason = reason; }
}

const json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function verifyAppleJws(jws, { rootSha256 = APPLE_ROOT_G3_SHA256, now = Date.now() } = {}) {
  const parts = typeof jws === 'string' ? jws.split('.') : [];
  if (parts.length !== 3) throw new AppleSignatureError('not_a_jws');
  let header, payload, chain;
  try {
    header = json(parts[0]);
    payload = json(parts[1]);
    chain = header.x5c.map((c) => new crypto.X509Certificate(Buffer.from(c, 'base64')));
  } catch { throw new AppleSignatureError('unreadable'); }
  if (header.alg !== 'ES256' || chain.length !== 3) throw new AppleSignatureError('unexpected_header');
  const [leaf, intermediate, root] = chain;
  if (crypto.createHash('sha256').update(root.raw).digest('hex') !== rootSha256) throw new AppleSignatureError('untrusted_root');
  if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey) || !intermediate.ca) throw new AppleSignatureError('broken_chain');
  if (!leaf.raw.includes(LEAF_OID) || !intermediate.raw.includes(INTERMEDIATE_OID)) throw new AppleSignatureError('not_app_store');
  if (chain.some((c) => now < Date.parse(c.validFrom) || now > Date.parse(c.validTo))) throw new AppleSignatureError('certificate_dates');
  const signed = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!signed) throw new AppleSignatureError('bad_signature');
  return payload;
}

module.exports = { verifyAppleJws, AppleSignatureError, APPLE_ROOT_G3_SHA256 };
