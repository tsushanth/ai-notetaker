const jwt = require('jsonwebtoken');
const fs = require('fs');

// Your Apple credentials
const teamId = '7RS696YC75';              // Found in Apple Developer Account
const clientId = 'KreativeKoala.scribeai.auth';  // Your Service ID
const keyId = 'XKV8W64FX5';                // From the key you created
const keyFile = '/Users/sushanthtiruvaipati/Downloads/AuthKey_XKV8W64FX5.p8';         // Your downloaded .p8 file
//ios:917362189743-a8n80i547bapojm3u5u734ds9hb9kofa.apps.googleusercontent.com

//web:917362189743-mllfqc9jjog1a3n8mie52grd3qk9at00.apps.googleusercontent.com

//web secret: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
// Read the private key
const privateKey = fs.readFileSync(keyFile);

// JWT claims
const claims = {
  iss: teamId,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 86400 * 180, // 180 days
  aud: 'https://appleid.apple.com',
  sub: clientId
};

// Generate token
const token = jwt.sign(claims, privateKey, {
  algorithm: 'ES256',
  header: {
    alg: 'ES256',
    kid: keyId
  }
});

console.log(token);