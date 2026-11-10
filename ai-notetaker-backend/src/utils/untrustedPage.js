'use strict';
/**
 * Helpers for the HTML pages the backend serves itself (/learn, /create, /compete, /compete-create), which show
 * model-written HTML inside a frame and carry the signed-in user's token in their URL.
 *
 *  - jsLiteral(): put a request value into an inline <script> as a string literal that cannot end the script or the
 *    string (a path segment or ?token= used to be pasted in raw, which let a crafted link run script on this origin).
 *  - CLIENT_HELPERS: source text for esc() (escape anything dynamic before it goes into innerHTML) and framedUrl()
 *    (wrap model-written HTML for a sandboxed frame with its own Content-Security-Policy: no network, no forms).
 *  - setPageHeaders(): response headers for these pages (CSP that only allows this API, no referrer so the token in the
 *    URL is not leaked, no caching).
 */
const API_ORIGIN = 'https://ai-notetaker-backend.fly.dev';

function jsLiteral(value) {
  return JSON.stringify(String(value == null ? '' : value))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// CSP applied to generated content inside its frame: it may run its own inline script and style but cannot talk to
// any server, load anything from the network, submit a form or change the base URL.
const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

// Runs in the browser. Kept as plain ES5-style text so it can be pasted into the page and also evaluated by tests.
const CLIENT_HELPERS = `
    var FRAME_CSP = ${JSON.stringify(FRAME_CSP)};
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function withFrameCsp(html) {
      var meta = '<meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP + '">';
      html = String(html == null ? '' : html);
      if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + meta; });
      if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + meta + '</head>'; });
      return '<!DOCTYPE html><html><head>' + meta + '</head><body>' + html + '</body></html>';
    }
    function framedUrl(html) {
      return URL.createObjectURL(new Blob([withFrameCsp(html)], { type: 'text/html' }));
    }
    function frameTag(className, url, style) {
      return '<iframe class="' + className + '" src="' + url + '" sandbox="allow-scripts" csp="' + esc(FRAME_CSP) + '" referrerpolicy="no-referrer" style="' + style + '"></iframe>';
    }
`;

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  `connect-src 'self' ${API_ORIGIN}`,
  'frame-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

function setPageHeaders(res) {
  res.removeHeader('Content-Security-Policy');
  res.set({
    'Content-Security-Policy': PAGE_CSP,
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'text/html; charset=utf-8',
  });
}

module.exports = { jsLiteral, CLIENT_HELPERS, FRAME_CSP, PAGE_CSP, API_ORIGIN, setPageHeaders };
