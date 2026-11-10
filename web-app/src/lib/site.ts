// Our own public address. Pure, no React, so it can be tested with `node --test`.
export const SITE_URL = 'https://scribeai.online';

export type SharedNoteCtaPlacement = 'header' | 'footer' | 'expired';

/**
 * Where the buttons on the public shared-note page send visitors: our own landing page, tagged so visits that come from a
 * shared note can be told apart from other traffic (the share loop). `placement` says which button was clicked.
 */
export function sharedNoteCtaUrl(placement: SharedNoteCtaPlacement): string {
  const params = new URLSearchParams({
    utm_source: 'share',
    utm_medium: 'note',
    utm_campaign: 'shared_note',
    utm_content: placement,
  });
  return `${SITE_URL}/?${params.toString()}`;
}
