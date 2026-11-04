/**
 * Pull a JSON object out of model text: strips ``` fences and any prose
 * around the object by taking the first '{' through the last '}'.
 * Throws (via JSON.parse) if the span is missing or not valid JSON.
 */
function extractJsonObject(text) {
  const cleaned = String(text ?? '')
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new SyntaxError('No JSON object found in model output');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Find the end of the JSON value that starts at `start` (an opening '[' or '{'),
 * honouring strings and escapes. Returns the index of the closing bracket, or -1
 * when the value never closes (truncated output).
 */
function findClosing(text, start) {
  const stack = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') stack.push(ch === '[' ? ']' : '}');
    else if (ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Pull the first parseable JSON array or object out of model text. Handles
 * ``` fences anywhere in the reply, prose before and after the value, and
 * bracketed prose such as "[easy]" ahead of the real payload.
 * Throws SyntaxError when nothing parseable is found (including truncated output).
 */
function extractJsonValue(text) {
  const raw = String(text ?? '');
  const candidates = [];
  const fence = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(raw)) !== null) candidates.push(m[1]);
  // A reply cut off inside an opened fence has no closing ```: take what follows the opener.
  const open = raw.match(/```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*)$/);
  if (open) candidates.push(open[1]);
  candidates.push(raw);

  for (const candidate of candidates) {
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (ch !== '[' && ch !== '{') continue;
      const end = findClosing(candidate, i);
      // Never closes: the reply was cut off. Do not descend into it, or an inner fragment would pass for the whole value.
      if (end === -1) break;
      try {
        return JSON.parse(candidate.slice(i, end + 1));
      } catch {
        i = end; // closed but not JSON (e.g. "[easy]"): skip past it
      }
    }
  }
  throw new SyntaxError('No JSON value found in model output');
}

module.exports = { extractJsonObject, extractJsonValue };
