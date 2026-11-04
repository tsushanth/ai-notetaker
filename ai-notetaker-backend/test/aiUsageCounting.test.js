// A generation that fails after the model was called must still use up the daily cap (usage is counted before generating).
const h = require('./helpers/routeHarness');
h.install();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const failWith = { error: null };
const svc = require.resolve(path.join(__dirname, '..', 'src', 'services', 'aiService.js'));
const gen = async () => { if (failWith.error) throw failWith.error; return { id: 'x' }; };
require.cache[svc] = { id: svc, filename: svc, loaded: true, exports: { generateQuiz: gen, generateFlashcards: gen, generateMindMap: gen } };

let server;
test.before(async () => { server = await h.listen(h.makeApp({ '/api/ai': require('../src/routes/ai') })); });
test.after(() => server.close());
test.beforeEach(() => { h.resetDb(); failWith.error = null; });

const ROUTES = [['/api/ai/quiz', 'quiz'], ['/api/ai/flashcards', 'flashcards'], ['/api/ai/mindmap', 'mindmap']];
let n = 0;

for (const [route, feature] of ROUTES) {
  test(`${route}: success counts one unit`, async () => {
    const user = `counting-ok-${++n}`;
    const r = await h.call(server, 'POST', route, { user, body: { note_id: 'n1' } });
    assert.equal(r.status, 200);
    assert.equal((h.db.usage_tracking || []).filter((x) => x.user_id === user && x.feature_type === feature).length, 1);
  });

  test(`${route}: a failed generation (unparseable output, 502) still counts one unit`, async () => {
    const user = `counting-fail-${++n}`;
    const err = new Error("We couldn't generate this");
    err.statusCode = 502;
    failWith.error = err;
    const r = await h.call(server, 'POST', route, { user, body: { note_id: 'n1' } });
    assert.equal(r.status, 502);
    assert.equal((h.db.usage_tracking || []).filter((x) => x.user_id === user && x.feature_type === feature).length, 1);
  });
}
