'use strict';
/**
 * Links and checks for outreach e-mails.
 * Scribe AI is on Android and the web only: no App Store link may go out, and SecureVox mail
 * must not be sent from this sender.
 */
const SITE_URL = 'https://scribeai.online';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai';

const tags = (campaign, content) => {
  const p = { utm_source: 'email', utm_medium: 'outreach', utm_campaign: campaign };
  if (content) p.utm_content = content;
  return p;
};
const qs = (p) => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Landing page link tagged for e-mail. */
function webLink(campaign, content) {
  return `${SITE_URL}/?${qs(tags(campaign, content))}`;
}

/** Play listing link. Play only reads attribution from the `referrer` parameter, which carries the encoded utm tags. */
function playLink(campaign, content) {
  return `${PLAY_URL}&referrer=${encodeURIComponent(qs(tags(campaign, content)))}`;
}

/** Bodies that must never be sent from this sender: an Apple store link, or the SecureVox product. */
const STALE_BODY = /apps\.apple\.com|itunes\.apple\.com|testflight\.apple\.com|securevox/i;
function isStaleOutreachBody(html) {
  return STALE_BODY.test(String(html || ''));
}

module.exports = { SITE_URL, PLAY_URL, webLink, playLink, isStaleOutreachBody };
