// Removes the stored files that belong to ONE note when that note is deleted.
//
// Files that hang off a note:
//   - the audio recording(s): recordings.note_id = note (or the id in note.metadata.recording_id), file at recordings.storage_path
//   - the uploaded / scanned document: note.metadata.file_path (uploads/, pdfs/) or note.metadata.storage_path (scans/)
//   - files generated from the note: text-to-speech audio, podcast audio, infographic (ai_content rows of the note)
//
// Safety rules, because note.metadata is client-controlled text and the storage client runs with the service role:
//   - a path is only accepted if it sits under the expected prefix FOR THIS USER (and, for generated files, THIS NOTE).
//     A forged metadata.file_path that points at another user's file, or contains "..", is ignored.
//   - nothing is ever listed or removed by prefix, only exact object paths that passed the checks.
//   - removing is best effort: an object that is already gone is not an error, and a storage failure is logged
//     (with the paths, so they can be swept) but never thrown, so the note delete itself is not blocked.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const DOCUMENTS_BUCKET = 'documents';
const AUDIO_BUCKET = 'audio';
const FILES_BUCKET = () => process.env.SUPABASE_STORAGE_BUCKET || 'notetaker-files';

/** A usable object path: relative, no empty / dot segments, no backslashes, not a folder. */
function isCleanPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024) return false;
  if (p.startsWith('/') || p.endsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Pull `<bucket>` and `<path>` out of a Supabase public object URL, or null. */
function parsePublicUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /\/storage\/v1\/object\/public\/([^/]+)\/([^?#]+)/.exec(url);
  if (!m) return null;
  let path;
  try { path = decodeURIComponent(m[2]); } catch { return null; }
  return { bucket: m[1], path };
}

/**
 * Collect the exact objects that belong to this note. Throws only if a database lookup fails (the caller then
 * leaves the note alone so the request can be retried).
 * @returns {Promise<{files: Array<{bucket:string,path:string}>, recordingIds: string[]}>}
 */
async function collectNoteFiles(admin, userId, note, log = console) {
  if (!isUuid(userId) || !note || !isUuid(note.id)) return { files: [], recordingIds: [] };
  const uid = userId.toLowerCase();
  const nid = note.id.toLowerCase();
  const seen = new Set();
  const files = [];
  const add = (bucket, path) => {
    if (!isCleanPath(path)) return;
    const key = `${bucket}/${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ bucket, path });
  };

  // Documents: only the three prefixes the backend writes document uploads to, scoped to this user.
  const meta = note.metadata && typeof note.metadata === 'object' ? note.metadata : {};
  for (const candidate of [meta.file_path, meta.storage_path]) {
    if (typeof candidate !== 'string') continue;
    if (['uploads', 'pdfs', 'scans'].some((dir) => candidate.startsWith(`${dir}/${uid}/`))) add(DOCUMENTS_BUCKET, candidate);
  }

  // Audio recordings linked to the note (row owned by the same user), plus the one the note was transcribed from.
  const recordingIds = [];
  const { data: linked, error: linkedErr } = await admin
    .from('recordings').select('id, storage_path').eq('note_id', nid).eq('user_id', uid);
  if (linkedErr) throw linkedErr;
  let recs = linked || [];
  if (isUuid(meta.recording_id)) {
    const { data: source, error: sourceErr } = await admin
      .from('recordings').select('id, storage_path').eq('id', meta.recording_id).eq('user_id', uid);
    if (sourceErr) throw sourceErr;
    recs = recs.concat(source || []);
  }
  for (const r of recs) {
    if (isUuid(r.id) && !recordingIds.includes(r.id)) recordingIds.push(r.id);
    if (typeof r.storage_path === 'string' && r.storage_path.startsWith(`${uid}/recordings/`)) add(FILES_BUCKET(), r.storage_path);
  }

  // Files generated from the note. The path must carry this user's id AND this note's id.
  const { data: contents, error: contentErr } = await admin.from('ai_content').select('content').eq('note_id', nid);
  if (contentErr) {
    // A deployment without the table cannot have generated files; anything else is a real failure.
    if (!/does not exist|schema cache/i.test(contentErr.message || '') && !['42P01', 'PGRST205'].includes(contentErr.code)) throw contentErr;
    log.warn?.(`ai_content lookup skipped: ${contentErr.message}`);
  }
  for (const row of contents || []) {
    const c = row && row.content && typeof row.content === 'object' ? row.content : {};
    for (const url of [c.audio_url, c.image_url]) {
      const parsed = parsePublicUrl(url);
      if (!parsed) continue;
      const { bucket, path } = parsed;
      if (bucket === AUDIO_BUCKET && (path.startsWith(`tts/${uid}/${nid}-`) || path.startsWith(`podcasts/${uid}/${nid}_`))) add(bucket, path);
      else if (bucket === FILES_BUCKET() && path.startsWith(`infographics/${uid}/${nid}/`)) add(bucket, path);
    }
  }

  return { files, recordingIds };
}

/**
 * Remove the collected objects. Never throws. A missing object / bucket counts as already removed.
 * @returns {Promise<{removed:number, failed:Array<{bucket:string,path:string,error:string}>}>}
 */
async function removeFiles(admin, files, log = console) {
  const byBucket = new Map();
  for (const f of files) {
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
    byBucket.get(f.bucket).push(f.path);
  }
  let removed = 0;
  const failed = [];
  for (const [bucket, paths] of byBucket) {
    try {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error && !/not found|does not exist/i.test(error.message || '')) {
        for (const path of paths) failed.push({ bucket, path, error: error.message });
      } else {
        removed += paths.length;
      }
    } catch (error) {
      for (const path of paths) failed.push({ bucket, path, error: error.message });
    }
  }
  if (failed.length) {
    log.error?.(`note file cleanup: ${failed.length} file(s) could not be removed and are orphaned: ${JSON.stringify(failed)}`);
  }
  return { removed, failed };
}

module.exports = { collectNoteFiles, removeFiles, isCleanPath, parsePublicUrl, isUuid };
