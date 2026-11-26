// Notes the app creates on the device and never uploads (the welcome tutorial). The server has no row for them, so
// every note-scoped endpoint would answer a plain "Note not found" and log it as an error. Answer once, cheaply and
// with a code the client can switch on, before any database or subscription work.
const { logger } = require('../utils/logger');

const LOCAL_ONLY_NOTE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001' // welcome tutorial (Android TutorialContent.TUTORIAL_ID)
]);

const LOCAL_ONLY_CODE = 'LOCAL_ONLY_NOTE';

const isLocalOnlyNoteId = (noteId) => LOCAL_ONLY_NOTE_IDS.has(String(noteId || '').toLowerCase());

/** The 404 for a device-only note. An expected refusal, so feature health does not count it as a failed attempt. */
function answerLocalOnlyNote(res, error) {
  res.locals.outcome = 'denied';
  return res.status(404).json({ success: false, code: LOCAL_ONLY_CODE, error });
}

/** Express middleware factory: `rejectLocalOnlyNote('id')` reads req.params.id. */
function rejectLocalOnlyNote(param = 'id') {
  return (req, res, next) => {
    if (!isLocalOnlyNoteId(req.params[param])) return next();
    // Expected client behaviour, not a server fault: no error log, no stack, no failure report.
    logger.debug('Request for a device-only note', { path: req.baseUrl + req.path, method: req.method });
    return answerLocalOnlyNote(res, 'This sample note only exists on your device, so it cannot be exported or shared. Create your own note to try this.');
  };
}

module.exports = { rejectLocalOnlyNote, isLocalOnlyNoteId, answerLocalOnlyNote, LOCAL_ONLY_NOTE_IDS, LOCAL_ONLY_CODE };
