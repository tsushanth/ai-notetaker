/**
 * The saved AI "summary" item is stored by the backend as { summary, length, model }. Older rows or other
 * clients may hold a bare string. Returns the text to show, or null when there is nothing usable.
 */
export function extractSummaryText(content: unknown): string | null {
  const raw = typeof content === 'string' ? content : (content as { summary?: unknown } | null)?.summary;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text : null;
}
