import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnexpectedFeatureFailure, isUnexpectedSignInFailure } from '../src/lib/reportable.ts';

const http = (status: number) => Object.assign(new Error('x'), { status });

test('wrong password, duplicate account and rate limits are not reported', () => {
  for (const s of [400, 401, 409, 429]) assert.equal(isUnexpectedSignInFailure(http(s)), false);
  assert.equal(isUnexpectedSignInFailure(http(500)), true);
  assert.equal(isUnexpectedSignInFailure(new Error('network')), true);
});

test('limits and paywalls are not feature failures; server and note errors are', () => {
  for (const s of [401, 402, 403, 429]) assert.equal(isUnexpectedFeatureFailure(http(s)), false);
  for (const s of [404, 422, 500, 503]) assert.equal(isUnexpectedFeatureFailure(http(s)), true);
});
