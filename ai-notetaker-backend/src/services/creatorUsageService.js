/**
 * Creator Usage Service
 * Tracks and enforces usage limits for creators to prevent abuse
 *
 * LIMITS (configurable per creator):
 * - 500 generations/month
 * - 50 generations/day
 * - 16k output tokens per request
 * - 100k input tokens per request
 * - Cooldowns after large jobs (1 min for jobs > 8k tokens)
 * - Queue for extremely large tasks (> 50k tokens)
 *
 * These limits won't affect normal creators but stop farm abuse.
 */

const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

// Default limits (can be overridden per creator)
const DEFAULT_LIMITS = {
  maxGenerationsPerMonth: 500,
  maxGenerationsPerDay: 50,
  maxInputTokens: 100000,
  maxOutputTokens: 16000,
  cooldownAfterLargeJobSeconds: 60,
  largeJobThresholdTokens: 8000,
  queueThresholdTokens: 50000,
  maxQueuedJobs: 5,
  maxPodcastPerMonth: 100,
  maxVideoProcessingPerMonth: 50,
};

// Usage types that count toward generation limits
const GENERATION_TYPES = [
  'ai_summary',
  'ai_quiz',
  'ai_flashcards',
  'ai_podcast',
  'ai_diagram',
  'ai_chat',
];

/**
 * Get limits for a creator (custom or default)
 */
async function getCreatorLimits(creatorId) {
  // First try to get custom limits for this creator
  const { data: customLimits } = await supabaseAdmin
    .from('creator_usage_limits')
    .select('*')
    .eq('creator_id', creatorId)
    .single();

  if (customLimits) {
    return {
      maxGenerationsPerMonth: customLimits.max_generations_per_month,
      maxGenerationsPerDay: customLimits.max_generations_per_day,
      maxInputTokens: customLimits.max_input_tokens,
      maxOutputTokens: customLimits.max_output_tokens,
      cooldownAfterLargeJobSeconds: customLimits.cooldown_after_large_job_seconds,
      largeJobThresholdTokens: customLimits.large_job_threshold_tokens,
      queueThresholdTokens: customLimits.queue_threshold_tokens,
      maxQueuedJobs: customLimits.max_queued_jobs,
      maxPodcastPerMonth: customLimits.max_podcast_per_month,
      maxVideoProcessingPerMonth: customLimits.max_video_processing_per_month,
    };
  }

  // Fall back to default limits
  const { data: defaultLimits } = await supabaseAdmin
    .from('creator_usage_limits')
    .select('*')
    .eq('is_default', true)
    .single();

  if (defaultLimits) {
    return {
      maxGenerationsPerMonth: defaultLimits.max_generations_per_month,
      maxGenerationsPerDay: defaultLimits.max_generations_per_day,
      maxInputTokens: defaultLimits.max_input_tokens,
      maxOutputTokens: defaultLimits.max_output_tokens,
      cooldownAfterLargeJobSeconds: defaultLimits.cooldown_after_large_job_seconds,
      largeJobThresholdTokens: defaultLimits.large_job_threshold_tokens,
      queueThresholdTokens: defaultLimits.queue_threshold_tokens,
      maxQueuedJobs: defaultLimits.max_queued_jobs,
      maxPodcastPerMonth: defaultLimits.max_podcast_per_month,
      maxVideoProcessingPerMonth: defaultLimits.max_video_processing_per_month,
    };
  }

  return DEFAULT_LIMITS;
}

/**
 * Get current usage stats for a creator
 */
async function getCreatorUsageStats(creatorId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Get today's generations
  const { count: generationsToday } = await supabaseAdmin
    .from('creator_usage')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', startOfDay.toISOString())
    .eq('status', 'completed')
    .in('usage_type', GENERATION_TYPES);

  // Get this month's generations
  const { count: generationsThisMonth } = await supabaseAdmin
    .from('creator_usage')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', startOfMonth.toISOString())
    .eq('status', 'completed')
    .in('usage_type', GENERATION_TYPES);

  // Get token usage today
  const { data: tokenDataToday } = await supabaseAdmin
    .from('creator_usage')
    .select('tokens_used')
    .eq('creator_id', creatorId)
    .gte('created_at', startOfDay.toISOString())
    .eq('status', 'completed');

  const tokensToday = tokenDataToday?.reduce((sum, r) => sum + (r.tokens_used || 0), 0) || 0;

  // Get token usage this month
  const { data: tokenDataMonth } = await supabaseAdmin
    .from('creator_usage')
    .select('tokens_used')
    .eq('creator_id', creatorId)
    .gte('created_at', startOfMonth.toISOString())
    .eq('status', 'completed');

  const tokensThisMonth = tokenDataMonth?.reduce((sum, r) => sum + (r.tokens_used || 0), 0) || 0;

  // Get podcasts this month
  const { count: podcastsThisMonth } = await supabaseAdmin
    .from('creator_usage')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', startOfMonth.toISOString())
    .eq('usage_type', 'ai_podcast')
    .eq('status', 'completed');

  // Get video processing this month
  const { count: videoProcessingThisMonth } = await supabaseAdmin
    .from('creator_usage')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .gte('created_at', startOfMonth.toISOString())
    .eq('usage_type', 'video_processing')
    .eq('status', 'completed');

  // Get active cooldown
  const { data: cooldown } = await supabaseAdmin
    .from('creator_cooldowns')
    .select('expires_at, cooldown_type, reason')
    .eq('creator_id', creatorId)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .single();

  // Get queued jobs count
  const { count: queuedJobsCount } = await supabaseAdmin
    .from('creator_job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', creatorId)
    .eq('status', 'queued');

  return {
    generationsToday: generationsToday || 0,
    generationsThisMonth: generationsThisMonth || 0,
    tokensToday,
    tokensThisMonth,
    podcastsThisMonth: podcastsThisMonth || 0,
    videoProcessingThisMonth: videoProcessingThisMonth || 0,
    activeCooldown: cooldown || null,
    queuedJobsCount: queuedJobsCount || 0,
  };
}

/**
 * Check if a creator can perform a generation
 * Returns { allowed: boolean, reason?: string, shouldQueue?: boolean }
 */
async function checkUsageLimits(creatorId, usageType, estimatedTokens = 0) {
  const limits = await getCreatorLimits(creatorId);
  const stats = await getCreatorUsageStats(creatorId);

  // Check if creator is flagged for abuse
  const { data: creator } = await supabaseAdmin
    .from('creators')
    .select('abuse_flagged')
    .eq('id', creatorId)
    .single();

  if (creator?.abuse_flagged) {
    return {
      allowed: false,
      reason: 'Account flagged for abuse. Please contact support.',
      errorCode: 'ABUSE_FLAGGED',
    };
  }

  // Check active cooldown
  if (stats.activeCooldown) {
    const expiresAt = new Date(stats.activeCooldown.expires_at);
    const secondsRemaining = Math.ceil((expiresAt - new Date()) / 1000);

    return {
      allowed: false,
      reason: `Please wait ${secondsRemaining} seconds before your next request.`,
      errorCode: 'COOLDOWN_ACTIVE',
      cooldownExpiresAt: stats.activeCooldown.expires_at,
      secondsRemaining,
    };
  }

  // Check daily limit
  if (GENERATION_TYPES.includes(usageType)) {
    if (stats.generationsToday >= limits.maxGenerationsPerDay) {
      return {
        allowed: false,
        reason: `Daily limit reached (${limits.maxGenerationsPerDay} generations/day). Resets at midnight UTC.`,
        errorCode: 'DAILY_LIMIT_REACHED',
        limit: limits.maxGenerationsPerDay,
        current: stats.generationsToday,
      };
    }

    // Check monthly limit
    if (stats.generationsThisMonth >= limits.maxGenerationsPerMonth) {
      return {
        allowed: false,
        reason: `Monthly limit reached (${limits.maxGenerationsPerMonth} generations/month). Resets on the 1st.`,
        errorCode: 'MONTHLY_LIMIT_REACHED',
        limit: limits.maxGenerationsPerMonth,
        current: stats.generationsThisMonth,
      };
    }
  }

  // Check podcast-specific limit
  if (usageType === 'ai_podcast') {
    if (stats.podcastsThisMonth >= limits.maxPodcastPerMonth) {
      return {
        allowed: false,
        reason: `Podcast limit reached (${limits.maxPodcastPerMonth}/month). Resets on the 1st.`,
        errorCode: 'PODCAST_LIMIT_REACHED',
        limit: limits.maxPodcastPerMonth,
        current: stats.podcastsThisMonth,
      };
    }
  }

  // Check video processing limit
  if (usageType === 'video_processing') {
    if (stats.videoProcessingThisMonth >= limits.maxVideoProcessingPerMonth) {
      return {
        allowed: false,
        reason: `Video processing limit reached (${limits.maxVideoProcessingPerMonth}/month). Resets on the 1st.`,
        errorCode: 'VIDEO_LIMIT_REACHED',
        limit: limits.maxVideoProcessingPerMonth,
        current: stats.videoProcessingThisMonth,
      };
    }
  }

  // Check input token limit
  if (estimatedTokens > limits.maxInputTokens) {
    return {
      allowed: false,
      reason: `Input too large (${estimatedTokens} tokens). Maximum is ${limits.maxInputTokens} tokens.`,
      errorCode: 'INPUT_TOO_LARGE',
      limit: limits.maxInputTokens,
      requested: estimatedTokens,
    };
  }

  // Check if job should be queued (very large tasks)
  if (estimatedTokens > limits.queueThresholdTokens) {
    // Check queue limit
    if (stats.queuedJobsCount >= limits.maxQueuedJobs) {
      return {
        allowed: false,
        reason: `Queue full (${limits.maxQueuedJobs} jobs). Please wait for current jobs to complete.`,
        errorCode: 'QUEUE_FULL',
        queuedJobs: stats.queuedJobsCount,
        maxQueuedJobs: limits.maxQueuedJobs,
      };
    }

    return {
      allowed: true,
      shouldQueue: true,
      reason: 'Large task will be queued for processing.',
      estimatedWaitMinutes: (stats.queuedJobsCount + 1) * 5,
    };
  }

  return {
    allowed: true,
    shouldQueue: false,
    remainingToday: limits.maxGenerationsPerDay - stats.generationsToday,
    remainingThisMonth: limits.maxGenerationsPerMonth - stats.generationsThisMonth,
  };
}

/**
 * Record usage after a generation completes
 */
async function recordUsage({
  creatorId,
  userId,
  usageType,
  tokensUsed = 0,
  inputTokens = 0,
  outputTokens = 0,
  noteId = null,
  requestSizeBytes = 0,
  processingTimeMs = 0,
  status = 'completed',
}) {
  const { data: usage, error } = await supabaseAdmin
    .from('creator_usage')
    .insert({
      creator_id: creatorId,
      user_id: userId,
      usage_type: usageType,
      tokens_used: tokensUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      note_id: noteId,
      request_size_bytes: requestSizeBytes,
      processing_time_ms: processingTimeMs,
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) {
    logger.error('Error recording creator usage', { error, creatorId, usageType });
    return null;
  }

  // Check if we need to apply cooldown (large job completed)
  const limits = await getCreatorLimits(creatorId);
  if (tokensUsed > limits.largeJobThresholdTokens && status === 'completed') {
    await applyCooldown(creatorId, 'large_job', limits.cooldownAfterLargeJobSeconds, usage.id);
  }

  logger.info('Creator usage recorded', {
    creatorId,
    usageType,
    tokensUsed,
    status,
  });

  return usage;
}

/**
 * Apply a cooldown to a creator
 */
async function applyCooldown(creatorId, cooldownType, seconds, triggeredByUsageId = null) {
  const expiresAt = new Date(Date.now() + seconds * 1000);

  const { error } = await supabaseAdmin
    .from('creator_cooldowns')
    .insert({
      creator_id: creatorId,
      cooldown_type: cooldownType,
      expires_at: expiresAt.toISOString(),
      reason: `${cooldownType} cooldown applied`,
      triggered_by_usage_id: triggeredByUsageId,
    });

  if (error) {
    logger.error('Error applying cooldown', { error, creatorId, cooldownType });
    return false;
  }

  logger.info('Cooldown applied to creator', {
    creatorId,
    cooldownType,
    expiresAt: expiresAt.toISOString(),
  });

  return true;
}

/**
 * Add a job to the queue
 */
async function queueJob({
  creatorId,
  userId,
  jobType,
  noteId,
  requestPayload,
  estimatedTokens,
  priority = 100,
}) {
  // Get current queue position
  const { count: currentQueueSize } = await supabaseAdmin
    .from('creator_job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued');

  const queuePosition = (currentQueueSize || 0) + 1;

  const { data: job, error } = await supabaseAdmin
    .from('creator_job_queue')
    .insert({
      creator_id: creatorId,
      user_id: userId,
      job_type: jobType,
      note_id: noteId,
      request_payload: requestPayload,
      estimated_tokens: estimatedTokens,
      queue_position: queuePosition,
      priority,
      status: 'queued',
    })
    .select()
    .single();

  if (error) {
    logger.error('Error queueing job', { error, creatorId, jobType });
    throw new Error('Failed to queue job');
  }

  logger.info('Job queued for creator', {
    creatorId,
    jobType,
    jobId: job.id,
    queuePosition,
    estimatedTokens,
  });

  return job;
}

/**
 * Get next job from queue to process
 */
async function getNextQueuedJob() {
  const { data: job, error } = await supabaseAdmin
    .from('creator_job_queue')
    .select('*')
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Error fetching next queued job', { error });
  }

  return job;
}

/**
 * Update job status
 */
async function updateJobStatus(jobId, status, result = null, errorMessage = null) {
  const updateData = { status };

  if (status === 'processing') {
    updateData.started_at = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
    if (result) updateData.result = result;
    if (errorMessage) updateData.error_message = errorMessage;
  }

  const { error } = await supabaseAdmin
    .from('creator_job_queue')
    .update(updateData)
    .eq('id', jobId);

  if (error) {
    logger.error('Error updating job status', { error, jobId, status });
    return false;
  }

  return true;
}

/**
 * Flag a creator for abuse
 */
async function flagCreatorForAbuse(creatorId, reason) {
  const { error } = await supabaseAdmin
    .from('creators')
    .update({
      abuse_flagged: true,
      abuse_flagged_at: new Date().toISOString(),
    })
    .eq('id', creatorId);

  if (error) {
    logger.error('Error flagging creator for abuse', { error, creatorId });
    return false;
  }

  logger.warn('Creator flagged for abuse', { creatorId, reason });
  return true;
}

/**
 * Get usage dashboard for a creator
 */
async function getUsageDashboard(creatorId) {
  const limits = await getCreatorLimits(creatorId);
  const stats = await getCreatorUsageStats(creatorId);

  // Calculate percentages
  const dailyUsagePercent = Math.round(
    (stats.generationsToday / limits.maxGenerationsPerDay) * 100
  );
  const monthlyUsagePercent = Math.round(
    (stats.generationsThisMonth / limits.maxGenerationsPerMonth) * 100
  );

  return {
    limits,
    usage: {
      today: {
        generations: stats.generationsToday,
        limit: limits.maxGenerationsPerDay,
        remaining: limits.maxGenerationsPerDay - stats.generationsToday,
        percentUsed: dailyUsagePercent,
      },
      thisMonth: {
        generations: stats.generationsThisMonth,
        limit: limits.maxGenerationsPerMonth,
        remaining: limits.maxGenerationsPerMonth - stats.generationsThisMonth,
        percentUsed: monthlyUsagePercent,
      },
      tokens: {
        today: stats.tokensToday,
        thisMonth: stats.tokensThisMonth,
      },
      specialLimits: {
        podcasts: {
          used: stats.podcastsThisMonth,
          limit: limits.maxPodcastPerMonth,
          remaining: limits.maxPodcastPerMonth - stats.podcastsThisMonth,
        },
        videoProcessing: {
          used: stats.videoProcessingThisMonth,
          limit: limits.maxVideoProcessingPerMonth,
          remaining: limits.maxVideoProcessingPerMonth - stats.videoProcessingThisMonth,
        },
      },
    },
    status: {
      activeCooldown: stats.activeCooldown,
      queuedJobs: stats.queuedJobsCount,
      canGenerate: dailyUsagePercent < 100 && monthlyUsagePercent < 100 && !stats.activeCooldown,
    },
  };
}

/**
 * Estimate tokens for a text input
 * Rough estimate: ~4 characters per token
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

module.exports = {
  getCreatorLimits,
  getCreatorUsageStats,
  checkUsageLimits,
  recordUsage,
  applyCooldown,
  queueJob,
  getNextQueuedJob,
  updateJobStatus,
  flagCreatorForAbuse,
  getUsageDashboard,
  estimateTokens,
  DEFAULT_LIMITS,
  GENERATION_TYPES,
};
