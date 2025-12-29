-- =====================================================
-- Creator Fraud & Anomaly Detection Schema (Rule 10)
-- Auto-flag creators for suspicious patterns
-- =====================================================

-- =====================================================
-- 1. Fraud anomaly configuration table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_fraud_anomaly_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- =====================================================
    -- Refund/Chargeback Thresholds
    -- =====================================================
    -- Auto-flag if refund rate exceeds this (40-50%)
    refund_rate_threshold_percent DECIMAL(5, 2) DEFAULT 40.00,
    -- Minimum referrals before applying refund rate check
    min_referrals_for_refund_check INTEGER DEFAULT 5,
    -- Lookback period for refund rate (days)
    refund_lookback_days INTEGER DEFAULT 90,

    -- =====================================================
    -- Device/IP Clustering Thresholds
    -- =====================================================
    -- Max signups sharing same device fingerprint
    max_signups_per_device INTEGER DEFAULT 2,
    -- Max signups sharing same IP address
    max_signups_per_ip INTEGER DEFAULT 3,
    -- Max signups sharing same IP subnet
    max_signups_per_subnet INTEGER DEFAULT 5,
    -- Lookback period for device/IP checks (days)
    device_ip_lookback_days INTEGER DEFAULT 30,

    -- =====================================================
    -- Velocity Thresholds (burst detection)
    -- =====================================================
    -- Max paid signups within velocity window
    max_signups_per_velocity_window INTEGER DEFAULT 10,
    -- Velocity window in hours
    velocity_window_hours INTEGER DEFAULT 2,

    -- =====================================================
    -- Payment Method (BIN) Clustering
    -- =====================================================
    -- Max signups sharing same card BIN (first 6 digits)
    max_signups_per_bin INTEGER DEFAULT 3,
    -- Lookback period for BIN checks (days)
    bin_lookback_days INTEGER DEFAULT 30,

    -- =====================================================
    -- Geographic Anomaly Detection
    -- =====================================================
    -- Flag if > X% of signups from unexpected geos
    geo_anomaly_threshold_percent DECIMAL(5, 2) DEFAULT 80.00,
    -- Minimum signups before applying geo check
    min_signups_for_geo_check INTEGER DEFAULT 10,

    -- =====================================================
    -- Auto-actions
    -- =====================================================
    -- Automatically freeze commissions on flag
    auto_freeze_on_flag BOOLEAN DEFAULT true,
    -- Automatically suspend creator on severe fraud
    auto_suspend_on_severe BOOLEAN DEFAULT false,
    -- Severity score threshold for auto-suspend
    severe_fraud_threshold DECIMAL(3, 2) DEFAULT 0.90,

    -- Is this the active config
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_active_fraud_config UNIQUE (is_active)
);

-- Insert default configuration
INSERT INTO creator_fraud_anomaly_config (
    refund_rate_threshold_percent,
    min_referrals_for_refund_check,
    refund_lookback_days,
    max_signups_per_device,
    max_signups_per_ip,
    max_signups_per_subnet,
    device_ip_lookback_days,
    max_signups_per_velocity_window,
    velocity_window_hours,
    max_signups_per_bin,
    bin_lookback_days,
    geo_anomaly_threshold_percent,
    min_signups_for_geo_check,
    auto_freeze_on_flag,
    auto_suspend_on_severe,
    severe_fraud_threshold,
    is_active
) VALUES (
    40.00,      -- 40% refund rate threshold
    5,          -- Min 5 referrals before checking
    90,         -- 90 day lookback
    2,          -- Max 2 signups per device
    3,          -- Max 3 signups per IP
    5,          -- Max 5 signups per subnet
    30,         -- 30 day device/IP lookback
    10,         -- Max 10 signups in velocity window
    2,          -- 2 hour velocity window
    3,          -- Max 3 signups per BIN
    30,         -- 30 day BIN lookback
    80.00,      -- 80% geo anomaly threshold
    10,         -- Min 10 signups for geo check
    true,       -- Auto-freeze on flag
    false,      -- Don't auto-suspend
    0.90,       -- 0.90 severity for severe fraud
    true
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. Creator fraud flags table
-- Stores active fraud flags for creators
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_fraud_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Flag details
    flag_type TEXT NOT NULL CHECK (flag_type IN (
        'high_refund_rate',       -- Excessive refunds/chargebacks
        'device_clustering',      -- Multiple signups from same device
        'ip_clustering',          -- Multiple signups from same IP
        'subnet_clustering',      -- Multiple signups from same network
        'velocity_spike',         -- Too many signups too fast
        'bin_clustering',         -- Multiple signups with same card BIN
        'geo_anomaly',            -- Unusual geographic patterns
        'self_referral',          -- Self-referral detected
        'synthetic_identity',     -- Suspected fake accounts
        'manual_flag'             -- Manually flagged by admin
    )),

    -- Severity (0.0 to 1.0)
    severity_score DECIMAL(3, 2) NOT NULL DEFAULT 0.50,

    -- Evidence
    evidence JSONB NOT NULL DEFAULT '{}',
    -- e.g., { devices: ["hash1", "hash2"], count: 5, threshold: 2 }

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active',           -- Flag is active, requires review
        'reviewing',        -- Under manual review
        'confirmed',        -- Confirmed as fraud
        'dismissed',        -- False positive
        'resolved'          -- Addressed and resolved
    )),

    -- Actions taken
    commission_frozen BOOLEAN DEFAULT false,
    commission_frozen_at TIMESTAMPTZ,
    creator_suspended BOOLEAN DEFAULT false,
    creator_suspended_at TIMESTAMPTZ,

    -- Review
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    resolution_notes TEXT,

    -- Related data
    affected_earnings_ids UUID[] DEFAULT '{}',
    affected_redemption_ids UUID[] DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_creator ON creator_fraud_flags(creator_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_status ON creator_fraud_flags(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_fraud_flags_type ON creator_fraud_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_severity ON creator_fraud_flags(severity_score DESC);

-- =====================================================
-- 3. Creator fraud scan history
-- Tracks when creators were scanned for anomalies
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_fraud_scans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Scan details
    scan_type TEXT NOT NULL CHECK (scan_type IN (
        'scheduled',        -- Regular scheduled scan
        'triggered',        -- Triggered by event (new referral, etc.)
        'manual'            -- Manual admin scan
    )),

    -- Results
    flags_created INTEGER DEFAULT 0,
    anomalies_detected JSONB DEFAULT '[]',
    scan_metrics JSONB DEFAULT '{}',

    -- Timing
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_scans_creator ON creator_fraud_scans(creator_id, created_at DESC);

-- =====================================================
-- 4. Add fraud tracking fields to creators table
-- =====================================================
DO $$
BEGIN
    -- Fraud risk score (0.0 to 1.0)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'fraud_risk_score'
    ) THEN
        ALTER TABLE creators ADD COLUMN fraud_risk_score DECIMAL(3, 2) DEFAULT 0.00;
    END IF;

    -- Active fraud flags count
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'active_fraud_flags'
    ) THEN
        ALTER TABLE creators ADD COLUMN active_fraud_flags INTEGER DEFAULT 0;
    END IF;

    -- Commission frozen due to fraud
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'commission_frozen'
    ) THEN
        ALTER TABLE creators ADD COLUMN commission_frozen BOOLEAN DEFAULT false;
    END IF;

    -- Commission frozen at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'commission_frozen_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN commission_frozen_at TIMESTAMPTZ;
    END IF;

    -- Commission frozen reason
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'commission_frozen_reason'
    ) THEN
        ALTER TABLE creators ADD COLUMN commission_frozen_reason TEXT;
    END IF;

    -- Last fraud scan at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'last_fraud_scan_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN last_fraud_scan_at TIMESTAMPTZ;
    END IF;

    -- Requires manual review
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'requires_fraud_review'
    ) THEN
        ALTER TABLE creators ADD COLUMN requires_fraud_review BOOLEAN DEFAULT false;
    END IF;
END $$;

-- =====================================================
-- 5. Add tracking fields to promo_redemptions table
-- =====================================================
DO $$
BEGIN
    -- Card BIN (first 6 digits of card, for clustering detection)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'card_bin_hash'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN card_bin_hash TEXT;
    END IF;

    -- Geographic location
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'geo_country'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN geo_country TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'geo_region'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN geo_region TEXT;
    END IF;

    -- Anomaly score for this specific redemption
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'anomaly_score'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN anomaly_score DECIMAL(3, 2) DEFAULT 0.00;
    END IF;

    -- Flagged for review
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'flagged_for_review'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN flagged_for_review BOOLEAN DEFAULT false;
    END IF;
END $$;

-- =====================================================
-- 6. Add refund/chargeback tracking to creator_earnings
-- =====================================================
DO $$
BEGIN
    -- Was this earning refunded
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'was_refunded'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN was_refunded BOOLEAN DEFAULT false;
    END IF;

    -- Refund timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'refunded_at'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN refunded_at TIMESTAMPTZ;
    END IF;

    -- Was this a chargeback
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'was_chargeback'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN was_chargeback BOOLEAN DEFAULT false;
    END IF;

    -- Chargeback timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'chargeback_at'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN chargeback_at TIMESTAMPTZ;
    END IF;
END $$;

-- =====================================================
-- 7. Function to calculate creator refund rate
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_refund_rate(
    p_creator_id UUID,
    p_lookback_days INTEGER DEFAULT 90
)
RETURNS TABLE (
    total_earnings INTEGER,
    refunded_earnings INTEGER,
    chargeback_earnings INTEGER,
    refund_rate DECIMAL(5, 2),
    chargeback_rate DECIMAL(5, 2),
    combined_rate DECIMAL(5, 2)
) AS $$
DECLARE
    v_lookback_start TIMESTAMPTZ;
BEGIN
    v_lookback_start := NOW() - (p_lookback_days || ' days')::INTERVAL;

    RETURN QUERY
    SELECT
        COUNT(*)::INTEGER as total_earnings,
        COUNT(*) FILTER (WHERE ce.was_refunded = true)::INTEGER as refunded_earnings,
        COUNT(*) FILTER (WHERE ce.was_chargeback = true)::INTEGER as chargeback_earnings,
        CASE
            WHEN COUNT(*) > 0 THEN
                (COUNT(*) FILTER (WHERE ce.was_refunded = true)::DECIMAL / COUNT(*) * 100)
            ELSE 0
        END as refund_rate,
        CASE
            WHEN COUNT(*) > 0 THEN
                (COUNT(*) FILTER (WHERE ce.was_chargeback = true)::DECIMAL / COUNT(*) * 100)
            ELSE 0
        END as chargeback_rate,
        CASE
            WHEN COUNT(*) > 0 THEN
                ((COUNT(*) FILTER (WHERE ce.was_refunded = true OR ce.was_chargeback = true))::DECIMAL / COUNT(*) * 100)
            ELSE 0
        END as combined_rate
    FROM creator_earnings ce
    WHERE ce.creator_id = p_creator_id
    AND ce.created_at >= v_lookback_start
    AND ce.status NOT IN ('held', 'rejected');
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. Function to get device/IP clustering for creator
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_clustering_stats(
    p_creator_id UUID,
    p_lookback_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    total_redemptions INTEGER,
    unique_devices INTEGER,
    unique_ips INTEGER,
    unique_subnets INTEGER,
    max_per_device INTEGER,
    max_per_ip INTEGER,
    max_per_subnet INTEGER,
    device_clustering_detected BOOLEAN,
    ip_clustering_detected BOOLEAN
) AS $$
DECLARE
    v_lookback_start TIMESTAMPTZ;
    v_config RECORD;
BEGIN
    v_lookback_start := NOW() - (p_lookback_days || ' days')::INTERVAL;

    SELECT * INTO v_config FROM creator_fraud_anomaly_config WHERE is_active = true LIMIT 1;

    RETURN QUERY
    WITH redemption_stats AS (
        SELECT
            COUNT(*)::INTEGER as total,
            COUNT(DISTINCT device_fingerprint)::INTEGER as devices,
            COUNT(DISTINCT ip_address)::INTEGER as ips,
            COUNT(DISTINCT ip_subnet)::INTEGER as subnets,
            MAX(device_count)::INTEGER as max_device,
            MAX(ip_count)::INTEGER as max_ip,
            MAX(subnet_count)::INTEGER as max_subnet
        FROM (
            SELECT
                pr.device_fingerprint,
                pr.ip_address,
                pr.ip_subnet,
                COUNT(*) OVER (PARTITION BY pr.device_fingerprint) as device_count,
                COUNT(*) OVER (PARTITION BY pr.ip_address) as ip_count,
                COUNT(*) OVER (PARTITION BY pr.ip_subnet) as subnet_count
            FROM promo_redemptions pr
            WHERE pr.creator_id = p_creator_id
            AND pr.created_at >= v_lookback_start
            AND pr.device_fingerprint IS NOT NULL
        ) sub
    )
    SELECT
        rs.total,
        rs.devices,
        rs.ips,
        rs.subnets,
        rs.max_device,
        rs.max_ip,
        rs.max_subnet,
        rs.max_device > COALESCE(v_config.max_signups_per_device, 2),
        rs.max_ip > COALESCE(v_config.max_signups_per_ip, 3)
    FROM redemption_stats rs;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 9. Function to detect velocity spikes
-- =====================================================
CREATE OR REPLACE FUNCTION detect_velocity_spike(
    p_creator_id UUID,
    p_window_hours INTEGER DEFAULT 2,
    p_max_signups INTEGER DEFAULT 10
)
RETURNS TABLE (
    has_spike BOOLEAN,
    spike_count INTEGER,
    spike_window_start TIMESTAMPTZ,
    spike_window_end TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH hourly_counts AS (
        SELECT
            date_trunc('hour', pr.created_at) as hour_start,
            COUNT(*) as signup_count
        FROM promo_redemptions pr
        WHERE pr.creator_id = p_creator_id
        AND pr.attribution_status = 'attributed'
        AND pr.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY date_trunc('hour', pr.created_at)
    ),
    rolling_windows AS (
        SELECT
            hc.hour_start,
            SUM(hc2.signup_count) as window_count
        FROM hourly_counts hc
        CROSS JOIN LATERAL (
            SELECT signup_count
            FROM hourly_counts hc2
            WHERE hc2.hour_start >= hc.hour_start
            AND hc2.hour_start < hc.hour_start + (p_window_hours || ' hours')::INTERVAL
        ) hc2
        GROUP BY hc.hour_start
    )
    SELECT
        rw.window_count > p_max_signups,
        rw.window_count::INTEGER,
        rw.hour_start,
        rw.hour_start + (p_window_hours || ' hours')::INTERVAL
    FROM rolling_windows rw
    WHERE rw.window_count > p_max_signups
    ORDER BY rw.window_count DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 10. Function to get BIN clustering stats
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_bin_clustering(
    p_creator_id UUID,
    p_lookback_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    total_with_bin INTEGER,
    unique_bins INTEGER,
    max_per_bin INTEGER,
    top_bin_hash TEXT,
    clustering_detected BOOLEAN
) AS $$
DECLARE
    v_lookback_start TIMESTAMPTZ;
    v_config RECORD;
BEGIN
    v_lookback_start := NOW() - (p_lookback_days || ' days')::INTERVAL;

    SELECT * INTO v_config FROM creator_fraud_anomaly_config WHERE is_active = true LIMIT 1;

    RETURN QUERY
    WITH bin_stats AS (
        SELECT
            pr.card_bin_hash,
            COUNT(*) as bin_count
        FROM promo_redemptions pr
        WHERE pr.creator_id = p_creator_id
        AND pr.created_at >= v_lookback_start
        AND pr.card_bin_hash IS NOT NULL
        GROUP BY pr.card_bin_hash
    )
    SELECT
        SUM(bs.bin_count)::INTEGER,
        COUNT(DISTINCT bs.card_bin_hash)::INTEGER,
        MAX(bs.bin_count)::INTEGER,
        (SELECT card_bin_hash FROM bin_stats ORDER BY bin_count DESC LIMIT 1),
        MAX(bs.bin_count) > COALESCE(v_config.max_signups_per_bin, 3)
    FROM bin_stats bs;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 11. RLS Policies
-- =====================================================
ALTER TABLE creator_fraud_anomaly_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_fraud_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_fraud_scans ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to fraud_config"
    ON creator_fraud_anomaly_config FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to fraud_flags"
    ON creator_fraud_flags FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access to fraud_scans"
    ON creator_fraud_scans FOR ALL
    USING (true) WITH CHECK (true);
