// Meeting link checks and the text shown on a meeting card. Link forms mirror the backend (recallService.js).
import type { MeetingPlatform, MeetingStatus } from '../types/index.ts';

export interface MeetingUrlCheck {
  valid: boolean;
  platform: MeetingPlatform | null;
  /** Why the link is refused, when there is something more useful to say than "invalid". */
  error?: string;
  /** The link is accepted, but the bot may not get in. */
  warning?: string;
}

const ZOOM_LINK =
  /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|zoom\.com|zoom-x\.de)\/(?:(?:j|s|wc(?:\/join)?)\/\d+|w\/\w+|my\/[\w.%+=-]+|meetings\/\d+\/invitations)/i;
const ZOOMGOV_LINK = /(?:^|\/\/|\.|\s)zoomgov\.com(?![\w.-])/i;
// A passcode (?pwd=), a registrant token (?tk=) or the "(Passcode: ...)" text that Recall also reads.
const ZOOM_ACCESS = /[?&](?:pwd|tk)=[^&#\s]+|\((?:password|passcode):/i;

export const ZOOMGOV_UNSUPPORTED = 'Zoom for Government (zoomgov.com) meetings are not supported.';
export const ZOOM_NO_PASSCODE =
  'This Zoom link has no passcode (pwd=). If the meeting has one, paste the full invite link or the bot will not get in.';

export const validateMeetingUrl = (url: string): MeetingUrlCheck => {
  const lowercased = url.toLowerCase();

  if (ZOOMGOV_LINK.test(url)) {
    return { valid: false, platform: null, error: ZOOMGOV_UNSUPPORTED };
  }
  if (ZOOM_LINK.test(url)) {
    return { valid: true, platform: 'zoom', ...(ZOOM_ACCESS.test(url) ? {} : { warning: ZOOM_NO_PASSCODE }) };
  }
  if (lowercased.includes('meet.google.com/')) {
    return { valid: true, platform: 'google_meet' };
  }
  if (lowercased.includes('teams.microsoft.com') || lowercased.includes('teams.live.com')) {
    return { valid: true, platform: 'teams' };
  }
  if (lowercased.includes('webex.com')) {
    return { valid: true, platform: 'webex' };
  }

  return { valid: false, platform: null };
};

/** The reason shown under a failed meeting; null for every other status. */
export const meetingFailureText = (meeting: { status: MeetingStatus; error_message?: string | null }): string | null => {
  if (meeting.status !== 'failed') return null;
  return meeting.error_message?.trim() || 'The bot could not record this meeting.';
};
