-- =====================================================
-- Trial Abuse Prevention Schema
-- Prevents trial churn gaming and self-referral farms
-- =====================================================

-- =====================================================
-- 1. Trial fingerprint tracking table
-- Tracks device, payment, and email/IP clusters
-- =====================================================
CREATE TABLE IF NOT EXISTS trial_fingerprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Fingerprint types (hashed values)
    device_fingerprint TEXT,           -- Device/browser fingerprint hash
    payment_fingerprint TEXT,          -- Payment method hash (brand + last4)
    email_hash TEXT,                   -- Email hash
    email_base_hash TEXT,              -- Email base (before +) hash for alias detection
    ip_hash TEXT,                      -- IP address hash
    ip_subnet_hash TEXT,               -- IP subnet (/24) hash

    -- User reference (if they signed up)
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Trial information
    trial_started_at TIMESTAMPTZ DEFAULT NOW(),
    trial_ended_at TIMESTAMPTZ,
    trial_converted BOOLEAN DEFAULT false,

    -- Promo code used (if any)
    promo_code_id UUID,
    creator_id UUID REFERENCES creators(id) ON DELETE SET NULL,

    -- Platform
    platform TEXT CHECK (platform IN ('ios', 'android', 'web')),

    -- Abuse signals
    abuse_score DECIMAL(3, 2) DEFAULT 0.00,  -- 0.00 to 1.00
    abuse_signals JSONB DEFAULT '[]',
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_device ON trial_fingerprints(device_fingerprint) WHERE device_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_payment ON trial_fingerprints(payment_fingerprint) WHERE payment_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_email ON trial_fingerprints(email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_email_base ON trial_fingerprints(email_base_hash) WHERE email_base_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_ip ON trial_fingerprints(ip_hash) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_subnet ON trial_fingerprints(ip_subnet_hash) WHERE ip_subnet_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_user ON trial_fingerprints(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_created ON trial_fingerprints(created_at DESC);

-- =====================================================
-- 2. Abuse cluster tracking
-- Groups related trials by shared fingerprints
-- =====================================================
CREATE TABLE IF NOT EXISTS trial_abuse_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Cluster identification
    cluster_type TEXT NOT NULL CHECK (cluster_type IN (
        'device',           -- Same device
        'payment',          -- Same payment method
        'email_alias',      -- Same email with +aliases
        'ip_subnet',        -- Same network/household
        'mixed'             -- Multiple signal types
    )),
    cluster_hash TEXT NOT NULL,        -- Hash identifying the cluster

    -- Cluster members
    trial_count INTEGER DEFAULT 1,
    user_ids UUID[] DEFAULT '{}',
    email_hashes TEXT[] DEFAULT '{}',

    -- Status
    is_flagged BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN (
        'pending', 'reviewing', 'cleared', 'confirmed_abuse', 'auto_blocked'
    )),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,

    -- Timestamps
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(cluster_type, cluster_hash)
);

CREATE INDEX IF NOT EXISTS idx_abuse_clusters_hash ON trial_abuse_clusters(cluster_hash);
CREATE INDEX IF NOT EXISTS idx_abuse_clusters_flagged ON trial_abuse_clusters(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_abuse_clusters_blocked ON trial_abuse_clusters(is_blocked) WHERE is_blocked = true;

-- =====================================================
-- 3. Trial abuse configuration
-- =====================================================
CREATE TABLE IF NOT EXISTS trial_abuse_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Maximum trials allowed per fingerprint type
    max_trials_per_device INTEGER DEFAULT 1,
    max_trials_per_payment_method INTEGER DEFAULT 1,
    max_trials_per_email_base INTEGER DEFAULT 2,      -- Allow 2 for +alias variations
    max_trials_per_ip INTEGER DEFAULT 3,              -- More lenient for shared IPs
    max_trials_per_subnet INTEGER DEFAULT 5,          -- Even more lenient for households

    -- Time windows (in days)
    device_lookback_days INTEGER DEFAULT 365,         -- Check device history for 1 year
    payment_lookback_days INTEGER DEFAULT 365,        -- Check payment history for 1 year
    email_lookback_days INTEGER DEFAULT 365,          -- Check email history for 1 year
    ip_lookback_days INTEGER DEFAULT 90,              -- IPs change more often
    subnet_lookback_days INTEGER DEFAULT 90,

    -- Abuse thresholds
    cluster_flag_threshold INTEGER DEFAULT 3,         -- Flag cluster at 3+ trials
    cluster_block_threshold INTEGER DEFAULT 5,        -- Auto-block at 5+ trials

    -- Abuse score weights
    device_match_weight DECIMAL(3, 2) DEFAULT 1.00,   -- Full match weight
    payment_match_weight DECIMAL(3, 2) DEFAULT 1.00,
    email_base_match_weight DECIMAL(3, 2) DEFAULT 0.90,
    ip_match_weight DECIMAL(3, 2) DEFAULT 0.70,
    subnet_match_weight DECIMAL(3, 2) DEFAULT 0.40,

    -- Is this the active config
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_active_trial_config UNIQUE (is_active)
);

-- Insert default config
INSERT INTO trial_abuse_config (
    max_trials_per_device,
    max_trials_per_payment_method,
    max_trials_per_email_base,
    max_trials_per_ip,
    max_trials_per_subnet,
    device_lookback_days,
    payment_lookback_days,
    email_lookback_days,
    ip_lookback_days,
    subnet_lookback_days,
    cluster_flag_threshold,
    cluster_block_threshold,
    is_active
) VALUES (
    1,      -- 1 trial per device
    1,      -- 1 trial per payment method
    2,      -- 2 trials per email base (allows +alias once)
    3,      -- 3 trials per IP (shared office/coffee shop)
    5,      -- 5 trials per subnet (household)
    365,    -- 1 year device lookback
    365,    -- 1 year payment lookback
    365,    -- 1 year email lookback
    90,     -- 90 day IP lookback
    90,     -- 90 day subnet lookback
    3,      -- Flag at 3
    5,      -- Block at 5
    true
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 4. Trial abuse event log
-- =====================================================
CREATE TABLE IF NOT EXISTS trial_abuse_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- What happened
    event_type TEXT NOT NULL CHECK (event_type IN (
        'trial_blocked',        -- Trial was blocked
        'trial_flagged',        -- Trial was flagged but allowed
        'cluster_created',      -- New abuse cluster detected
        'cluster_flagged',      -- Cluster reached flag threshold
        'cluster_blocked',      -- Cluster reached block threshold
        'cluster_cleared',      -- Manual review cleared cluster
        'abuse_confirmed',      -- Manual review confirmed abuse
        'user_blocked',         -- User was blocked for abuse
        'trial_attempted'       -- Trial attempt recorded
    )),

    -- Context
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    trial_fingerprint_id UUID REFERENCES trial_fingerprints(id) ON DELETE SET NULL,
    cluster_id UUID REFERENCES trial_abuse_clusters(id) ON DELETE SET NULL,

    -- Details
    signals JSONB DEFAULT '{}',
    abuse_score DECIMAL(3, 2),
    blocked_reason TEXT,

    -- Request context
    ip_address_hash TEXT,
    device_fingerprint_hash TEXT,
    platform TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_abuse_events_type ON trial_abuse_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_abuse_events_user ON trial_abuse_events(user_id) WHERE user_id IS NOT NULL;

-- =====================================================
-- 5. Add trial tracking fields to users if not exists
-- =====================================================
DO $$
BEGIN
    -- Has used a trial
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'has_used_trial'
    ) THEN
        -- Check if users table exists in public schema
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
            ALTER TABLE users ADD COLUMN has_used_trial BOOLEAN DEFAULT false;
        END IF;
    END IF;

    -- Trial abuse blocked
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'trial_abuse_blocked'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
            ALTER TABLE users ADD COLUMN trial_abuse_blocked BOOLEAN DEFAULT false;
        END IF;
    END IF;
END $$;

-- =====================================================
-- 6. Function to check trial eligibility
-- =====================================================
CREATE OR REPLACE FUNCTION check_trial_eligibility(
    p_device_fingerprint TEXT,
    p_payment_fingerprint TEXT,
    p_email_hash TEXT,
    p_email_base_hash TEXT,
    p_ip_hash TEXT,
    p_ip_subnet_hash TEXT,
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    is_eligible BOOLEAN,
    block_reason TEXT,
    abuse_score DECIMAL(3, 2),
    signals JSONB
) AS $$
DECLARE
    v_config RECORD;
    v_abuse_score DECIMAL(3, 2) := 0.00;
    v_signals JSONB := '[]'::JSONB;
    v_block_reason TEXT := NULL;
    v_device_count INTEGER;
    v_payment_count INTEGER;
    v_email_count INTEGER;
    v_ip_count INTEGER;
    v_subnet_count INTEGER;
BEGIN
    -- Get config
    SELECT * INTO v_config FROM trial_abuse_config WHERE is_active = true LIMIT 1;

    IF v_config IS NULL THEN
        -- No config, allow trial
        RETURN QUERY SELECT true, NULL::TEXT, 0.00::DECIMAL(3,2), '[]'::JSONB;
        RETURN;
    END IF;

    -- Check device fingerprint
    IF p_device_fingerprint IS NOT NULL THEN
        SELECT COUNT(*) INTO v_device_count
        FROM trial_fingerprints
        WHERE device_fingerprint = p_device_fingerprint
        AND created_at >= NOW() - (v_config.device_lookback_days || ' days')::INTERVAL;

        IF v_device_count >= v_config.max_trials_per_device THEN
            v_abuse_score := v_abuse_score + v_config.device_match_weight;
            v_signals := v_signals || jsonb_build_object(
                'type', 'device_limit',
                'count', v_device_count,
                'max', v_config.max_trials_per_device
            );
            v_block_reason := COALESCE(v_block_reason, 'Device already used for trial');
        END IF;
    END IF;

    -- Check payment fingerprint
    IF p_payment_fingerprint IS NOT NULL THEN
        SELECT COUNT(*) INTO v_payment_count
        FROM trial_fingerprints
        WHERE payment_fingerprint = p_payment_fingerprint
        AND created_at >= NOW() - (v_config.payment_lookback_days || ' days')::INTERVAL;

        IF v_payment_count >= v_config.max_trials_per_payment_method THEN
            v_abuse_score := v_abuse_score + v_config.payment_match_weight;
            v_signals := v_signals || jsonb_build_object(
                'type', 'payment_limit',
                'count', v_payment_count,
                'max', v_config.max_trials_per_payment_method
            );
            v_block_reason := COALESCE(v_block_reason, 'Payment method already used for trial');
        END IF;
    END IF;

    -- Check email base (for alias detection)
    IF p_email_base_hash IS NOT NULL THEN
        SELECT COUNT(*) INTO v_email_count
        FROM trial_fingerprints
        WHERE email_base_hash = p_email_base_hash
        AND created_at >= NOW() - (v_config.email_lookback_days || ' days')::INTERVAL;

        IF v_email_count >= v_config.max_trials_per_email_base THEN
            v_abuse_score := v_abuse_score + v_config.email_base_match_weight;
            v_signals := v_signals || jsonb_build_object(
                'type', 'email_alias_limit',
                'count', v_email_count,
                'max', v_config.max_trials_per_email_base
            );
            v_block_reason := COALESCE(v_block_reason, 'Email already used for trial');
        END IF;
    END IF;

    -- Check IP (with more lenient threshold)
    IF p_ip_hash IS NOT NULL THEN
        SELECT COUNT(*) INTO v_ip_count
        FROM trial_fingerprints
        WHERE ip_hash = p_ip_hash
        AND created_at >= NOW() - (v_config.ip_lookback_days || ' days')::INTERVAL;

        IF v_ip_count >= v_config.max_trials_per_ip THEN
            v_abuse_score := v_abuse_score + v_config.ip_match_weight;
            v_signals := v_signals || jsonb_build_object(
                'type', 'ip_limit',
                'count', v_ip_count,
                'max', v_config.max_trials_per_ip
            );
            -- Don't block for IP alone, just flag
        END IF;
    END IF;

    -- Check subnet (household detection)
    IF p_ip_subnet_hash IS NOT NULL THEN
        SELECT COUNT(*) INTO v_subnet_count
        FROM trial_fingerprints
        WHERE ip_subnet_hash = p_ip_subnet_hash
        AND created_at >= NOW() - (v_config.subnet_lookback_days || ' days')::INTERVAL;

        IF v_subnet_count >= v_config.max_trials_per_subnet THEN
            v_abuse_score := v_abuse_score + v_config.subnet_match_weight;
            v_signals := v_signals || jsonb_build_object(
                'type', 'subnet_limit',
                'count', v_subnet_count,
                'max', v_config.max_trials_per_subnet
            );
            -- Contribute to score but don't block alone
        END IF;
    END IF;

    -- Cap abuse score at 1.00
    v_abuse_score := LEAST(v_abuse_score, 1.00);

    -- Determine eligibility
    -- Block if abuse score >= 1.0 (hard block on device/payment match)
    -- or if there's a block reason from device/payment/email checks
    RETURN QUERY SELECT
        v_block_reason IS NULL,
        v_block_reason,
        v_abuse_score,
        v_signals;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. RLS Policies
-- =====================================================
ALTER TABLE trial_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_abuse_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_abuse_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_abuse_events ENABLE ROW LEVEL SECURITY;

-- Service role can access everything
CREATE POLICY "Service role full access to trial_fingerprints"
    ON trial_fingerprints FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to trial_abuse_clusters"
    ON trial_abuse_clusters FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to trial_abuse_config"
    ON trial_abuse_config FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to trial_abuse_events"
    ON trial_abuse_events FOR ALL
    USING (true)
    WITH CHECK (true);
