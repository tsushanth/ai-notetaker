/**
 * Amazon SNS message signature verification (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
 * SNS signs every message it delivers. We verify: SigningCertURL host is a genuine SNS endpoint (https, sns.<region>.amazonaws.com,
 * .pem), the canonical string for the message Type, and the RSA signature (SHA1 for SignatureVersion 1, SHA256 for 2).
 * Also exports isSnsHost() for the SubscribeURL check: the old route did axios.get(message.SubscribeURL) on attacker-controlled input (SSRF).
 */
const crypto = require('crypto');
const https = require('https');

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

function isSnsUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && SNS_HOST.test(u.hostname);
  } catch { return false; }
}

const NOTIFICATION_FIELDS = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
const CONFIRM_FIELDS = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

function canonicalString(msg) {
  const fields = msg.Type === 'Notification' ? NOTIFICATION_FIELDS : CONFIRM_FIELDS;
  return fields.filter((f) => msg[f] !== undefined && msg[f] !== null).map((f) => `${f}\n${msg[f]}\n`).join('');
}

const certCache = new Map();
function fetchCertPem(url) {
  if (certCache.has(url)) return Promise.resolve(certCache.get(url));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`cert fetch ${res.statusCode}`)); }
      let data = '';
      res.on('data', (c) => { data += c; if (data.length > 20000) req.destroy(new Error('cert too large')); });
      res.on('end', () => { certCache.set(url, data); resolve(data); });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('cert fetch timeout')));
  });
}

/** @returns {Promise<{ok:boolean, reason?:string}>} never throws */
async function verifySnsMessage(msg, { fetchCert = fetchCertPem } = {}) {
  try {
    if (!msg || typeof msg !== 'object') return { ok: false, reason: 'no_body' };
    if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(msg.Type)) return { ok: false, reason: 'bad_type' };
    if (!msg.Signature || !msg.SigningCertURL) return { ok: false, reason: 'no_signature' };
    if (!isSnsUrl(msg.SigningCertURL) || !String(msg.SigningCertURL).endsWith('.pem')) return { ok: false, reason: 'bad_cert_url' };
    const algo = msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null;
    if (!algo) return { ok: false, reason: 'bad_signature_version' };
    const pem = await fetchCert(msg.SigningCertURL);
    const ok = crypto.createVerify(algo).update(canonicalString(msg), 'utf8').verify(pem, msg.Signature, 'base64');
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'verify_error' };
  }
}

module.exports = { verifySnsMessage, isSnsUrl, canonicalString };
