-- =====================================================
-- Creator Usage Limits Schema
-- Prevents abuse while allowing normal creator usage
-- =====================================================

-- =====================================================
-- 1. Create usage tracking table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Who
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- What
    usage_type TEXT NOT NULL CHECK (usage_type IN (
        'ai_summary',
        'ai_quiz',
        'ai_flashcards',
        'ai_podcast',
        'ai_diagram',
        'ai_chat',
        'transcription',
        'pdf_processing',
        'video_processing'
    )),

    -- How much
    tokens_used INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,

    -- Context
    note_id UUID,
    request_size_bytes INTEGER,
    processing_time_ms INTEGER,

    -- Status
    status TEXT DEFAULT 'completed' CHECK (status IN (
        'completed',
        'queued',
        'processing',
        'failed',
        'rate_limited'
    )),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_creator_usage_creator_id ON creator_usage(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_usage_created_at ON creator_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_usage_type ON creator_usage(usage_type);

-- Index for daily/monthly aggregation queries
CREATE INDEX IF NOT EXISTS idx_creator_usage_creator_day
    ON creator_usage(creator_id, created_at)
    WHERE status = 'completed';

-- =====================================================
-- 2. Create usage limits configuration table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_usage_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Limit type (default applies to all creators unless overridden)
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,

    -- Generation limits
    max_generations_per_month INTEGER DEFAULT 500,
    max_generations_per_day INTEGER DEFAULT 50,

    -- Token limits per request
    max_input_tokens INTEGER DEFAULT 100000,  -- ~75k words input
    max_output_tokens INTEGER DEFAULT 16000,  -- ~12k words output

    -- Cooldown settings
    cooldown_after_large_job_seconds INTEGER DEFAULT 60,  -- 1 min after large job
    large_job_threshold_tokens INTEGER DEFAULT 8000,      -- Jobs > 8k tokens = large

    -- Queue settings
    queue_threshold_tokens INTEGER DEFAULT 50000,  -- Queue jobs > 50k tokens
    max_queued_jobs INTEGER DEFAULT 5,

    -- Special limits
    max_podcast_per_month INTEGER DEFAULT 100,  -- Podcasts are expensive
    max_video_processing_per_month INTEGER DEFAULT 50,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure only one default config
    CONSTRAINT unique_default_limits UNIQUE (is_default)
        -- This works because NULL != NULL, so only one true is allowed
);

-- Insert default limits
INSERT INTO creator_usage_limits (
    is_default,
    max_generations_per_month,
    max_generations_per_day,
    max_input_tokens,
    max_output_tokens,
    cooldown_after_large_job_seconds,
    large_job_threshold_tokens,
    queue_threshold_tokens,
    max_queued_jobs,
    max_podcast_per_month,
    max_video_processing_per_month,
    notes
) VALUES (
    true,
    500,    -- 500 generations/month
    50,     -- 50/day
    100000, -- 100k input tokens
    16000,  -- 16k output tokens
    60,     -- 1 min cooldown after large job
    8000,   -- Large job = 8k+ tokens
    50000,  -- Queue jobs > 50k tokens
    5,      -- Max 5 queued jobs
    100,    -- 100 podcasts/month
    50,     -- 50 video processings/month
    'Default creator limits - prevents farm abuse while allowing normal usage'
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. Create cooldown tracking table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_cooldowns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Cooldown info
    cooldown_type TEXT NOT NULL CHECK (cooldown_type IN (
        'large_job',
        'rate_limit',
        'abuse_detected',
        'manual'
    )),

    -- When cooldown expires
    expires_at TIMESTAMPTZ NOT NULL,

    -- Why
    reason TEXT,
    triggered_by_usage_id UUID REFERENCES creator_usage(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_cooldowns_creator
    ON creator_cooldowns(creator_id, expires_at)
    WHERE expires_at > NOW();

-- =====================================================
-- 4. Create job queue table for large tasks
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_job_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Job details
    job_type TEXT NOT NULL,
    note_id UUID,
    request_payload JSONB,
    estimated_tokens INTEGER,

    -- Queue position and status
    queue_position INTEGER,
    status TEXT DEFAULT 'queued' CHECK (status IN (
        'queued',
        'processing',
        'completed',
        'failed',
        'cancelled'
    )),

    -- Processing info
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB,
    error_message TEXT,

    -- Priority (lower = higher priority)
    priority INTEGER DEFAULT 100,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status
    ON creator_job_queue(status, priority, created_at)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_job_queue_creator
    ON creator_job_queue(creator_id, created_at DESC);

-- =====================================================
-- 5. Add usage tracking fields to creators table
-- =====================================================
DO $$
BEGIN
    -- Current month usage cache (updated periodically)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'current_month_generations'
    ) THEN
        ALTER TABLE creators ADD COLUMN current_month_generations INTEGER DEFAULT 0;
    END IF;

    -- Current day usage cache
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'current_day_generations'
    ) THEN
        ALTER TABLE creators ADD COLUMN current_day_generations INTEGER DEFAULT 0;
    END IF;

    -- Last usage reset timestamps
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'usage_month_reset_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN usage_month_reset_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'usage_day_reset_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN usage_day_reset_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- Flag for creators with custom limits
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'has_custom_limits'
    ) THEN
        ALTER TABLE creators ADD COLUMN has_custom_limits BOOLEAN DEFAULT false;
    END IF;

    -- Abuse flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'abuse_flagged'
    ) THEN
        ALTER TABLE creators ADD COLUMN abuse_flagged BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'abuse_flagged_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN abuse_flagged_at TIMESTAMPTZ;
    END IF;
END $$;

-- =====================================================
-- 6. Function to get creator's current usage stats
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_usage_stats(p_creator_id UUID)
RETURNS TABLE (
    generations_today INTEGER,
    generations_this_month INTEGER,
    tokens_today BIGINT,
    tokens_this_month BIGINT,
    podcasts_this_month INTEGER,
    video_processing_this_month INTEGER,
    active_cooldown_expires_at TIMESTAMPTZ,
    queued_jobs_count INTEGER
) AS $$
DECLARE
    v_start_of_day TIMESTAMPTZ;
    v_start_of_month TIMESTAMPTZ;
BEGIN
    v_start_of_day := date_trunc('day', NOW());
    v_start_of_month := date_trunc('month', NOW());

    RETURN QUERY
    SELECT
        -- Today's generations
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_day
            AND status = 'completed'
        ), 0),

        -- This month's generations
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_month
            AND status = 'completed'
        ), 0),

        -- Today's tokens
        COALESCE((
            SELECT SUM(tokens_used)::BIGINT
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_day
            AND status = 'completed'
        ), 0),

        -- This month's tokens
        COALESCE((
            SELECT SUM(tokens_used)::BIGINT
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_month
            AND status = 'completed'
        ), 0),

        -- Podcasts this month
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_month
            AND usage_type = 'ai_podcast'
            AND status = 'completed'
        ), 0),

        -- Video processing this month
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_usage
            WHERE creator_id = p_creator_id
            AND created_at >= v_start_of_month
            AND usage_type = 'video_processing'
            AND status = 'completed'
        ), 0),

        -- Active cooldown
        (
            SELECT MAX(expires_at)
            FROM creator_cooldowns
            WHERE creator_id = p_creator_id
            AND expires_at > NOW()
        ),

        -- Queued jobs count
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_job_queue
            WHERE creator_id = p_creator_id
            AND status = 'queued'
        ), 0);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. RLS Policies
-- =====================================================
ALTER TABLE creator_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_cooldowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_job_queue ENABLE ROW LEVEL SECURITY;

-- Service role can access everything
CREATE POLICY "Service role full access to creator_usage"
    ON creator_usage FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to creator_usage_limits"
    ON creator_usage_limits FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to creator_cooldowns"
    ON creator_cooldowns FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to creator_job_queue"
    ON creator_job_queue FOR ALL
    USING (true)
    WITH CHECK (true);
