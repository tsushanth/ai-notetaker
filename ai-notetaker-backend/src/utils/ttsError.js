/**
 * A Read Aloud failure with a stable code (used in reports) and a message that is safe to show the user.
 * 4xx means asking again cannot help; 502 means it might (the apps retry 5xx on their own).
 */
const MESSAGES = {
  NOTE_NOT_FOUND: [404, 'Note not found'],
  NOTHING_TO_READ: [422, 'This note has no text to read aloud.'],
  TOO_LONG: [422, 'This note is too long to read aloud.'],
  DEADLINE: [422, 'This note took too long to turn into audio. Try a shorter note.'],
  WORKER_SLOW: [422, 'Read Aloud is busy right now. Please try again later.'], // 422: released apps resend a 5xx at once
  WORKER_ERROR: [502, 'Failed to generate audio. Please try again.'],
  WORKER_TIMEOUT: [502, 'Failed to generate audio. Please try again.'],
  WORKER_UNREACHABLE: [502, 'Failed to generate audio. Please try again.'],
  BAD_AUDIO: [502, 'Failed to generate audio. Please try again.'],
  UPLOAD_FAILED: [502, 'Failed to save the audio. Please try again.'],
  INTERNAL: [500, 'Failed to generate audio. Please try again.'],
};

class TtsError extends Error {
  constructor(code, detail, { workerStatus = null } = {}) {
    const [status, userMessage] = MESSAGES[code] || MESSAGES.INTERNAL;
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'TtsError';
    this.code = MESSAGES[code] ? code : 'INTERNAL';
    this.statusCode = status;
    this.userMessage = userMessage;
    this.workerStatus = workerStatus;
  }
}

module.exports = { TtsError };
