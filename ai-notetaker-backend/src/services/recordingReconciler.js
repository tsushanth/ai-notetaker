/**
 * End-to-end invariant for the upload -> transcribe pipeline (pattern: MeetingMind
 * orphanedProcessingRecovery + recordingFailure). Every RECONCILE_INTERVAL_MS it looks at the
 * recordings table and emails (through the failure reporter) when:
 *   - STUCK_PROCESSING   a row sits in 'processing' past PROCESSING_STUCK_MIN (process killed by a deploy/OOM,
 *                         nothing resumes it). The row is moved to 'failed' with a clear error_message (compare-and-set).
 *   - STUCK_UPLOADED     a row was created in the last UPLOADED_LOOKBACK_H hours and is still 'uploaded' after
 *                         UPLOADED_STUCK_MIN: the file arrived but transcription never started. Report only, not mutated.
 *   - ZERO_COMPLETED_24H recordings were created in the last 24 h and none completed.
 *   - PIPELINE_DEADMAN   uploads exist in the last DEADMAN_DAYS days but zero recordings completed in that window.
 *   The last two only count "pipeline-relevant" uploads: a recording that failed with NO_SPEECH is a property of the
 *   audio (silence), not of the pipeline, and a row still inside its normal processing time is in flight. They also
 *   need at least MIN_ATTEMPTS such uploads from at least MIN_USERS distinct users, so a low-traffic app (a few
 *   uploads a month) does not page because one user recorded silence. Individual failures still page one by one
 *   through recording_failed in transcriptionService, so a single real provider error is never hidden by this.
 * Messages are fixed per code; context carries counts only (no ids, titles, users). Per-code cooldown keeps one
 * email per COOLDOWN_H per process (the Worker dedupes per hour on top). Fire-and-forget; never throws.
 */
const { logger } = require('../utils/logger');
const { reportFailure } = require('../utils/failureReporter');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CFG = {
  intervalMs: 10 * MIN,
  processingStuckMin: 20,
  uploadedStuckMin: 60,
  uploadedLookbackH: 24,
  deadmanDays: 3,
  minAttempts: 3,
  minUsers: 2,
  cooldownH: 12,
  maxFailPerPass: 5,
};

const MESSAGES = {
  STUCK_PROCESSING: 'Recording stuck in processing (marked failed)',
  STUCK_UPLOADED: 'Recording uploaded but transcription never started',
  ZERO_COMPLETED_24H: 'Recordings created in the last 24h but none completed',
  PIPELINE_DEADMAN: 'No successful transcription in days while uploads exist',
  RECONCILER_QUERY_FAILED: 'Recording reconciler could not read the recordings table',
};

const lastReported = new Map();

function shouldReport(code, now) {
  const last = lastReported.get(code);
  if (last != null && now - last < CFG.cooldownH * HOUR) return false;
  lastReported.set(code, now);
  return true;
}

function emit(code, context, now) {
  if (!shouldReport(code, now)) return false;
  try {
    reportFailure('recording_reconcile', new Error(MESSAGES[code]), { code, ...context });
  } catch (e) { logger.warn('Reconciler report threw', { error: e.message }); }
  return true;
}

// Failures that describe the recording, not the pipeline (silence/noise). Matches the current
// "NO_SPEECH: audio ..." form and the older "No speech detected in the recording" text.
function isUserCausedFailure(r) {
  return r.status === 'failed' && /^(NO_SPEECH\b|No speech detected)/i.test(String(r.error_message || ''));
}

/**
 * Pure evaluation. rows: [{id,status,created_at,updated_at,user_id?,error_message?}] created within the lookback;
 * completedInDeadmanWindow: number.
 */
function evaluate(rows, completedInDeadmanWindow, now = Date.now()) {
  const t = (v) => new Date(v).getTime();
  // Uploads that say something about pipeline health: not silence, not still in flight.
  const relevant = (r) => !isUserCausedFailure(r)
    && !(r.status === 'processing' && now - t(r.updated_at) <= CFG.processingStuckMin * MIN)
    && !(r.status === 'uploaded' && now - t(r.updated_at) <= CFG.uploadedStuckMin * MIN);
  const enough = (list) => list.length >= CFG.minAttempts
    && new Set(list.map((r) => r.user_id ?? r.id)).size >= CFG.minUsers;
  const stuckProcessing = rows.filter((r) => r.status === 'processing' && now - t(r.updated_at) > CFG.processingStuckMin * MIN);
  const stuckUploaded = rows.filter((r) => r.status === 'uploaded'
    && now - t(r.created_at) < CFG.uploadedLookbackH * HOUR
    && now - t(r.updated_at) > CFG.uploadedStuckMin * MIN);
  const last24 = rows.filter((r) => now - t(r.created_at) < DAY);
  const created24 = last24.length;
  const completed24 = last24.filter((r) => r.status === 'completed').length;
  const failed24 = last24.filter((r) => r.status === 'failed').length;
  const relevant24 = last24.filter(relevant);
  const relevantDeadman = rows.filter((r) => now - t(r.created_at) < CFG.deadmanDays * DAY && relevant(r));
  const inDeadman = relevantDeadman.length;
  return {
    stuckProcessing,
    stuckUploadedCount: stuckUploaded.length,
    created24, completed24, failed24,
    zeroCompleted24h: enough(relevant24) && completed24 === 0,
    deadman: enough(relevantDeadman) && completedInDeadmanWindow === 0,
    uploadsInDeadmanWindow: inDeadman,
  };
}

async function markStuckFailed(db, row, now) {
  const { data, error } = await db
    .from('recordings')
    .update({
      status: 'failed',
      error_message: 'PROCESSING_INTERRUPTED: transcription did not finish (server restart or timeout). Please retry.',
    })
    .eq('id', row.id)
    .eq('status', 'processing')
    .eq('updated_at', row.updated_at)
    .select('id');
  if (error) { logger.error('Reconciler could not mark stuck recording failed', { error: error.message }); return false; }
  return Array.isArray(data) && data.length > 0;
}

/** One pass. `db` is a supabase admin client (injectable for tests). Returns the evaluation for tests/logs. */
async function reconcileRecordings({ db, now = Date.now() } = {}) {
  try {
    const client = db || require('../config/supabase').supabaseAdmin;
    const since = new Date(now - Math.max(CFG.deadmanDays * DAY, CFG.uploadedLookbackH * HOUR, DAY)).toISOString();
    const { data: rows, error } = await client
      .from('recordings')
      .select('id, user_id, status, error_message, created_at, updated_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000);
    // Also pick up rows created earlier that are still 'processing' (a very old orphan).
    const { data: oldProcessing } = await client
      .from('recordings').select('id, status, created_at, updated_at').eq('status', 'processing').lt('created_at', since).limit(50);
    const { count, error: cErr } = await client
      .from('recordings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('updated_at', new Date(now - CFG.deadmanDays * DAY).toISOString());
    if (error || cErr) {
      logger.error('Reconciler query failed', { error: (error || cErr).message });
      emit('RECONCILER_QUERY_FAILED', {}, now);
      return null;
    }

    const all = [...(rows || []), ...(oldProcessing || [])];
    const ev = evaluate(all, count || 0, now);

    if (ev.stuckProcessing.length) {
      let fixed = 0;
      for (const r of ev.stuckProcessing.slice(0, CFG.maxFailPerPass)) {
        if (await markStuckFailed(client, r, now)) fixed += 1;
      }
      emit('STUCK_PROCESSING', { stuck_count: String(ev.stuckProcessing.length), marked_failed: String(fixed), threshold_min: String(CFG.processingStuckMin) }, now);
    }
    if (ev.stuckUploadedCount) {
      emit('STUCK_UPLOADED', { stuck_count: String(ev.stuckUploadedCount), threshold_min: String(CFG.uploadedStuckMin) }, now);
    }
    if (ev.zeroCompleted24h) {
      emit('ZERO_COMPLETED_24H', { created_24h: String(ev.created24), failed_24h: String(ev.failed24), completed_24h: '0' }, now);
    }
    if (ev.deadman) {
      emit('PIPELINE_DEADMAN', { uploads_in_window: String(ev.uploadsInDeadmanWindow), window_days: String(CFG.deadmanDays), completed: '0' }, now);
    }
    return ev;
  } catch (e) {
    logger.error('Reconciler threw', { error: e.message });
    try { emit('RECONCILER_QUERY_FAILED', {}, now); } catch { /* ignore */ }
    return null;
  }
}

let timer = null;
function startRecordingReconciler() {
  if (timer || process.env.RECONCILER_DISABLED === '1' || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return;
  // Delay the first pass so a deploy that interrupted work is seen as stuck, not racing the restart.
  setTimeout(() => { void reconcileRecordings(); }, 2 * MIN).unref();
  timer = setInterval(() => { void reconcileRecordings(); }, CFG.intervalMs);
  timer.unref();
  logger.info('Recording reconciler started', { intervalMin: CFG.intervalMs / MIN });
}

function _resetForTests() { lastReported.clear(); }

module.exports = { reconcileRecordings, evaluate, startRecordingReconciler, CFG, MESSAGES, _resetForTests };
