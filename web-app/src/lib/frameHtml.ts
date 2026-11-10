// Model-written HTML (lessons) is shown in a sandboxed frame. The sandbox gives it no access to this site's storage;
// this adds a Content-Security-Policy inside the frame so it also cannot send anything to a server, load anything
// from the network, submit a form or change the base URL. Pure, no React.
export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** The only sandbox flags the frame gets. Never add allow-same-origin: a blob frame would then share this site's origin and storage. */
export const FRAME_SANDBOX = 'allow-scripts';

export function withFrameCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + meta);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
}
