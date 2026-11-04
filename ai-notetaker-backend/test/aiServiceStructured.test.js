// generateQuiz / generateFlashcards / generateMindMap against a stubbed model: what the route would see for realistic bad output.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
process.env.SUPABASE_ANON_KEY = 'dummy';
process.env.ANTHROPIC_API_KEY = 'dummy';
process.env.FAILURE_REPORTER_DISABLED = '1';

const swap = (rel, exports) => {
  const full = require.resolve(path.join(__dirname, '..', 'src', rel));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const modelReplies = [];
const modelCalls = [];
const inserts = [];
swap('config/openai.js', {
  anthropic: { messages: { create: async (req) => { modelCalls.push(req); const next = modelReplies.shift(); if (next instanceof Error) throw next; return next; } } },
  llmUsage: { withFeature: (_f, fn) => fn() },
  MODELS: { GPT4_MINI: 'test-model' },
  PRICING: { 'test-model': { input: 0, output: 0 } }
});
swap('config/supabase.js', {
  supabaseAdmin: {
    from: (t) => ({
      upsert: (row) => { inserts.push([t, row]); return { select: () => ({ single: async () => ({ data: { id: 'ai-1' }, error: null }) }) }; },
      insert: async (row) => { inserts.push([t, row]); return { error: null }; }
    })
  }
});
let noteResult = { id: 'n1', content: 'Photosynthesis converts light into chemical energy.' };
swap('services/noteService.js', { getNoteById: async () => noteResult });

const aiService = require('../src/services/aiService');
const { AppError } = require('../src/middleware/errorHandler');

const text = (t, extra = {}) => ({ content: [{ type: 'text', text: t }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn', ...extra });
const quiz = [{ question: 'Q?', options: ['A) 1', 'B) 2', 'C) 3', 'D) 4'], correct_answer: 'A', explanation: 'because' }];
const reset = () => { modelReplies.length = 0; modelCalls.length = 0; inserts.length = 0; noteResult = { id: 'n1', content: 'Photosynthesis converts light into chemical energy.' }; };

test('quiz: markdown-fenced reply (the production failure) now succeeds on the first call', async () => {
  reset();
  modelReplies.push(text('```json\n' + JSON.stringify(quiz) + '\n```'));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 1 });
  assert.deepEqual(out.questions, quiz);
  assert.equal(modelCalls.length, 1);
});

test('quiz: prose then a JSON array succeeds', async () => {
  reset();
  modelReplies.push(text('Here is your quiz!\n\n' + JSON.stringify(quiz) + '\n\nGood luck.'));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 1 });
  assert.equal(out.questions.length, 1);
  assert.equal(out.partial, false);
});

test('quiz: refusal prose first, valid JSON on the stricter retry', async () => {
  reset();
  modelReplies.push(text('I would be happy to help, but first let me explain the topic.'), text(JSON.stringify(quiz)));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 1 });
  assert.equal(out.questions.length, 1);
  assert.equal(modelCalls.length, 2);
  assert.match(modelCalls[1].messages[0].content, /ONLY the raw JSON/);
  const usageRow = inserts.find(([t]) => t === 'usage_logs');
  assert.equal(usageRow[1].tokens_used, 300, 'both calls are billed in usage_logs');
});

test('quiz: unusable twice -> 502 with a clear message, not a 500', async () => {
  reset();
  modelReplies.push(text('nope'), text('still nope'));
  await assert.rejects(aiService.generateQuiz('u1', 'n1', {}), (e) => {
    assert.ok(e instanceof AppError);
    assert.equal(e.statusCode, 502);
    assert.match(e.message, /couldn't generate a quiz.*try again/i);
    return true;
  });
  assert.equal(inserts.length, 0, 'nothing saved');
});

test('quiz: missing note keeps its 404 instead of becoming a 500', async () => {
  reset();
  noteResult = null;
  await assert.rejects(aiService.generateQuiz('u1', 'n1', {}), (e) => e.statusCode === 404);
  assert.equal(modelCalls.length, 0);
});

test('quiz: an upstream API failure is still a 500', async () => {
  reset();
  modelReplies.push(new Error('upstream down'));
  await assert.rejects(aiService.generateQuiz('u1', 'n1', {}), (e) => e.statusCode === 500 && /Failed to generate quiz/.test(e.message));
});

test('flashcards: fenced reply with wrapper key succeeds; failure twice gives 502', async () => {
  reset();
  modelReplies.push(text('```json\n{"flashcards":[{"front":"a","back":"b"}]}\n```'));
  const out = await aiService.generateFlashcards('u1', 'n1', { num_cards: 1 });
  assert.deepEqual(out.flashcards, [{ front: 'a', back: 'b' }]);
  reset();
  modelReplies.push(text('[{"front":"a","back":"b"},{"front":"c"', { stop_reason: 'max_tokens' }), text('[{"front":"a"'));
  await assert.rejects(aiService.generateFlashcards('u1', 'n1', { num_cards: 2 }), (e) => e.statusCode === 502 && /flashcards/.test(e.message));
  assert.ok(modelCalls[1].max_tokens > modelCalls[0].max_tokens, 'truncated first reply gets a bigger retry budget');
});

test('mind map: fenced reply succeeds; invalid shape twice gives 502', async () => {
  reset();
  const map = { title: 'T', nodes: [{ id: '1', label: 'Root', level: 0, parentId: null }] };
  modelReplies.push(text('```json\n' + JSON.stringify(map) + '\n```'));
  const out = await aiService.generateMindMap('u1', 'n1', {});
  assert.equal(out.nodes.length, 1);
  reset();
  modelReplies.push(text('{"title":"T","nodes":[]}'), text('{"title":"T"}'));
  await assert.rejects(aiService.generateMindMap('u1', 'n1', {}), (e) => e.statusCode === 502);
});

const mkQ = (i, ans = 'A') => ({ question: `Q${i}?`, options: ['A) w', 'B) x', 'C) y', 'D) z'], correct_answer: ans, explanation: 'e' });
const mkCards = (n) => Array.from({ length: n }, (_, i) => ({ front: `f${i}`, back: `b${i}` }));

test('quiz: short reply (below ~70%) is retried once; a full retry is not partial', async () => {
  reset();
  modelReplies.push(text(JSON.stringify([mkQ(1), mkQ(2)])), text(JSON.stringify([1, 2, 3, 4, 5].map((i) => mkQ(i)))));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 5 });
  assert.equal(modelCalls.length, 2);
  assert.deepEqual([out.requested, out.returned, out.partial], [5, 5, false]);
});

test('quiz: still short after the retry returns what is valid, flagged partial with counts; never more than 2 model calls', async () => {
  reset();
  modelReplies.push(text(JSON.stringify([mkQ(1), mkQ(2)])), text(JSON.stringify([mkQ(1), mkQ(2), mkQ(3)])), text('never used'));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 10 });
  assert.equal(modelCalls.length, 2);
  assert.deepEqual([out.requested, out.returned, out.partial], [10, 3, true]);
  assert.equal(out.questions.length, 3);
});

test('quiz: 4 of 5 is within tolerance (no retry) but still reported as partial; extra questions are trimmed', async () => {
  reset();
  modelReplies.push(text(JSON.stringify([1, 2, 3, 4].map((i) => mkQ(i)))));
  let out = await aiService.generateQuiz('u1', 'n1', { num_questions: 5 });
  assert.equal(modelCalls.length, 1);
  assert.deepEqual([out.returned, out.partial], [4, true]);
  reset();
  modelReplies.push(text(JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((i) => mkQ(i)))));
  out = await aiService.generateQuiz('u1', 'n1', { num_questions: 5 });
  assert.deepEqual([out.returned, out.partial], [5, false]);
});

test('quiz: questions dropped by validation count against the total (object options, unresolvable answers)', async () => {
  reset();
  const bad = [{ question: 'o', options: [{ a: 1 }, { b: 2 }], correct_answer: 'A' }, { question: 'z', options: ['A) x', 'B) y'], correct_answer: 'Z' }];
  modelReplies.push(text(JSON.stringify([mkQ(1), ...bad])), text(JSON.stringify([1, 2, 3, 4, 5].map((i) => mkQ(i)))));
  const out = await aiService.generateQuiz('u1', 'n1', { num_questions: 5 });
  assert.equal(modelCalls.length, 2);
  assert.equal(out.returned, 5);
});

test('flashcards: short reply retried; still short -> partial with counts', async () => {
  reset();
  modelReplies.push(text(JSON.stringify(mkCards(3))), text(JSON.stringify(mkCards(4))));
  const out = await aiService.generateFlashcards('u1', 'n1', { num_cards: 10 });
  assert.equal(modelCalls.length, 2);
  assert.deepEqual([out.requested, out.returned, out.partial], [10, 4, true]);
  reset();
  modelReplies.push(text(JSON.stringify(mkCards(10))));
  const full = await aiService.generateFlashcards('u1', 'n1', { num_cards: 10 });
  assert.deepEqual([full.returned, full.partial], [10, false]);
});
