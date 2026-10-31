const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonObject } = require('../src/utils/extractJson');

const obj = { title: 'T', nodes: [{ id: '1', label: 'a {b}' }] };

test('extractJsonObject parses plain JSON', () => {
  assert.deepEqual(extractJsonObject(JSON.stringify(obj)), obj);
});

test('extractJsonObject strips ```json fences', () => {
  assert.deepEqual(extractJsonObject('```json\n' + JSON.stringify(obj) + '\n```'), obj);
  assert.deepEqual(extractJsonObject('```\n' + JSON.stringify(obj) + '\n```'), obj);
});

test('extractJsonObject ignores prose before and after the object', () => {
  assert.deepEqual(extractJsonObject('Here is the map:\n' + JSON.stringify(obj) + '\nHope that helps!'), obj);
});

test('extractJsonObject throws on truncated output and on no object', () => {
  const truncated = JSON.stringify(obj).slice(0, -5);
  assert.throws(() => extractJsonObject(truncated));
  assert.throws(() => extractJsonObject('sorry, I cannot do that'));
  assert.throws(() => extractJsonObject(undefined));
});
