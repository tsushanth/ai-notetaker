// Paid speech: off by default, never more than the monthly cap, and the own worker whenever anything is not right.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
const stub = (rel, exports) => { const abs = require.resolve(rel); require.cache[abs] = { id: abs, filename: abs, loaded: true, exports }; };
stub('../src/utils/logger', { logger: { info() {}, warn() {}, error() {}, debug() {} } });
stub('../src/utils/failureReporter', { reportCounted() {}, reportFailure: async () => {} });

const { createPollySpeech, getPollyConfig, detectLanguage, VOICES, HARD_CAP_USD, CHUNK_CHARS } = require('../src/services/pollySpeech');

const ON = { TTS_POLLY_ENABLED: 'true', POLLY_ACCESS_KEY_ID: 'test-id', POLLY_SECRET_ACCESS_KEY: 'test-secret' };
const SAMPLES = {
  en: 'The lecture explains how plants turn sunlight into energy, and why this matters for every living thing on the planet.',
  es: 'La lección explica cómo las plantas convierten la luz del sol en energía y por qué esto es importante para todos los seres vivos.',
  pt: 'A aula explica como as plantas transformam a luz do sol em energia e por que isso é importante para todos os seres vivos.',
  fr: 'Le cours explique comment les plantes transforment la lumière du soleil en énergie et pourquoi cela compte pour tous les êtres vivants.',
  de: 'Die Vorlesung erklärt, wie Pflanzen Sonnenlicht in Energie umwandeln und warum das für alle Lebewesen auf der Erde wichtig ist.',
  pl: 'Wykład wyjaśnia, w jaki sposób rośliny przekształcają światło słoneczne w energię i dlaczego jest to ważne dla wszystkich żywych istot.',
  tr: 'Ders, bitkilerin güneş ışığını nasıl enerjiye dönüştürdüğünü ve bunun tüm canlılar için neden önemli olduğunu açıklıyor.',
  ru: 'Лекция объясняет, как растения превращают солнечный свет в энергию и почему это важно для всех живых существ на планете.',
  ar: 'تشرح المحاضرة كيف تحول النباتات ضوء الشمس إلى طاقة ولماذا يعد هذا مهما لجميع الكائنات الحية على هذا الكوكب.',
  hi: 'यह व्याख्यान बताता है कि पौधे सूरज की रोशनी को ऊर्जा में कैसे बदलते हैं और यह सभी जीवों के लिए क्यों महत्वपूर्ण है।',
  ja: 'この講義では、植物が太陽の光をどのようにエネルギーに変えるのか、そしてなぜそれがすべての生き物にとって重要なのかを説明します。',
  ko: '이 강의는 식물이 햇빛을 어떻게 에너지로 바꾸는지 그리고 그것이 모든 생물에게 왜 중요한지를 설명합니다.',
  zh: '本讲座解释了植物如何将阳光转化为能量，以及为什么这对地球上的所有生物都很重要。',
};
const bytes = Buffer.alloc(6000, 1);

function setup({ env = ON, reserve, send, encode } = {}) {
  const sent = [];
  const reserved = [];
  const settled = [];
  const polly = createPollySpeech({
    env,
    encode,
    send: send || (async (input) => { sent.push(input); return bytes; }),
    ledger: {
      reserve: reserve || (async (p) => { reserved.push(p); return { ok: true, id: 7, month_usd: p.costUsd }; }),
      settle: async (id, patch) => settled.push({ id, ...patch }),
    },
  });
  return { polly, sent, reserved, settled };
}

test('off unless switched on and given its own key; the app\'s AWS keys are not used', async () => {
  for (const env of [
    {}, { TTS_POLLY_ENABLED: 'true' }, { POLLY_ACCESS_KEY_ID: 'a', POLLY_SECRET_ACCESS_KEY: 'b' },
    { TTS_POLLY_ENABLED: 'true', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' },
    { ...ON, TTS_POLLY_ENABLED: '1' },
  ]) {
    const { polly, sent, reserved } = setup({ env });
    assert.equal(await polly.synthesize(SAMPLES.en), null);
    assert.equal(sent.length + reserved.length, 0);
  }
});

test('the cap is 50 USD; the environment can only lower it', () => {
  assert.equal(HARD_CAP_USD, 50);
  assert.equal(getPollyConfig(ON).capUsd, 50);
  assert.equal(getPollyConfig({ ...ON, POLLY_MONTHLY_CAP_USD: '500' }).capUsd, 50);
  assert.equal(getPollyConfig({ ...ON, POLLY_MONTHLY_CAP_USD: '5' }).capUsd, 5);
  assert.equal(getPollyConfig({ ...ON, POLLY_MONTHLY_CAP_USD: '0' }).capUsd, 0);
  assert.equal(getPollyConfig({ ...ON, POLLY_MONTHLY_CAP_USD: 'lots' }).capUsd, 50);
});

test('the note\'s language picks the voice', async () => {
  for (const [code, text] of Object.entries(SAMPLES)) {
    assert.equal(detectLanguage(text), code, code);
    const { polly, sent, reserved } = setup();
    const out = await polly.synthesize(text, { voice: 'nova' });
    assert.equal(out.language, code);
    assert.equal(sent[0].LanguageCode, VOICES[code][0]);
    assert.equal(sent[0].VoiceId, VOICES[code][1]);
    assert.equal(sent[0].Engine, VOICES[code][3]);
    assert.equal(reserved[0].costUsd, Number((reserved[0].characters * (VOICES[code][3] === 'neural' ? 16 : 4) / 1e6).toFixed(6)));
  }
});

test('a male app voice gets the male Polly voice where there is one', async () => {
  const { polly, sent } = setup();
  await polly.synthesize(SAMPLES.es, { voice: 'echo' });
  assert.equal(sent[0].VoiceId, 'Pedro');
});

test('a language without a voice, or too little text, goes to the worker unpaid', async () => {
  const bengali = 'এই বক্তৃতাটি ব্যাখ্যা করে যে উদ্ভিদ কীভাবে সূর্যের আলোকে শক্তিতে রূপান্তর করে এবং কেন এটি গুরুত্বপূর্ণ।';
  for (const text of [bengali, 'ok', '12345 67890']) {
    const { polly, sent, reserved } = setup();
    assert.equal(await polly.synthesize(text), null);
    assert.equal(sent.length + reserved.length, 0);
  }
});

test('a long note is sent whole, in requests Polly accepts', async () => {
  const text = `${SAMPLES.en} `.repeat(160).trim();
  const { polly, sent, reserved, settled } = setup();
  const out = await polly.synthesize(text);
  assert.ok(sent.length >= 7);
  assert.ok(sent.every((r) => r.Text.length <= CHUNK_CHARS && r.TextType === 'text'));
  assert.equal(sent.map((r) => r.Text).join(' '), text);
  assert.equal(out.mp3.length, bytes.length * sent.length);
  assert.equal(out.durationSeconds, Math.ceil((out.mp3.length * 8) / 48_000));
  assert.equal(settled[0].status, 'done');
  assert.equal(settled[0].characters, reserved[0].characters);
});

test('a re-encoded file reports its own length', async () => {
  const { polly } = setup({ encode: async () => Buffer.alloc(80_000) });
  assert.equal((await polly.synthesize(SAMPLES.en)).durationSeconds, 10);
});

test('speed uses SSML with the text escaped', async () => {
  const { polly, sent } = setup();
  await polly.synthesize(`${SAMPLES.en} Salt & light <b>`, { speed: 1.25 });
  assert.equal(sent[0].TextType, 'ssml');
  assert.match(sent[0].Text, /^<speak><prosody rate="125%">.*Salt &amp; light &lt;b&gt;<\/prosody><\/speak>$/);
});

test('cap reached or ledger down: nothing is sent', async () => {
  for (const reserve of [async () => ({ ok: false, month_usd: 49.99 }), async () => { throw new Error('relation does not exist'); }]) {
    const { polly, sent } = setup({ reserve });
    assert.equal(await polly.synthesize(SAMPLES.pl), null);
    assert.equal(sent.length, 0);
  }
});

test('a Polly failure falls back and keeps only what may have been billed', async () => {
  const text = `${SAMPLES.en} `.repeat(60).trim();
  for (const [status, billedPieces] of [[500, 2], [403, 1]]) {
    let n = 0;
    const first = [];
    const { polly, settled } = setup({ send: async (i) => { first.push(i.Text.length); if (++n === 2) throw Object.assign(new Error('boom'), { $metadata: { httpStatusCode: status } }); return bytes; } });
    assert.equal(await polly.synthesize(text), null);
    assert.equal(settled[0].status, 'failed');
    assert.equal(settled[0].characters, first.slice(0, billedPieces).reduce((a, b) => a + b, 0));
  }
});

test('Read Aloud uses the worker when paid speech says no, and the paid audio when it answers', async () => {
  const uploads = [];
  const rows = [];
  const note = { content: SAMPLES.pl, formatted_content: null, title: 't', source_type: 'video' };
  const chain = (result) => { const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [] }), single: async () => result, upsert: async (row) => { rows.push(row); return { error: null }; } }; return q; };
  stub('../src/config/supabase', { supabaseAdmin: { from: () => chain({ data: note, error: null }), storage: { from: () => ({ upload: async (name, body) => { uploads.push([name, body.length]); return { error: null }; }, getPublicUrl: (n) => ({ data: { publicUrl: `https://x/${n}` } }) }) } } });
  stub('../src/services/welcomeNote', { resolveNoteId: async (u, id) => id, isStockWelcomeNote: () => false });
  const tts = require('../src/services/ttsService');
  let own = 0;
  const { wavSeconds } = require('../src/utils/wav');
  assert.ok(wavSeconds);
  tts.synthesizeWithKokoro = async () => { own += 1; throw new Error('worker used'); };
  tts.paidSpeech = { synthesize: async () => null };
  await assert.rejects(tts.generateForNote('u1', 'n1'), /worker used/);
  assert.equal(own, 1);
  tts.paidSpeech = { synthesize: async () => ({ mp3: Buffer.alloc(800), durationSeconds: 3, language: 'pl' }) };
  const out = await tts.generateForNote('u1', 'n1');
  assert.equal(own, 1);
  assert.equal(out.duration_seconds, 3);
  assert.match(uploads[0][0], /^tts\/u1\/n1-\d+\.mp3$/);
});
