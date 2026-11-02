// Download a note as PDF or Word. Backend: GET /api/notes/:id/export/pdf|docx (Premium; 403 code PREMIUM_REQUIRED).
// Same host as API_BASE_URL in lib/api.ts (a test keeps the two equal); not imported, so this file loads in Node tests.
export const EXPORT_API_BASE_URL = 'https://ai-notetaker-backend.fly.dev';

export type ExportFormat = 'pdf' | 'docx';

/** The user is not on Premium: the page offers the existing upgrade path instead of a generic error. */
export class PremiumRequiredError extends Error {
  constructor(message = 'Exporting notes is a Premium feature.') {
    super(message);
    this.name = 'PremiumRequiredError';
  }
}

export async function downloadExport(token: string, noteId: string, format: ExportFormat): Promise<Blob> {
  const response = await fetch(`${EXPORT_API_BASE_URL}/api/notes/${noteId}/export/${format}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.ok) return response.blob();

  if (response.status === 401) throw new Error('Your session expired. Please sign in again.');
  const body = await response.json().catch(() => null) as { error?: string; message?: string; code?: string } | null;
  if (response.status === 403 && body?.code === 'PREMIUM_REQUIRED') throw new PremiumRequiredError();
  throw new Error(body?.error || body?.message || 'Could not export the note. Please try again.');
}

/** "<title>.pdf" with characters that are illegal in file names removed, capped at 80 characters. */
export function exportFileName(title: string, format: ExportFormat): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return `${cleaned || 'note'}.${format}`;
}
