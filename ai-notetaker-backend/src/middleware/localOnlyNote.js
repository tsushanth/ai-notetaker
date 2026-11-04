// Notes the app creates on the device and never uploads (the welcome tutorial). The server has no row for them, so
// every note-scoped endpoint would answer a plain "Note not found" and log it as an error. Answer once, cheaply and
// with a code the client can switch on, before any database or subscription work.
const { logger } = require('../utils/logger');

const LOCAL_ONLY_NOTE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001' // welcome tutorial (Android TutorialContent.TUTORIAL_ID)
]);

const LOCAL_ONLY_CODE = 'LOCAL_ONLY_NOTE';

/** Express middleware factory: `rejectLocalOnlyNote('id')` reads req.params.id. */
function rejectLocalOnlyNote(param = 'id') {
  return (req, res, next) => {
    const noteId = req.params[param];
    if (!LOCAL_ONLY_NOTE_IDS.has(String(noteId || '').toLowerCase())) return next();
    // Expected client behaviour, not a server fault: no error log, no stack, no failure report.
    logger.debug('Request for a device-only note', { path: req.baseUrl + req.path, method: req.method });
    return res.status(404).json({
      success: false,
      code: LOCAL_ONLY_CODE,
      error: 'This sample note only exists on your device, so it cannot be exported or shared. Create your own note to try this.'
    });
  };
}

module.exports = { rejectLocalOnlyNote, LOCAL_ONLY_NOTE_IDS, LOCAL_ONLY_CODE };
