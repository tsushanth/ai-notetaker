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

module.exports = { extractJsonObject };
