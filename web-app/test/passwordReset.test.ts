import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResetLink, passwordProblem } from '../src/lib/passwordReset.ts';

test('a recovery link yields its session token', () => {
  assert.deepEqual(parseResetLink('#access_token=abc.def.ghi&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'), {
    kind: 'token',
    accessToken: 'abc.def.ghi',
  });
});

test('an expired or used link says so', () => {
  assert.equal(parseResetLink('#error=access_denied&error_code=otp_expired&error_description=expired').kind, 'error');
  assert.equal(parseResetLink('', '?error=access_denied').kind, 'error');
});

test('a plain visit, or a token that is not a recovery token, shows the request form', () => {
  assert.equal(parseResetLink('').kind, 'request');
  assert.equal(parseResetLink('#access_token=abc&type=signup').kind, 'request');
});

test('new password rules', () => {
  assert.match(passwordProblem('12345', '12345') ?? '', /at least 6/);
  assert.match(passwordProblem('123456', '123457') ?? '', /do not match/);
  assert.equal(passwordProblem('123456', '123456'), null);
});
