/**
 * A YouTube transcript failure with a stable code (sent as `code`) and a message that is safe to show.
 * Released Android apps do not show the message: they pick one of their own fixed texts by looking for words in it.
 * "captions" gives their no-captions text, "private" their private-or-unavailable text, none of those words their
 * "Failed to process video. Please try again." Keep that in mind when changing a message (test/youtubeTranscript.test.js).
 */
const { AppError } = require('../middleware/errorHandler');

const MESSAGES = {
  NO_CAPTIONS_UNAVAILABLE: [404, 'This video has no captions, so there is no transcript to make a note from. Try a video with captions.'],
  NO_CAPTIONS_TOO_LONG: [422, 'This video has no captions. ScribeAI can write a transcript only for videos up to 20 minutes long. Try a shorter video or one with captions.'],
  GENERATE_LIMIT_REACHED: [429, 'This video has no captions, and you have used all of today\'s transcripts for videos without captions. Try again later, or use a video with captions.'],
  NO_SPEECH: [404, 'This video has no captions and no speech could be heard in it, so there is no transcript.'],
  VIDEO_UNAVAILABLE: [404, 'This video is private, restricted or does not exist. Check the link and try again.'],
  NO_TRANSCRIPT: [404, 'There is no transcript for this video. A live stream can be added after it ends. Try a video with captions.'],
  // 4xx on purpose: released apps report every 5xx as a server fault, and this is not one.
  TRANSCRIPT_PENDING: [409, 'ScribeAI is still writing the transcript for this video. The note will appear in your notes list in a few minutes.'],
  TRANSCRIPT_FAILED: [502, 'Writing the transcript for this video failed. Please try again later.'],
  TRANSCRIPT_SERVICE_ERROR: [503, 'ScribeAI could not fetch the transcript just now. Please try again in a few minutes.'],
};

class TranscriptError extends AppError {
  constructor(code, { message, details } = {}) {
    const [status, text] = MESSAGES[code] || MESSAGES.TRANSCRIPT_SERVICE_ERROR;
    super(message || text, status);
    this.message = message || text;
    this.statusCode = status;
    this.publicCode = MESSAGES[code] ? code : 'TRANSCRIPT_SERVICE_ERROR';
    if (details) this.details = details;
  }
}

module.exports = { TranscriptError, MESSAGES };
