/**
 * Writes a transcript for a YouTube video that has no captions (Supadata, mode=generate), within hard limits:
 *   - videos up to 20 minutes (length unknown = refused)
 *   - 3 per user per rolling 24 hours
 *   - 3,000 credits per calendar month (UTC), counted in public.transcript_generations
 *   - only while the plan keeps at least YOUTUBE_GENERATE_MIN_BALANCE credits spare, so it never runs into extra charges
 *   - OFF unless YOUTUBE_GENERATE_ENABLED=true (the kill switch)
 * The per-user and monthly limits are reserved in one database call (reserve_transcript_generation) BEFORE any
 * generation is paid for. If that cannot be done, nothing is generated.
 *
 * Generation often takes minutes, longer than an app waits, so it runs as a job: the request waits for a while, and the
 * note is saved when the job ends. Asking again joins the running job, resumes the vendor job, or returns the saved note.
 */
const { logger } = require('../utils/logger');
const { reportFailure, reportCounted } = require('../utils/failureReporter');
const { TranscriptError } = require('../utils/transcriptError');
const { createSupadataClient } = require('./supadataClient');

const DAY_MS = 24 * 3600 * 1000;
const NO_JOB_PENDING_MS = 10 * 60_000; // a reservation without a vendor job id older than this is dead
const JOB_RESUME_MS = 70 * 60_000;     // vendor job results expire an hour after they finish
const WARN_SHARE = 0.8;

const positive = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

function getGenerationConfig(env = process.env) {
  return {
    enabled: String(env.YOUTUBE_GENERATE_ENABLED || '').trim().toLowerCase() === 'true',
    maxSeconds: Math.min(positive(env.YOUTUBE_GENERATE_MAX_MINUTES, 20), 20) * 60,
    userDaily: positive(env.YOUTUBE_GENERATE_PER_USER_PER_DAY, 3),
    monthlyCredits: positive(env.YOUTUBE_GENERATE_MONTHLY_CREDITS, 3000),
    minBalance: positive(env.YOUTUBE_GENERATE_MIN_BALANCE, 1000),
  };
}

/** Credits one generation can cost: 2 per started minute, plus 1 for looking up the length. */
const estimateCredits = (seconds) => Math.ceil(seconds / 60) * 2 + 1;

function defaultLedger() {
  const { supabaseAdmin } = require('../config/supabase');
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async latest(userId, videoId, since) {
      const rows = check(await supabaseAdmin.from('transcript_generations')
        .select('id, status, job_id, note_id, created_at')
        .eq('user_id', userId).eq('video_id', videoId).in('status', ['pending', 'done']).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(1));
      return rows?.[0] || null;
    },
    async reserve({ userId, videoId, durationSeconds, credits, userDaily, monthlyCredits }) {
      return check(await supabaseAdmin.rpc('reserve_transcript_generation', {
        p_user: userId, p_video: videoId, p_duration: Math.round(durationSeconds), p_credits: credits,
        p_user_daily: userDaily, p_monthly_cap: monthlyCredits,
      }));
    },
    async update(id, patch) {
      check(await supabaseAdmin.from('transcript_generations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
    },
    async findNote(userId, noteId) {
      return check(await supabaseAdmin.from('notes').select('*').eq('id', noteId).eq('user_id', userId).maybeSingle());
    },
  };
}

function createTranscriptGeneration({ supadata, ledger, env = process.env, now = Date.now } = {}) {
  const jobs = new Map();
  const key = (userId, videoId) => `${userId}|${videoId}`;
  let client = supadata || null;
  let book = ledger || null;
  const vendor = () => (client ||= createSupadataClient());
  const db = () => (book ||= defaultLedger());

  /** Bookkeeping after money may have been spent must never lose the note, but must not fail quietly either. */
  async function write(id, patch) {
    try { await db().update(id, patch); } catch (error) {
      logger.error('Transcript ledger write failed', { id, error: error.message });
      reportCounted('youtube_generate_ledger', 'Transcript generation could not be written to its ledger', { status: String(patch.status || 'pending') });
    }
  }

  /** A vendor or database problem before anything is generated. */
  function unavailable(reason, context = {}) {
    logger.error('Transcript generation unavailable', { reason, ...context });
    reportCounted('youtube_generate_blocked', `Transcript generation blocked: ${reason}`, { reason });
    return new TranscriptError('NO_CAPTIONS_UNAVAILABLE');
  }

  async function finish(row, obtain, { userId, videoId, saveNote }, cost) {
    let got;
    try {
      got = await obtain();
    } catch (error) {
      // Where the answer says what was charged, record that (plus 1 for the length lookup) instead of the estimate. A
      // request the vendor refused cost nothing, and does not use up the user's allowance either.
      const billed = typeof error.billed === 'number' ? error.billed : null;
      await write(row.id, { status: billed === 0 ? 'released' : 'failed', error_code: String(error.code || 'unknown'), ...(billed === null ? {} : { credits: 1 + billed }) });
      logger.error('Transcript generation failed', { userId, videoId, code: error.code, error: error.message });
      // "No transcript available" from a generation means there is nothing to hear in the video.
      throw new TranscriptError(error.code === 'transcript-unavailable' ? 'NO_SPEECH' : 'TRANSCRIPT_FAILED');
    }
    if (!got.content || !got.content.trim()) {
      await write(row.id, { status: 'failed', error_code: 'NO_SPEECH' });
      throw new TranscriptError('NO_SPEECH');
    }
    let note;
    try {
      note = await saveNote(got.content, got.lang);
    } catch (error) {
      await write(row.id, { status: 'failed', error_code: 'NOTE_SAVE_FAILED' });
      throw error;
    }
    await write(row.id, { status: 'done', note_id: note.id });
    logger.info('Transcript generated: cost', { userId, videoId, characters: got.content.length, ...cost });
    return { note, reused: false };
  }

  async function run(args) {
    const { userId, videoId } = args;
    const cfg = getGenerationConfig(env);
    if (!cfg.enabled) throw new TranscriptError('NO_CAPTIONS_UNAVAILABLE');

    let prior;
    try { prior = await db().latest(userId, videoId, new Date(now() - DAY_MS).toISOString()); } catch (error) { throw unavailable('ledger', { error: error.message }); }
    if (prior?.status === 'done' && prior.note_id) {
      const note = await db().findNote(userId, prior.note_id);
      if (note) return { note, reused: true };
    }
    if (prior?.status === 'pending') {
      const age = now() - Date.parse(prior.created_at);
      if (prior.job_id && age < JOB_RESUME_MS) return finish(prior, () => vendor().pollJob(prior.job_id), args, { resumed: true });
      if (!prior.job_id && age < NO_JOB_PENDING_MS) throw new TranscriptError('TRANSCRIPT_PENDING');
      await write(prior.id, { status: 'failed', error_code: 'STALE' });
    }

    let meta;
    let balance;
    try {
      meta = await vendor().metadata(videoId);
    } catch (error) {
      if (['not-found', 'forbidden'].includes(error.code)) throw new TranscriptError('VIDEO_UNAVAILABLE');
      throw unavailable('metadata', { videoId, code: error.code });
    }
    if (meta.type !== 'video' || !(meta.durationSeconds > 0)) throw new TranscriptError('NO_TRANSCRIPT');
    if (meta.durationSeconds > cfg.maxSeconds) throw new TranscriptError('NO_CAPTIONS_TOO_LONG');

    const credits = estimateCredits(meta.durationSeconds);
    try { balance = await vendor().balance(); } catch (error) { throw unavailable('balance', { code: error.code }); }
    if (!(balance.max - balance.used - credits >= cfg.minBalance)) throw unavailable('low_balance', { used: balance.used, max: balance.max });

    let reservation;
    try {
      reservation = await db().reserve({ userId, videoId, durationSeconds: meta.durationSeconds, credits, userDaily: cfg.userDaily, monthlyCredits: cfg.monthlyCredits });
    } catch (error) { throw unavailable('ledger', { error: error.message }); }
    if (!reservation?.ok) {
      if (reservation?.reason === 'pending') throw new TranscriptError('TRANSCRIPT_PENDING');
      if (reservation?.reason === 'user_daily') {
        const wait = reservation.retry_at ? Math.max(1, Math.ceil((Date.parse(reservation.retry_at) - now()) / 1000)) : null;
        const { waitText } = require('../middleware/freeTierLimits');
        reportCounted('free_tier_limit', 'Free-tier limit reached: youtube_generate', { scope: 'youtube_generate', limit: String(cfg.userDaily) });
        throw new TranscriptError('GENERATE_LIMIT_REACHED', {
          message: `This video has no captions, and you have used today's ${cfg.userDaily} transcripts for videos without captions. ${wait ? `You can try again in ${waitText(wait)}` : 'Try again later'}, or use a video with captions.`,
          details: { scope: 'youtube_generate', limit: cfg.userDaily, retryAfterSeconds: wait, upgradeRequired: false },
        });
      }
      throw unavailable('monthly_cap', { monthCredits: reservation?.month_credits, cap: cfg.monthlyCredits });
    }
    if (reservation.month_credits >= cfg.monthlyCredits * WARN_SHARE) {
      reportCounted('youtube_generate_budget', 'Transcript generation has used 80% of its monthly credits', { used: String(reservation.month_credits), cap: String(cfg.monthlyCredits) });
    }
    const cost = { videoSeconds: Math.round(meta.durationSeconds), credits, monthCredits: reservation.month_credits, monthCap: cfg.monthlyCredits };
    logger.info('Transcript generation started', { userId, videoId, ...cost });

    return finish({ id: reservation.id }, async () => {
      const started = await vendor().transcript(videoId, 'generate');
      if (started.billed !== null && started.billed !== undefined) cost.vendorCredits = started.billed;
      if (!started.jobId) return started;
      await write(reservation.id, { job_id: started.jobId });
      return vendor().pollJob(started.jobId);
    }, args, cost);
  }

  return {
    isRunning: (userId, videoId) => jobs.has(key(userId, videoId)),
    /** The note already made from a generated transcript of this video in the last day, or null. Never throws. */
    async savedNote(userId, videoId) {
      try {
        const prior = await db().latest(userId, videoId, new Date(now() - DAY_MS).toISOString());
        return prior?.status === 'done' && prior.note_id ? await db().findNote(userId, prior.note_id) : null;
      } catch (error) {
        logger.warn('Could not look for an earlier generated note', { userId, videoId, error: error.message });
        return null;
      }
    },
    /** Start (or join) the job for this user and video. Resolves { note, reused } or rejects with a TranscriptError. */
    start(args) {
      const k = key(args.userId, args.videoId);
      if (jobs.has(k)) return jobs.get(k);
      const job = run(args)
        .catch(async (error) => {
          // The caller may be gone: a failed or unsaved transcript is reported from here.
          if (!(error instanceof TranscriptError) || error.publicCode === 'TRANSCRIPT_FAILED') {
            await reportFailure('youtube_transcript_failed', new Error('YouTube transcript generation failed'), { code: String(error.publicCode || error.code || 'INTERNAL') });
          }
          throw error;
        })
        .finally(() => jobs.delete(k));
      job.catch(() => {}); // handled above; nobody may be waiting any more
      jobs.set(k, job);
      return job;
    },
  };
}

module.exports = { createTranscriptGeneration, getGenerationConfig, estimateCredits };
