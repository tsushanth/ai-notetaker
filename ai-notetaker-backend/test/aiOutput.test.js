const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonValue } = require('../src/utils/extractJson');
const { parseQuiz, parseFlashcards, parseMindMap, requestStructured, StructuredOutputError, STRICT_RETRY_NOTE } = require('../src/utils/aiOutput');

const quiz = [
  { question: 'What is 2+2?', options: ['A) 3', 'B) 4', 'C) 5', 'D) 6'], correct_answer: 'B', explanation: 'Sum.' },
  { question: 'Capital of France?', options: ['A) Paris', 'B) Rome', 'C) Oslo', 'D) Bern'], correct_answer: 'A', explanation: 'Paris.' }
];
const json = (v) => JSON.stringify(v, null, 2);

test('extractJsonValue: fenced array, prose before and after, bracketed prose first', () => {
  assert.deepEqual(extractJsonValue('```json\n' + json(quiz) + '\n```'), quiz);
  assert.deepEqual(extractJsonValue('Here are your questions:\n\n```json\n' + json(quiz) + '\n```\n\nLet me know if you want more!'), quiz);
  assert.deepEqual(extractJsonValue('Sure! [easy] set follows.\n' + json(quiz) + '\nEnjoy.'), quiz);
  assert.deepEqual(extractJsonValue('```\n' + json(quiz) + '\n```'), quiz);
});

test('extractJsonValue: brackets and quotes inside strings do not confuse the matcher', () => {
  const v = [{ front: 'What does "]" close?', back: 'An array } literal [x]' }];
  assert.deepEqual(extractJsonValue('Result: ' + JSON.stringify(v) + ' done'), v);
});

test('extractJsonValue: truncated or empty output throws', () => {
  assert.throws(() => extractJsonValue(json(quiz).slice(0, -40)), SyntaxError);
  assert.throws(() => extractJsonValue('```json\n' + json(quiz).slice(0, 80)), SyntaxError);
  assert.throws(() => extractJsonValue("I'm sorry, I can't create a quiz from that."), SyntaxError);
  assert.throws(() => extractJsonValue(undefined), SyntaxError);
});

test('parseQuiz: fenced reply, wrapper object, and a single question object', () => {
  assert.deepEqual(parseQuiz('```json\n' + json(quiz) + '\n```'), quiz);
  assert.deepEqual(parseQuiz(json({ questions: quiz })), quiz);
  assert.deepEqual(parseQuiz(json(quiz[0])), [quiz[0]]);
});

test('parseQuiz: normalises answer formats and option objects', () => {
  const messy = [
    { question: 'Q1', options: ['A) x', 'B) y'], correct_answer: 'B) y', explanation: 'e' },
    { question: 'Q2', options: ['A) x', 'B) y', 'C) z'], correct_answer: 'c.' },
    { question: 'Q3', options: ['x', 'y', 'z'], correct_answer: 'y' },
    { question: 'Q4', options: { A: 'x', B: 'y' }, correct_answer: 'a' },
    { question: 'Q5', options: ['A) x', 'B) y'], correct_answer: 2 }
  ];
  const out = parseQuiz(json(messy));
  assert.deepEqual(out.map((q) => q.correct_answer), ['B', 'C', 'B', 'A', 'B']);
  assert.deepEqual(out[3].options, ['A) x', 'B) y']);
  assert.equal(out[1].explanation, '');
});

test('parseQuiz: fewer questions than asked is accepted; invalid entries are dropped', () => {
  const mixed = [quiz[0], { question: 'no options' }, { question: 'bad answer', options: ['A) x', 'B) y'], correct_answer: 'F' }, 'junk', null];
  assert.deepEqual(parseQuiz(json(mixed)), [quiz[0]]);
});

test('parseQuiz: nothing usable throws StructuredOutputError', () => {
  assert.throws(() => parseQuiz(json([{ question: 'x' }])), StructuredOutputError);
  assert.throws(() => parseQuiz(json({ message: 'no quiz' })), StructuredOutputError);
  assert.throws(() => parseQuiz('[]'), StructuredOutputError);
});

test('parseFlashcards: array, wrapper keys, alternate field names', () => {
  const cards = [{ front: 'Mitosis', back: 'Cell division' }, { front: 'Osmosis', back: 'Water diffusion' }];
  assert.deepEqual(parseFlashcards('```json\n' + json(cards) + '\n```'), cards);
  assert.deepEqual(parseFlashcards(json({ flashcards: cards })), cards);
  assert.deepEqual(parseFlashcards(json({ cards })), cards);
  assert.deepEqual(parseFlashcards(json([{ question: 'Q', answer: 'A' }, { front: 'only front' }])), [{ front: 'Q', back: 'A' }]);
  assert.throws(() => parseFlashcards(json([{ front: 'x' }])), StructuredOutputError);
  assert.throws(() => parseFlashcards('{"flashcards": "none"}'), StructuredOutputError);
});

test('parseMindMap: fenced object, numeric ids coerced, nodes without label dropped', () => {
  const map = { title: 'Cells', nodes: [{ id: 1, label: 'Root', level: 0, parentId: null }, { id: '1.1', label: 'Child', parentId: 1 }, { id: '2' }] };
  const out = parseMindMap('Here you go:\n```json\n' + json(map) + '\n```');
  assert.equal(out.title, 'Cells');
  assert.deepEqual(out.nodes.map((n) => [n.id, n.parentId]), [['1', null], ['1.1', '1']]);
  assert.equal(parseMindMap(json({ nodes: map.nodes })).title, 'Mind Map');
  assert.throws(() => parseMindMap(json({ title: 'x', nodes: [] })), StructuredOutputError);
  assert.throws(() => parseMindMap(json({ title: 'x' })), StructuredOutputError);
});

const reply = (text, extra = {}) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', ...extra });

test('requestStructured: good first reply makes one call', async () => {
  const seen = [];
  const r = await requestStructured({ maxTokens: 100, parse: parseFlashcards, request: async (o) => { seen.push(o); return reply('[{"front":"a","back":"b"}]'); } });
  assert.equal(r.attempts, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].strictNote, '');
});

test('requestStructured: bad first reply retries once with the strict note and sums usage', async () => {
  const seen = [];
  const replies = [reply('Sorry, here is some prose only.'), reply('```json\n[{"front":"a","back":"b"}]\n```')];
  const failures = [];
  const r = await requestStructured({ maxTokens: 100, parse: parseFlashcards, onFailure: (i) => failures.push(i), request: async (o) => { seen.push(o); return replies.shift(); } });
  assert.equal(r.attempts, 2);
  assert.equal(seen[1].strictNote, STRICT_RETRY_NOTE);
  assert.deepEqual(r.usage, { input_tokens: 20, output_tokens: 10 });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].responseLength, 'Sorry, here is some prose only.'.length);
  assert.ok(!JSON.stringify(failures[0]).includes('prose only'), 'failure info must not carry model text');
});

test('requestStructured: a reply cut off at max_tokens retries with a larger budget', async () => {
  const seen = [];
  const replies = [reply('[{"front":"a","back":"b"},{"front":"c"', { stop_reason: 'max_tokens' }), reply('[{"front":"a","back":"b"}]')];
  await requestStructured({ maxTokens: 1000, parse: parseFlashcards, request: async (o) => { seen.push(o.maxTokens); return replies.shift(); } });
  assert.deepEqual(seen, [1000, 1750]);
});

test('requestStructured: two bad replies throw StructuredOutputError after exactly two calls', async () => {
  let n = 0;
  await assert.rejects(
    requestStructured({ maxTokens: 100, parse: parseQuiz, request: async () => { n++; return reply('nope'); } }),
    StructuredOutputError
  );
  assert.equal(n, 2);
});

test('requestStructured: API errors from the model call are not swallowed', async () => {
  await assert.rejects(requestStructured({ maxTokens: 1, parse: parseQuiz, request: async () => { throw new Error('overloaded'); } }), /overloaded/);
});
