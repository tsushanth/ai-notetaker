// Parsing, shape validation and one-shot retry for model output that must be structured (quiz, flashcards, mind map).
const { extractJsonValue } = require('./extractJson');

const LETTERS = 'ABCDEFGH';

/** Thrown when the model reply cannot be turned into the expected shape. */
class StructuredOutputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'StructuredOutputError';
    this.details = details;
  }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const asText = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Unwrap {questions:[...]} style envelopes; a bare array passes through. */
function pickArray(value, keys) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const k of keys) if (Array.isArray(value[k])) return value[k];
  }
  return null;
}

function optionList(raw) {
  if (Array.isArray(raw)) return raw.map(asText).filter(Boolean);
  if (raw && typeof raw === 'object') {
    // {"A": "text", "B": "text"} -> ["A) text", "B) text"]
    return Object.keys(raw).sort().map((k) => `${k.toUpperCase()}) ${asText(raw[k])}`);
  }
  return [];
}

/** Reduce "A", "a)", "B) Paris", 2 or the option's own text to a letter, or null if it cannot be resolved. */
function answerLetter(raw, options) {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    const idx = raw >= 1 && raw <= options.length ? raw - 1 : raw; // accept 1-based and 0-based
    return idx >= 0 && idx < options.length ? LETTERS[idx] : null;
  }
  const text = asText(raw);
  if (!text) return null;
  const m = text.match(/^\(?([A-Ha-h])(?:[).:\s]|$)/);
  if (m) return m[1].toUpperCase();
  const lower = text.toLowerCase();
  const idx = options.findIndex((o) => o.replace(/^[A-Ha-h][).:]\s*/, '').trim().toLowerCase() === lower);
  return idx >= 0 ? LETTERS[idx] : null;
}

/** Quiz reply -> [{question, options[], correct_answer: 'A'.., explanation}]. Invalid questions are dropped; none valid throws. */
function parseQuiz(text) {
  const value = extractJsonValue(text);
  const list = pickArray(value, ['questions', 'quiz']) || (value && value.question ? [value] : null);
  if (!list) throw new StructuredOutputError('Quiz reply is not a list of questions');
  const questions = [];
  for (const q of list) {
    if (!q || typeof q !== 'object') continue;
    const question = asText(q.question ?? q.q);
    const options = optionList(q.options ?? q.choices ?? q.answers);
    const letter = answerLetter(q.correct_answer ?? q.correctAnswer ?? q.answer, options);
    if (!question || options.length < 2 || !letter || LETTERS.indexOf(letter) >= options.length) continue;
    questions.push({ question, options, correct_answer: letter, explanation: asText(q.explanation) });
  }
  if (questions.length === 0) throw new StructuredOutputError('Quiz reply had no usable questions', { received: list.length });
  return questions;
}

/** Flashcard reply -> [{front, back}]. Invalid cards are dropped; none valid throws. */
function parseFlashcards(text) {
  const value = extractJsonValue(text);
  const list = pickArray(value, ['flashcards', 'cards']);
  if (!list) throw new StructuredOutputError('Flashcard reply is not a list of cards');
  const cards = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const front = asText(c.front ?? c.question ?? c.term);
    const back = asText(c.back ?? c.answer ?? c.definition);
    if (front && back) cards.push({ front, back });
  }
  if (cards.length === 0) throw new StructuredOutputError('Flashcard reply had no usable cards', { received: list.length });
  return cards;
}

/** Mind map reply -> {title, nodes[]}. Nodes need an id and a label; at least one is required. */
function parseMindMap(text) {
  const value = extractJsonValue(text);
  const obj = Array.isArray(value) ? { nodes: value } : value;
  if (!obj || !Array.isArray(obj.nodes)) throw new StructuredOutputError('Mind map reply has no nodes list');
  const nodes = [];
  for (const n of obj.nodes) {
    if (!n || typeof n !== 'object' || n.id == null || !isNonEmptyString(n.label)) continue;
    nodes.push({ ...n, id: String(n.id), parentId: n.parentId == null ? null : String(n.parentId) });
  }
  if (nodes.length === 0) throw new StructuredOutputError('Mind map reply had no usable nodes', { received: obj.nodes.length });
  return { title: asText(obj.title) || 'Mind Map', nodes };
}

const STRICT_RETRY_NOTE = '\n\nYour previous reply could not be read by a program. Reply again with ONLY the raw JSON in the exact structure requested: start with the opening bracket, end with the closing bracket, no markdown fences, no commentary before or after.';

const sumUsage = (a, b) => ({
  input_tokens: (a?.input_tokens || 0) + (b?.input_tokens || 0),
  output_tokens: (a?.output_tokens || 0) + (b?.output_tokens || 0)
});

/**
 * Run a model call whose reply must parse. One retry with a stricter instruction (and a larger token budget when
 * the first reply was cut off at max_tokens); a second failure throws StructuredOutputError.
 *
 *   request({ strictNote, maxTokens }) -> completion  (Anthropic messages response)
 *   parse(text) -> value                              (throws when the reply is unusable)
 *
 * Returns { value, usage, attempts }. `onFailure(info)` receives metadata only, never note or model text.
 */
async function requestStructured({ request, parse, maxTokens, maxTokensCap = 8000, onFailure }) {
  let usage = null;
  let budget = maxTokens;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const completion = await request({ strictNote: attempt === 1 ? '' : STRICT_RETRY_NOTE, maxTokens: budget });
    usage = sumUsage(usage, completion?.usage);
    const text = completion?.content?.find?.((b) => b && b.type === 'text')?.text ?? completion?.content?.[0]?.text ?? '';
    try {
      return { value: parse(text), usage, attempts: attempt };
    } catch (err) {
      lastError = err;
      const truncated = completion?.stop_reason === 'max_tokens';
      if (onFailure) onFailure({ attempt, error: err.message, stopReason: completion?.stop_reason, truncatedAtMaxTokens: truncated, responseLength: text.length });
      if (truncated) budget = Math.min(Math.ceil(budget * 1.75), maxTokensCap);
    }
  }
  throw new StructuredOutputError(lastError ? lastError.message : 'Unreadable model reply');
}

module.exports = { StructuredOutputError, parseQuiz, parseFlashcards, parseMindMap, requestStructured, STRICT_RETRY_NOTE };
