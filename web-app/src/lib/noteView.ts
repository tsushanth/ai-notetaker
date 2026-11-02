// Pure helpers for how the note page shows a note's text. They mirror the Android NotesTab rules.

export interface ViewableNote {
  content: string;
  formatted_content?: string | null;
  formatting_status?: string | null;
}

/** Android polls only for notes at least this long (shorter ones are not formatted by the backend). */
export const MIN_CHARS_TO_FORMAT = 200;

export type ViewMode = 'formatted' | 'raw';

/** Formatted text exists AND the backend marked it completed (Android `hasFormattedContent`). */
export function hasFormattedContent(note: ViewableNote): boolean {
  return !!note.formatted_content && note.formatting_status === 'completed';
}

/** Formatted markdown when available and asked for, else the raw transcript/text. */
export function displayContent(note: ViewableNote, mode: ViewMode): string {
  return mode === 'formatted' && hasFormattedContent(note) ? (note.formatted_content as string) : note.content;
}

/** Keep re-fetching while a long note is still being formatted. A failed status will not resolve by waiting. */
export function shouldPollFormatting(note: ViewableNote): boolean {
  if (hasFormattedContent(note)) return false;
  if (note.formatting_status === 'failed') return false;
  return note.content.length >= MIN_CHARS_TO_FORMAT;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
