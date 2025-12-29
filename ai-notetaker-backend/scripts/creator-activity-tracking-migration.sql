-- =====================================================
-- Creator Activity Tracking Schema
-- Tracks creator activity and handles automatic downgrades
-- =====================================================

-- =====================================================
-- 1. Add activity tracking fields to creators table
-- =====================================================
DO $$
BEGIN
    -- Last activity check timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'last_activity_check_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN last_activity_check_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- Premium access granted at (when they became a creator)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'premium_granted_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN premium_granted_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- Premium access expires at (for grace periods after downgrade warning)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'premium_expires_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN premium_expires_at TIMESTAMPTZ;
    END IF;

    -- Downgrade warning sent at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'downgrade_warning_sent_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN downgrade_warning_sent_at TIMESTAMPTZ;
    END IF;

    -- Final warning sent at (7 days before downgrade)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'final_warning_sent_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN final_warning_sent_at TIMESTAMPTZ;
    END IF;

    -- Activity status
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'activity_status'
    ) THEN
        ALTER TABLE creators ADD COLUMN activity_status TEXT DEFAULT 'active'
            CHECK (activity_status IN ('active', 'warning', 'final_warning', 'downgraded', 'exempt'));
    END IF;

    -- Downgraded at (when premium was revoked)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'downgraded_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN downgraded_at TIMESTAMPTZ;
    END IF;

    -- Downgrade reason
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'downgrade_reason'
    ) THEN
        ALTER TABLE creators ADD COLUMN downgrade_reason TEXT;
    END IF;

    -- Reactivation count (how many times they've been reactivated)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'reactivation_count'
    ) THEN
        ALTER TABLE creators ADD COLUMN reactivation_count INTEGER DEFAULT 0;
    END IF;

    -- Content submissions count (links to content they've created)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'content_submissions_count'
    ) THEN
        ALTER TABLE creators ADD COLUMN content_submissions_count INTEGER DEFAULT 0;
    END IF;

    -- Is exempt from activity requirements (for special partners)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'is_activity_exempt'
    ) THEN
        ALTER TABLE creators ADD COLUMN is_activity_exempt BOOLEAN DEFAULT false;
    END IF;
END $$;

-- =====================================================
-- 2. Create activity requirements config table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_activity_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Time window for activity check (in days)
    activity_window_days INTEGER DEFAULT 90,

    -- Requirements to stay active (ANY of these)
    min_paid_referrals INTEGER DEFAULT 1,           -- 1+ paid referral
    min_content_submissions INTEGER DEFAULT 2,       -- 2+ content pieces
    min_total_signups INTEGER DEFAULT 10,           -- 10+ total signups (trial or paid)

    -- Warning periods
    warning_period_days INTEGER DEFAULT 14,         -- Days after inactivity before first warning
    final_warning_days INTEGER DEFAULT 7,           -- Days before downgrade for final warning
    grace_period_days INTEGER DEFAULT 7,            -- Days after final warning before downgrade

    -- Is this the active config
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Only one active config
    CONSTRAINT unique_active_config UNIQUE (is_active)
);

-- Insert default config
INSERT INTO creator_activity_config (
    activity_window_days,
    min_paid_referrals,
    min_content_submissions,
    min_total_signups,
    warning_period_days,
    final_warning_days,
    grace_period_days,
    is_active
) VALUES (
    90,     -- 90 day activity window
    1,      -- 1 paid referral
    2,      -- 2 content submissions
    10,     -- 10 signups (trial or paid)
    14,     -- 14 days warning period
    7,      -- 7 days before final warning
    7,      -- 7 days grace period
    true
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. Create content submissions table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_content_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Content details
    content_type TEXT NOT NULL CHECK (content_type IN (
        'video',        -- YouTube, TikTok, etc.
        'blog',         -- Blog post
        'social_post',  -- Instagram, Twitter, etc.
        'podcast',      -- Podcast episode
        'other'         -- Other content
    )),
    content_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    platform TEXT,      -- 'youtube', 'tiktok', 'instagram', etc.

    -- Verification
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,   -- 'system' or admin email

    -- Metrics (optional, for tracking)
    views_count INTEGER,
    engagement_count INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_submissions_creator ON creator_content_submissions(creator_id);
CREATE INDEX IF NOT EXISTS idx_content_submissions_created ON creator_content_submissions(created_at DESC);

-- =====================================================
-- 4. Create activity history table for audit
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_activity_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Event type
    event_type TEXT NOT NULL CHECK (event_type IN (
        'activity_check',       -- Regular activity check
        'warning_sent',         -- First warning email sent
        'final_warning_sent',   -- Final warning email sent
        'downgraded',           -- Premium access revoked
        'reactivated',          -- Premium access restored
        'exempt_granted',       -- Made exempt from activity requirements
        'exempt_revoked',       -- Exemption removed
        'content_submitted',    -- Content was submitted
        'paid_referral',        -- Got a paid referral
        'signup_referral'       -- Got a signup (trial or paid)
    )),

    -- Details
    details JSONB,
    notes TEXT,

    -- Activity metrics at time of event
    paid_referrals_count INTEGER,
    content_submissions_count INTEGER,
    total_signups_count INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_history_creator ON creator_activity_history(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_history_event ON creator_activity_history(event_type, created_at DESC);

-- =====================================================
-- 5. Function to get creator activity stats
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_activity_stats(
    p_creator_id UUID,
    p_window_days INTEGER DEFAULT 90
)
RETURNS TABLE (
    paid_referrals_in_window INTEGER,
    content_submissions_in_window INTEGER,
    total_signups_in_window INTEGER,
    total_paid_referrals INTEGER,
    total_content_submissions INTEGER,
    total_signups INTEGER,
    last_paid_referral_at TIMESTAMPTZ,
    last_content_submission_at TIMESTAMPTZ,
    last_signup_at TIMESTAMPTZ,
    is_active BOOLEAN
) AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_config RECORD;
BEGIN
    v_window_start := NOW() - (p_window_days || ' days')::INTERVAL;

    -- Get activity config
    SELECT * INTO v_config FROM creator_activity_config WHERE is_active = true LIMIT 1;

    RETURN QUERY
    SELECT
        -- Paid referrals in window (attributed redemptions with earnings)
        COALESCE((
            SELECT COUNT(DISTINCT ce.id)::INTEGER
            FROM creator_earnings ce
            WHERE ce.creator_id = p_creator_id
            AND ce.created_at >= v_window_start
            AND ce.status NOT IN ('cancelled', 'clawback', 'held', 'rejected')
            AND ce.creator_earning > 0
        ), 0),

        -- Content submissions in window
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_content_submissions ccs
            WHERE ccs.creator_id = p_creator_id
            AND ccs.created_at >= v_window_start
        ), 0),

        -- Total signups in window (all redemptions, trial or paid)
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM promo_redemptions pr
            WHERE pr.creator_id = p_creator_id
            AND pr.created_at >= v_window_start
        ), 0),

        -- Total paid referrals (all time)
        COALESCE((
            SELECT COUNT(DISTINCT ce.id)::INTEGER
            FROM creator_earnings ce
            WHERE ce.creator_id = p_creator_id
            AND ce.status NOT IN ('cancelled', 'clawback', 'held', 'rejected')
            AND ce.creator_earning > 0
        ), 0),

        -- Total content submissions (all time)
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM creator_content_submissions ccs
            WHERE ccs.creator_id = p_creator_id
        ), 0),

        -- Total signups (all time)
        COALESCE((
            SELECT COUNT(*)::INTEGER
            FROM promo_redemptions pr
            WHERE pr.creator_id = p_creator_id
        ), 0),

        -- Last paid referral
        (
            SELECT MAX(ce.created_at)
            FROM creator_earnings ce
            WHERE ce.creator_id = p_creator_id
            AND ce.status NOT IN ('cancelled', 'clawback', 'held', 'rejected')
            AND ce.creator_earning > 0
        ),

        -- Last content submission
        (
            SELECT MAX(ccs.created_at)
            FROM creator_content_submissions ccs
            WHERE ccs.creator_id = p_creator_id
        ),

        -- Last signup
        (
            SELECT MAX(pr.created_at)
            FROM promo_redemptions pr
            WHERE pr.creator_id = p_creator_id
        ),

        -- Is active (meets ANY requirement)
        (
            -- Has 1+ paid referral in window
            (SELECT COUNT(*) FROM creator_earnings ce
             WHERE ce.creator_id = p_creator_id
             AND ce.created_at >= v_window_start
             AND ce.status NOT IN ('cancelled', 'clawback', 'held', 'rejected')
             AND ce.creator_earning > 0) >= COALESCE(v_config.min_paid_referrals, 1)
            OR
            -- Has 2+ content submissions in window
            (SELECT COUNT(*) FROM creator_content_submissions ccs
             WHERE ccs.creator_id = p_creator_id
             AND ccs.created_at >= v_window_start) >= COALESCE(v_config.min_content_submissions, 2)
            OR
            -- Has 10+ total signups in window
            (SELECT COUNT(*) FROM promo_redemptions pr
             WHERE pr.creator_id = p_creator_id
             AND pr.created_at >= v_window_start) >= COALESCE(v_config.min_total_signups, 10)
        );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. Helper function to increment content submissions count
-- =====================================================
CREATE OR REPLACE FUNCTION increment_content_submissions(p_creator_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE creators
    SET content_submissions_count = COALESCE(content_submissions_count, 0) + 1
    WHERE id = p_creator_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. RLS Policies
-- =====================================================
ALTER TABLE creator_activity_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_content_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_activity_history ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to activity_config"
    ON creator_activity_config FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to content_submissions"
    ON creator_content_submissions FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to activity_history"
    ON creator_activity_history FOR ALL
    USING (true) WITH CHECK (true);
