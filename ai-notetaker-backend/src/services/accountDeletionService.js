// Permanent account deletion (store data-deletion requirement).
//
// Order matters: every table that points at the auth user without ON DELETE CASCADE/SET NULL has to be cleared
// before auth.admin.deleteUser, otherwise Supabase answers "Database error deleting user" and the account survives.
// Today that is analytics_events (plain FK to auth.users). Tables with no FK at all (learning_*, shared_notes,
// user_integrations, user_webhooks, challenges) would be orphaned by the auth delete, so they are cleared explicitly.
//
// The result is only `ok: true` when the auth user is really gone, so the route never reports success for a
// half-deleted account. Every step is idempotent, so a failed request can simply be retried.

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
const STORAGE_PREFIXES = [
  ['notetaker-files', (id) => `${id}`],
  ['notetaker-files', (id) => `meetings/${id}`],
  ['notetaker-files', (id) => `infographics/${id}`],
  ['documents', (id) => `uploads/${id}`],
  ['documents', (id) => `scans/${id}`],
  ['audio', (id) => `podcasts/${id}`],
  ['audio', (id) => `tts/${id}`]
];

// Postgres / PostgREST codes for "that table or column does not exist in this environment": nothing to delete there.
const MISSING_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);
const isMissingRelation = (error) => !!error && (MISSING_CODES.has(error.code) || /does not exist|schema cache/i.test(error.message || ''));
const isUserNotFound = (error) => !!error && (error.status === 404 || error.code === 'user_not_found' || /user not found/i.test(error.message || ''));

/** Delete every object under bucket/prefix (recursing into folders). Returns the number removed. */
async function removeStoragePrefix(storage, bucket, prefix, depth = 0) {
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
 * @returns {Promise<{ok:boolean, authDeleted:boolean, failedSteps:string[], warnings:string[]}>}
 */
async function deleteAccount(admin, userId, log = console) {
  const failedSteps = [];
  const warnings = [];

  // 1. Files. A failure here must not strand the account, but it is reported.
  for (const [bucket, prefixOf] of STORAGE_PREFIXES) {
    try {
      await removeStoragePrefix(admin.storage, bucket, prefixOf(userId));
    } catch (error) {
      if (/not found|does not exist/i.test(error.message || '')) continue;
      warnings.push(`storage:${bucket}`);
      log.error?.(`storage cleanup failed for bucket ${bucket}: ${error.message}`);
    }
  }

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

module.exports = { deleteAccount, removeStoragePrefix, OWNED_TABLES, STORAGE_PREFIXES };
