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

const OPTION_TEXT_KEYS = ['text', 'label', 'value', 'content'];

/** One option -> trimmed text, or null when it is not clearly text (objects without a text field, arrays, empties). */
function optionText(o) {
  if (typeof o === 'string') return o.trim() || null;
  if (typeof o === 'number' || typeof o === 'boolean') return String(o);
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of OPTION_TEXT_KEYS) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  }
  return null;
}

/** Option list as clean strings, or null if any option cannot be read (the question is then dropped). */
function optionList(raw) {
  if (Array.isArray(raw)) {
    const out = raw.map(optionText);
    return out.every(Boolean) ? out : null;
  }
  if (raw && typeof raw === 'object') {
    // {"A": "text", "B": "text"} -> ["A) text", "B) text"]
    const out = Object.keys(raw).sort().map((k) => { const t = optionText(raw[k]); return t && `${k.toUpperCase()}) ${t}`; });
    return out.length && out.every(Boolean) ? out : null;
  }
  return null;
}

const stripLetter = (o) => o.replace(/^\(?[A-Ha-h][).:]\s*/, '').trim().toLowerCase();

/**
 * Resolve the model's correct_answer to a letter. Order matters: the answer text itself wins ("A cat is an animal"
 * is an option, not the letter A); only then letter forms "A", "a)", "B) Paris", "(c)", and finally an index.
 */
function answerLetter(raw, options) {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    const idx = raw >= 1 && raw <= options.length ? raw - 1 : raw; // accept 1-based and 0-based
    return idx >= 0 && idx < options.length ? LETTERS[idx] : null;
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const exact = options.findIndex((o) => o.toLowerCase() === lower || stripLetter(o) === lower);
  if (exact >= 0) return LETTERS[exact];
  const m = text.match(/^\(?([A-Ha-h])(?:\s*[).:]|$)/);
  return m ? m[1].toUpperCase() : null;
}

/** Quiz reply -> [{question, options[], correct_answer: 'A'.., explanation}]. Invalid questions are dropped; none valid throws. */
function parseQuiz(text) {
  const value = extractJsonValue(text);
  const list = pickArray(value, ['questions', 'quiz']) || (value && value.question ? [value] : null);
  if (!list) throw new StructuredOutputError('Quiz reply is not a list of questions');
  const questions = [];
  for (const q of list) {
    if (!q || typeof q !== 'object') continue;
    const question = optionText(q.question ?? q.q);
    const options = optionList(q.options ?? q.choices ?? q.answers);
    if (!question || !options || options.length < 2) continue;
    const letter = answerLetter(q.correct_answer ?? q.correctAnswer ?? q.answer, options);
    if (!letter || LETTERS.indexOf(letter) >= options.length) continue;
    questions.push({ question, options, correct_answer: letter, explanation: typeof q.explanation === 'string' ? q.explanation.trim() : '' });
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
    const front = optionText(c.front ?? c.question ?? c.term);
    const back = optionText(c.back ?? c.answer ?? c.definition);
    if (front && back) cards.push({ front, back });
  }
  if (cards.length === 0) throw new StructuredOutputError('Flashcard reply had no usable cards', { received: list.length });
  return cards;
}

/**
 * Mind map reply -> {title, nodes[]}. Nodes need an id and a label; duplicate ids are dropped. The root is the first node
 * without a parent (or the first node). A parentId that points outside the node set, at the node itself, or into a cycle
 * is re-parented to the root so the client never has to render a dangling or looping branch.
 */
function parseMindMap(text) {
  const value = extractJsonValue(text);
  const obj = Array.isArray(value) ? { nodes: value } : value;
  if (!obj || !Array.isArray(obj.nodes)) throw new StructuredOutputError('Mind map reply has no nodes list');
  const seen = new Set();
  const nodes = [];
  for (const n of obj.nodes) {
    if (!n || typeof n !== 'object' || n.id == null || !isNonEmptyString(n.label)) continue;
    const id = String(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ ...n, id, parentId: n.parentId == null || n.parentId === '' ? null : String(n.parentId) });
  }
  if (nodes.length === 0) throw new StructuredOutputError('Mind map reply had no usable nodes', { received: obj.nodes.length });

  const root = nodes.find((n) => n.parentId === null) || nodes[0];
  root.parentId = null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n === root) continue;
    if (n.parentId === null) continue; // an extra top-level node stays top-level
    if (n.parentId === n.id || !byId.has(n.parentId)) n.parentId = root.id;
  }
  for (const n of nodes) { // cycles that do not pass through the root
    const path = new Set();
    let cur = n;
    while (cur && cur.parentId !== null) {
      if (path.has(cur.id)) { n.parentId = root.id; break; }
      path.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return { title: optionText(obj.title) || 'Mind Map', nodes };
}

const STRICT_RETRY_NOTE = '\n\nYour previous reply could not be read by a program. Reply again with ONLY the raw JSON in the exact structure requested: start with the opening bracket, end with the closing bracket, no markdown fences, no commentary before or after.';

const sumUsage = (a, b) => ({
  input_tokens: (a?.input_tokens || 0) + (b?.input_tokens || 0),
  output_tokens: (a?.output_tokens || 0) + (b?.output_tokens || 0)
});

/**
 * Run a model call whose reply must parse. At most TWO model calls per request: the retry (stricter instruction, larger
 * token budget when the first reply was cut off at max_tokens) also covers a reply that parses but is too short.
 *
 *   request({ strictNote, maxTokens }) -> completion  (Anthropic messages response)
 *   parse(text) -> value                              (throws when the reply is unusable)
 *   isComplete(value) -> boolean                      (optional; false = usable but too short, worth one retry)
 *
 * Returns { value, usage, attempts, partial }. `partial` is true when the best valid value failed isComplete after the
 * retry. Throws StructuredOutputError when nothing valid was produced. `onFailure(info)` receives metadata only, never
 * note or model text.
 */
async function requestStructured({ request, parse, maxTokens, maxTokensCap = 8000, isComplete, onFailure }) {
  let usage = null;
  let budget = maxTokens;
  let lastError = null;
  let best = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const completion = await request({ strictNote: attempt === 1 ? '' : STRICT_RETRY_NOTE, maxTokens: budget });
    usage = sumUsage(usage, completion?.usage);
    const text = completion?.content?.find?.((b) => b && b.type === 'text')?.text ?? completion?.content?.[0]?.text ?? '';
    const truncated = completion?.stop_reason === 'max_tokens';
    try {
      const value = parse(text);
      if (!isComplete || isComplete(value)) return { value, usage, attempts: attempt, partial: false };
      if (!best || (Array.isArray(value) && value.length > best.length)) best = value;
      lastError = new StructuredOutputError('Reply was valid but too short');
      if (onFailure) onFailure({ attempt, error: lastError.message, stopReason: completion?.stop_reason, truncatedAtMaxTokens: truncated, responseLength: text.length, returned: Array.isArray(value) ? value.length : undefined });
    } catch (err) {
      lastError = err;
      if (onFailure) onFailure({ attempt, error: err.message, stopReason: completion?.stop_reason, truncatedAtMaxTokens: truncated, responseLength: text.length });
    }
    if (truncated) budget = Math.min(Math.ceil(budget * 1.75), maxTokensCap);
  }
  if (best) return { value: best, usage, attempts: 2, partial: true };
  throw new StructuredOutputError(lastError ? lastError.message : 'Unreadable model reply');
}

/** Valid results must reach about 70% of what was asked for to count as complete. */
const enoughOf = (requested) => (value) => !requested || (Array.isArray(value) && value.length >= Math.ceil(requested * 0.7));

module.exports = { StructuredOutputError, parseQuiz, parseFlashcards, parseMindMap, requestStructured, enoughOf, STRICT_RETRY_NOTE };
