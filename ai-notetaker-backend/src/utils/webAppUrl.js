/**
 * Public address of the web app, used in share links, the Google Drive redirect and similar.
 * WEB_APP_URL wins when it is set; otherwise our own domain. (This default used to point at a different company's site.) A trailing slash is dropped so callers can append a path.
 */
const DEFAULT_WEB_APP_URL = 'https://scribeai.online';

function getWebAppUrl(env = process.env) {
  const configured = String(env.WEB_APP_URL || '').trim().replace(/\/+$/, '');
  return configured || DEFAULT_WEB_APP_URL;
}

module.exports = { getWebAppUrl, DEFAULT_WEB_APP_URL };
