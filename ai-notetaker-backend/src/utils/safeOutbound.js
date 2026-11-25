/**
 * POST to an address a user supplied, without letting them reach anything private (SSRF): https only, every address the
 * name resolves to must be public, the connection goes to the address that was checked (no second lookup), and redirects
 * are not followed.
 */
const dns = require('dns').promises;
const https = require('https');
const net = require('net');

// Separate lists: a BlockList that holds IPv4-mapped IPv6 ranges would also match every plain IPv4 address.
const v4 = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) v4.addSubnet(a, p, 'ipv4');
// Only global unicast IPv6 (2000::/3) is public; the special ranges inside it are excluded too.
const v6Global = new net.BlockList();
v6Global.addSubnet('2000::', 3, 'ipv6');
const v6Special = new net.BlockList();
for (const [a, p] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) v6Special.addSubnet(a, p, 'ipv6');

class UnsafeUrlError extends Error {
  constructor(reason) { super(`URL not allowed: ${reason}`); this.name = 'UnsafeUrlError'; this.reason = reason; }
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !v4.check(address, 'ipv4');
  if (family === 6) return v6Global.check(address, 'ipv6') && !v6Special.check(address, 'ipv6');
  return false;
}

/** Resolves { url, address, family } for a URL that is safe to call, or throws UnsafeUrlError. */
async function checkPublicUrl(value, { lookup = dns.lookup, allowHosts = null } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new UnsafeUrlError('not a URL'); }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('https only');
  if (url.username || url.password) throw new UnsafeUrlError('credentials in URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (allowHosts && !allowHosts.includes(host)) throw new UnsafeUrlError('host not allowed');
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw new UnsafeUrlError('host does not resolve'); }
  }
  if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) throw new UnsafeUrlError('address is not public');
  return { url, address: addresses[0].address, family: addresses[0].family };
}

/** Send JSON. Resolves { status }; the response body is discarded. */
async function postJson(value, body, { timeoutMs = 5000, request = https.request, ...checks } = {}) {
  const { url, address, family } = await checkPublicUrl(value, checks);
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      agent: false,
      signal: AbortSignal.timeout(timeoutMs),
      // Connect to exactly the address that passed the check.
      lookup: (_host, options, cb) => (options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
    }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode });
      else reject(new Error(`HTTP ${res.statusCode}`));
    });
    req.on('error', reject);
    req.end(data);
  });
}

module.exports = { checkPublicUrl, postJson, isPublicAddress, UnsafeUrlError };
