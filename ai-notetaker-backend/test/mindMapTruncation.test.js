// The production failure of 2026-11-25: both mind map replies cut off at max_tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
process.env.SUPABASE_ANON_KEY = 'dummy';
process.env.ANTHROPIC_API_KEY = 'dummy';
process.env.FAILURE_REPORTER_DISABLED = '1';
const swap = (rel, exports) => { const full = require.resolve(path.join(__dirname, '..', 'src', rel)); require.cache[full] = { id: full, filename: full, loaded: true, exports }; };
const replies = []; const calls = []; const saved = [];
swap('config/openai.js', { anthropic: { messages: { create: async (r) => { calls.push(r); return replies.shift(); } } }, llmUsage: { withFeature: (_f, fn) => fn() }, MODELS: { GPT4_MINI: 'm' }, PRICING: { m: { input: 0, output: 0 } } });
swap('config/supabase.js', { supabaseAdmin: { from: (t) => ({ upsert: (row) => { saved.push([t, row]); return { select: () => ({ single: async () => ({ data: { id: 'ai-1' }, error: null }) }) }; }, insert: async () => ({ error: null }) }) } });
swap('services/noteService.js', { getNoteById: async () => ({ id: 'n1', content: 'A long note.' }) });
const aiService = require('../src/services/aiService');
const { salvageMindMap } = require('../src/utils/aiOutput');

const node = (id, parentId) => ({ id, label: `L${id}`, content: 'c { with } braces "quoted"', level: parentId ? 1 : 0, parentId });
const full = JSON.stringify({ title: 'T', nodes: [node('1', null), node('1.1', '1'), node('1.2', '1'), node('1.3', '1'), node('1.4', '1')] });
const cut = full.slice(0, full.indexOf('"1.4"') + 8);
const reply = (text, stop_reason) => ({ content: [{ type: 'text', text }], stop_reason, usage: { input_tokens: 1, output_tokens: 1 } });
const reset = () => { replies.length = 0; calls.length = 0; saved.length = 0; };

test('the token budget is large enough for a full map and grows on a cut-off reply', async () => {
  reset(); replies.push(reply(cut, 'max_tokens'), reply(full, 'end_turn'));
  const out = await aiService.generateMindMap('u1', 'n1', {});
  assert.equal(calls[0].max_tokens, 6000);
  assert.equal(calls[1].max_tokens, 10500);
  assert.match(calls[0].messages[0].content, /at most 30 nodes/);
  assert.equal(out.nodes.length, 5);
});

test('cut off twice: the complete branches are saved and returned', async () => {
  reset(); replies.push(reply(cut, 'max_tokens'), reply(cut, 'max_tokens'));
  const out = await aiService.generateMindMap('u1', 'n1', {});
  assert.equal(out.nodes.length, 4);
  const row = saved.find(([t]) => t === 'ai_content')[1];
  assert.equal(row.content_type, 'mindmap');
  assert.equal(row.content.partial, true);
});

test('a stub is not shown as a result', async () => {
  const stub = full.slice(0, full.indexOf('"1.2"'));
  assert.equal(salvageMindMap(stub), null);
  assert.equal(salvageMindMap('not json'), null);
  reset(); replies.push(reply(stub, 'max_tokens'), reply(stub, 'max_tokens'));
  await assert.rejects(aiService.generateMindMap('u1', 'n1', {}), { statusCode: 502 });
  assert.equal(saved.length, 0);
});
