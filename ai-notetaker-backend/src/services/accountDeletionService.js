// Permanent account deletion (store data-deletion requirement).
//
// Order matters: every table that points at the auth user without ON DELETE CASCADE/SET NULL has to be cleared
// before auth.admin.deleteUser, otherwise Supabase answers "Database error deleting user" and the account survives.
// Today that is analytics_events (plain FK to auth.users). Tables with no FK at all (learning_*, shared_notes,
// user_integrations, user_webhooks, challenges) would be orphaned by the auth delete, so they are cleared explicitly.
//
// Files go first: if listing or removing any of them fails, nothing else is touched and the result is not-ok, so the
// user can retry. The result is only `ok: true` when the auth user is really gone, so the route never reports success
// for a half-deleted account. Every step is idempotent: a retry after partial progress finishes the job.

// [table, column]: rows owned by the user. Children of these rows are covered by their own ON DELETE CASCADE
// (notes -> ai_content, recordings, shared_notes, learning_sessions; challenges -> challenge_participants).
const OWNED_TABLES = [
  ['analytics_events', 'user_id'],
  ['challenge_participants', 'user_id'],
  ['challenges', 'creator_user_id'],
  ['learning_lessons', 'user_id'],
  ['learning_sessions', 'user_id'],
  ['shared_notes', 'user_id'],
  ['user_integrations', 'user_id'],
  ['user_webhooks', 'user_id'],
  ['recordings', 'user_id'],
  ['notes', 'user_id'],
  ['usage_logs', 'user_id'],
  ['subscriptions', 'user_id'],
  ['user_profiles', 'user_id'],
  ['profiles', 'id'],
  ['users', 'id']
];

// [bucket, prefix pattern]: where each feature writes user files.
// Every bucket/prefix the backend writes to: storageService (notetaker-files/<uid>/...), meetingService (meetings/),
// aiService + learning route (infographics/), uploads route (uploads/), scanService (scans/), pdfService (pdfs/),
// ttsService (podcasts/, tts/).
const STORAGE_PREFIXES = [
  ['notetaker-files', (id) => `${id}`],
  ['notetaker-files', (id) => `meetings/${id}`],
  ['notetaker-files', (id) => `infographics/${id}`],
  ['documents', (id) => `uploads/${id}`],
  ['documents', (id) => `scans/${id}`],
  ['documents', (id) => `pdfs/${id}`],
  ['audio', (id) => `podcasts/${id}`],
  ['audio', (id) => `tts/${id}`]
];

// Postgres / PostgREST codes for "that table or column does not exist in this environment": nothing to delete there.
const MISSING_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);
const isMissingRelation = (error) => !!error && (MISSING_CODES.has(error.code) || /does not exist|schema cache/i.test(error.message || ''));
const isUserNotFound = (error) => !!error && (error.status === 404 || error.code === 'user_not_found' || /user not found/i.test(error.message || ''));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Delete every object under bucket/prefix (recursing into folders). Returns the number removed. */
async function removeStoragePrefix(storage, bucket, prefix, depth = 0) {
  // Never list a bucket root or a prefix that does not end in a user id.
  if (typeof prefix !== 'string' || !/(^|\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i.test(prefix)) {
    throw new Error('refusing to list a storage prefix that does not contain a user id');
  }
  if (depth > 6) return 0;
  const files = [];
  const folders = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) (entry.id ? files : folders).push(entry.name);
    if (data.length < 100) break;
  }
  let removed = 0;
  for (const folder of folders) removed += await removeStoragePrefix(storage, bucket, `${prefix}/${folder}`, depth + 1);
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100).map((name) => `${prefix}/${name}`);
    if (batch.some((p) => !p.startsWith(`${prefix}/`))) throw new Error('refusing to remove an object outside the user prefix');
    const { error } = await storage.from(bucket).remove(batch);
    if (error) throw error;
    removed += batch.length;
  }
  return removed;
}

/**
 * @param {object} admin  Supabase client with the service role key
 * @param {string} userId auth user id
 * @param {{info?:Function,warn?:Function,error?:Function}} log
 * @returns {Promise<{ok:boolean, authDeleted:boolean, failedSteps:string[], warnings:string[]}>} (throws TypeError for a non-UUID id)
 */
async function deleteAccount(admin, userId, log = console) {
  // Reject anything that is not a UUID before any list/remove: an empty or odd id must never reach a storage prefix.
  if (!isUuid(userId)) throw new TypeError('deleteAccount: userId must be a UUID');
  userId = userId.toLowerCase();

  const failedSteps = [];
  const warnings = [];

  // 1. Files first. Any failure aborts before rows or the auth user are touched, so the request can be retried.
  //    A bucket that does not exist in this environment has nothing to delete.
  for (const [bucket, prefixOf] of STORAGE_PREFIXES) {
    try {
      await removeStoragePrefix(admin.storage, bucket, prefixOf(userId));
    } catch (error) {
      if (/bucket not found/i.test(error.message || '')) continue;
      if (!failedSteps.includes(`storage:${bucket}`)) failedSteps.push(`storage:${bucket}`);
      log.error?.(`storage cleanup failed for bucket ${bucket}: ${error.message}`);
    }
  }
  if (failedSteps.length > 0) return { ok: false, authDeleted: false, failedSteps, warnings };

  // 2. Rows. A real failure stops before the auth delete so the user can retry the whole request.
  for (const [table, column] of OWNED_TABLES) {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (!error) continue;
    if (isMissingRelation(error)) {
      log.warn?.(`skip ${table}.${column}: ${error.message}`);
      continue;
    }
    failedSteps.push(table);
    log.error?.(`delete from ${table} failed: ${error.message}`);
  }
  if (failedSteps.length > 0) return { ok: false, authDeleted: false, failedSteps, warnings };

  // 3. The auth user. Retry once after sweeping analytics_events again: the app can still be posting events while
  //    the request runs, and one such row is enough to make the delete fail on the foreign key.
  let { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError && !isUserNotFound(authError)) {
    log.warn?.(`auth delete failed once (${authError.message}); sweeping analytics_events and retrying`);
    await admin.from('analytics_events').delete().eq('user_id', userId);
    ({ error: authError } = await admin.auth.admin.deleteUser(userId));
  }
  if (authError && !isUserNotFound(authError)) {
    log.error?.(`auth user deletion failed: ${authError.message}`);
    return { ok: false, authDeleted: false, failedSteps: ['auth.users'], warnings };
  }
  return { ok: true, authDeleted: true, failedSteps: [], warnings };
}

module.exports = { deleteAccount, isUuid, removeStoragePrefix, OWNED_TABLES, STORAGE_PREFIXES };
