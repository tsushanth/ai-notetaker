// The built-in welcome note on the server: finding this user's copy, and telling the app's own text apart from anything
// a user wrote or changed.
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { LOCAL_ONLY_NOTE_IDS } = require('../middleware/localOnlyNote');

/**
 * SHA-256 of each welcome text the Android app has shipped (utils/TutorialContent.kt TUTORIAL_CONTENT, newest first).
 * Add the new hash when that text changes; until then the new text is simply treated like any other note.
 */
const STOCK_CONTENT_SHA256 = new Set([
  '2dcbe9045456ea5405b524bc3e162e93f8ca3df4b15a93d5da8fa2bf6bca7b0c',
  'b9d90229bd70afe0ca975bbabc8e3f733230fa9f4517e9d70ba7bf388d044862',
  'ae3e947c97d8847424c8c143bbd6ae46688c74db536a1a42c516e72186c28a8d'
]);

/** True only for a tutorial note whose text is byte for byte one the app supplied. */
function isStockWelcomeNote(note) {
  return note?.source_type === 'tutorial'
    && typeof note.content === 'string'
    && STOCK_CONTENT_SHA256.has(crypto.createHash('sha256').update(note.content).digest('hex'));
}

/**
 * The welcome note is built into the app under one fixed id, and the server keeps a per-user copy under a generated id.
 * Map the fixed id to this user's copy. Any other id, or a user with no copy, gets the id back unchanged.
 */
async function resolveNoteId(userId, noteId) {
  if (!LOCAL_ONLY_NOTE_IDS.has(String(noteId).toLowerCase())) return noteId;
  const { data } = await supabaseAdmin
    .from('notes')
    .select('id')
    .eq('user_id', userId)
    .eq('source_type', 'tutorial')
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.id || noteId;
}

module.exports = { resolveNoteId, isStockWelcomeNote, STOCK_CONTENT_SHA256 };
