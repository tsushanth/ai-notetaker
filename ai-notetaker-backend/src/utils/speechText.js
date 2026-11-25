/**
 * Prepares note text for the speech worker.
 *
 * The worker splits anything over 400 characters itself and, on that path, logs and SKIPS a piece it cannot synthesize
 * while still answering 200, so audio silently misses passages. A request of at most 400 characters takes its
 * single-piece path, where a failure is an HTTP error. So the text is split here, with a margin, and every piece is
 * sent on its own: a piece either comes back as audio or fails loudly.
 */

const MAX_PIECE_CHARS = 300;

/** Markdown (the formatted note) to plain text a voice can read. Keeps the words, drops the markup. */
function cleanTextForSpeech(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/```[a-zA-Z]*\n?/g, '')                       // code fences
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')              // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')               // links -> link text
    .replace(/\bhttps?:\/\/\S+/g, ' ')                     // bare URLs are unreadable and overflow the model
    .replace(/\*\*([^*]+)\*\*/g, '$1')                     // bold: keep the words
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\bHost \d+:/g, '')                           // podcast speaker labels
    .replace(/\[[^\]\n]*\]/g, '')                          // stage directions such as [pause]
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}[-| :\t]*$/gm, '')    // table separator rows
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row) => `${row.split('|').map((c) => c.trim()).filter(Boolean).join(', ')}.`)
    .replace(/^[ \t]*#{1,6}[ \t]*(.*?)[ \t]*$/gm, (_, h) => (/[.!?:]$/.test(h) ? h : `${h}.`))
    .replace(/^[ \t]*(?:[-*+•]|>)[ \t]+/gm, '')            // list and quote markers
    .replace(/[*`~#|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** True when there is something to pronounce (a piece of only punctuation or symbols makes the worker fail). */
const isSpeakable = (s) => /[\p{L}\p{N}]/u.test(s);

/** Cut one over-long string at the last comma or space before `max`, else hard at `max`. */
function cutLong(s, max) {
  const out = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('、'), window.lastIndexOf('，'));
    if (at < max / 3) at = window.lastIndexOf(' ');
    if (at < max / 3) at = max - 1;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Split into speakable pieces of at most `max` characters, on sentence ends where possible. No text is dropped. */
function splitForSpeech(text, max = MAX_PIECE_CHARS) {
  const sentences = String(text || '')
    .split(/(?<=[.!?。！？])\s+|(?<=[。！？])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const pieces = [];
  let buf = '';
  for (const sentence of sentences) {
    for (const part of cutLong(sentence, max)) {
      if (!buf) buf = part;
      else if (buf.length + 1 + part.length <= max) buf += ` ${part}`;
      else { pieces.push(buf); buf = part; }
    }
  }
  if (buf) pieces.push(buf);
  return pieces.filter(isSpeakable);
}

module.exports = { cleanTextForSpeech, splitForSpeech, isSpeakable, MAX_PIECE_CHARS };
