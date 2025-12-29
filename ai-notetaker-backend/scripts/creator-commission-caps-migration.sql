-- =====================================================
-- Creator Commission Caps Schema (Rule 9)
-- Limits exposure per creator to prevent runaway costs
-- =====================================================

-- =====================================================
-- 1. Commission caps configuration table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_commission_caps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Cap type (default applies to all, or per-creator override)
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,

    -- =====================================================
    -- OPTION 1: Hard monthly cap
    -- Maximum total commissions a creator can earn per month
    -- =====================================================
    max_monthly_commission DECIMAL(10, 2) DEFAULT 500.00,  -- $500/month cap

    -- =====================================================
    -- OPTION 2: Tiered rates based on volume
    -- After X referrals, rate drops from 25% to lower tier
    -- =====================================================

    -- Tier 1: First N referrals at full rate (25%)
    tier1_referral_limit INTEGER DEFAULT 20,      -- First 20 referrals
    tier1_rate_percent DECIMAL(5, 2) DEFAULT 25.00,  -- at 25%

    -- Tier 2: Next N referrals at reduced rate
    tier2_referral_limit INTEGER DEFAULT 30,      -- Next 30 referrals (21-50)
    tier2_rate_percent DECIMAL(5, 2) DEFAULT 15.00,  -- at 15%

    -- Tier 3: Beyond tier 2, even lower rate
    tier3_rate_percent DECIMAL(5, 2) DEFAULT 10.00,  -- 10% for 51+

    -- Which cap method to use
    cap_method TEXT DEFAULT 'both' CHECK (cap_method IN (
        'monthly_max',      -- Only use hard monthly cap
        'tiered',           -- Only use tiered rates
        'both'              -- Apply both (whichever hits first)
    )),

    -- Grace period for new creators (days before caps apply)
    new_creator_grace_days INTEGER DEFAULT 30,

    -- Is this the active config
    is_active BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Only one default config
    CONSTRAINT unique_default_commission_cap UNIQUE (is_default)
);

-- Insert default configuration
INSERT INTO creator_commission_caps (
    is_default,
    max_monthly_commission,
    tier1_referral_limit,
    tier1_rate_percent,
    tier2_referral_limit,
    tier2_rate_percent,
    tier3_rate_percent,
    cap_method,
    new_creator_grace_days,
    is_active
) VALUES (
    true,
    500.00,     -- $500/month max
    20,         -- First 20 at 25%
    25.00,
    30,         -- Next 30 (21-50) at 15%
    15.00,
    10.00,      -- 51+ at 10%
    'both',     -- Apply both caps
    30,         -- 30 day grace period
    true
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. Monthly commission tracking table
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_monthly_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

    -- Month tracking (YYYY-MM format)
    year_month TEXT NOT NULL,  -- e.g., '2025-01'

    -- Running totals for the month
    total_referrals INTEGER DEFAULT 0,
    paid_referrals INTEGER DEFAULT 0,

    -- Commission amounts
    gross_commission DECIMAL(10, 2) DEFAULT 0.00,  -- Before any caps
    capped_commission DECIMAL(10, 2) DEFAULT 0.00, -- After caps applied
    cap_savings DECIMAL(10, 2) DEFAULT 0.00,       -- Amount saved by caps

    -- Tier breakdown
    tier1_referrals INTEGER DEFAULT 0,
    tier1_commission DECIMAL(10, 2) DEFAULT 0.00,
    tier2_referrals INTEGER DEFAULT 0,
    tier2_commission DECIMAL(10, 2) DEFAULT 0.00,
    tier3_referrals INTEGER DEFAULT 0,
    tier3_commission DECIMAL(10, 2) DEFAULT 0.00,

    -- Cap status
    monthly_cap_hit BOOLEAN DEFAULT false,
    monthly_cap_hit_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(creator_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_commissions_creator ON creator_monthly_commissions(creator_id, year_month DESC);

-- =====================================================
-- 3. Add cap tracking fields to creators table
-- =====================================================
DO $$
BEGIN
    -- Current month commission total (cached)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'current_month_commission'
    ) THEN
        ALTER TABLE creators ADD COLUMN current_month_commission DECIMAL(10, 2) DEFAULT 0.00;
    END IF;

    -- Current month referral count (cached)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'current_month_referrals'
    ) THEN
        ALTER TABLE creators ADD COLUMN current_month_referrals INTEGER DEFAULT 0;
    END IF;

    -- Last month reset timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'commission_month_reset_at'
    ) THEN
        ALTER TABLE creators ADD COLUMN commission_month_reset_at TIMESTAMPTZ DEFAULT date_trunc('month', NOW());
    END IF;

    -- Has custom commission cap
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'has_custom_cap'
    ) THEN
        ALTER TABLE creators ADD COLUMN has_custom_cap BOOLEAN DEFAULT false;
    END IF;

    -- Is exempt from caps (for special partners)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'is_cap_exempt'
    ) THEN
        ALTER TABLE creators ADD COLUMN is_cap_exempt BOOLEAN DEFAULT false;
    END IF;
END $$;

-- =====================================================
-- 4. Add cap tracking fields to creator_earnings table
-- =====================================================
DO $$
BEGIN
    -- Original commission before cap applied
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'original_commission'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN original_commission DECIMAL(10, 2);
    END IF;

    -- Was this earning capped?
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'was_capped'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN was_capped BOOLEAN DEFAULT false;
    END IF;

    -- Which cap was applied
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'cap_type_applied'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN cap_type_applied TEXT
            CHECK (cap_type_applied IN ('none', 'monthly_max', 'tiered', 'both'));
    END IF;

    -- Effective rate after tiering
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'effective_rate_percent'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN effective_rate_percent DECIMAL(5, 2);
    END IF;

    -- Which tier this referral fell into
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'tier_applied'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN tier_applied INTEGER;
    END IF;
END $$;

-- =====================================================
-- 5. Function to get creator's commission cap config
-- =====================================================
CREATE OR REPLACE FUNCTION get_creator_commission_cap(p_creator_id UUID)
RETURNS TABLE (
    max_monthly_commission DECIMAL(10, 2),
    tier1_referral_limit INTEGER,
    tier1_rate_percent DECIMAL(5, 2),
    tier2_referral_limit INTEGER,
    tier2_rate_percent DECIMAL(5, 2),
    tier3_rate_percent DECIMAL(5, 2),
    cap_method TEXT,
    new_creator_grace_days INTEGER,
    is_exempt BOOLEAN,
    in_grace_period BOOLEAN
) AS $$
DECLARE
    v_creator RECORD;
    v_config RECORD;
    v_grace_end TIMESTAMPTZ;
BEGIN
    -- Check if creator is exempt
    SELECT * INTO v_creator FROM creators WHERE id = p_creator_id;

    IF v_creator.is_cap_exempt THEN
        RETURN QUERY SELECT
            999999.99::DECIMAL(10, 2),  -- Effectively no cap
            999999::INTEGER,
            25.00::DECIMAL(5, 2),
            999999::INTEGER,
            25.00::DECIMAL(5, 2),
            25.00::DECIMAL(5, 2),
            'none'::TEXT,
            0::INTEGER,
            true::BOOLEAN,
            false::BOOLEAN;
        RETURN;
    END IF;

    -- Get custom config for creator or default
    SELECT * INTO v_config FROM creator_commission_caps
    WHERE (creator_id = p_creator_id OR is_default = true)
    AND is_active = true
    ORDER BY creator_id NULLS LAST  -- Prefer creator-specific over default
    LIMIT 1;

    IF v_config IS NULL THEN
        -- Fallback defaults if no config exists
        RETURN QUERY SELECT
            500.00::DECIMAL(10, 2),
            20::INTEGER,
            25.00::DECIMAL(5, 2),
            30::INTEGER,
            15.00::DECIMAL(5, 2),
            10.00::DECIMAL(5, 2),
            'both'::TEXT,
            30::INTEGER,
            false::BOOLEAN,
            false::BOOLEAN;
        RETURN;
    END IF;

    -- Check grace period
    v_grace_end := v_creator.created_at + (v_config.new_creator_grace_days || ' days')::INTERVAL;

    RETURN QUERY SELECT
        v_config.max_monthly_commission,
        v_config.tier1_referral_limit,
        v_config.tier1_rate_percent,
        v_config.tier2_referral_limit,
        v_config.tier2_rate_percent,
        v_config.tier3_rate_percent,
        v_config.cap_method,
        v_config.new_creator_grace_days,
        false::BOOLEAN,
        NOW() < v_grace_end;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. Function to calculate capped commission
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_capped_commission(
    p_creator_id UUID,
    p_net_revenue DECIMAL(10, 2),
    p_base_rate_percent DECIMAL(5, 2) DEFAULT 25.00
)
RETURNS TABLE (
    final_commission DECIMAL(10, 2),
    original_commission DECIMAL(10, 2),
    effective_rate DECIMAL(5, 2),
    tier_applied INTEGER,
    was_capped BOOLEAN,
    cap_type TEXT,
    remaining_monthly_cap DECIMAL(10, 2)
) AS $$
DECLARE
    v_cap RECORD;
    v_monthly RECORD;
    v_year_month TEXT;
    v_base_commission DECIMAL(10, 2);
    v_tiered_commission DECIMAL(10, 2);
    v_effective_rate DECIMAL(5, 2);
    v_tier INTEGER;
    v_final DECIMAL(10, 2);
    v_was_capped BOOLEAN := false;
    v_cap_type TEXT := 'none';
    v_remaining DECIMAL(10, 2);
    v_current_referrals INTEGER;
BEGIN
    -- Get cap config
    SELECT * INTO v_cap FROM get_creator_commission_cap(p_creator_id);

    -- If in grace period or exempt, use base rate with no caps
    IF v_cap.is_exempt OR v_cap.in_grace_period THEN
        v_base_commission := p_net_revenue * (p_base_rate_percent / 100);
        RETURN QUERY SELECT
            v_base_commission,
            v_base_commission,
            p_base_rate_percent,
            1::INTEGER,
            false,
            'none'::TEXT,
            999999.99::DECIMAL(10, 2);
        RETURN;
    END IF;

    -- Calculate base commission (before caps)
    v_base_commission := p_net_revenue * (p_base_rate_percent / 100);

    -- Get current month stats
    v_year_month := to_char(NOW(), 'YYYY-MM');

    SELECT * INTO v_monthly FROM creator_monthly_commissions
    WHERE creator_id = p_creator_id AND year_month = v_year_month;

    v_current_referrals := COALESCE(v_monthly.paid_referrals, 0);

    -- =====================================================
    -- OPTION 2: Apply tiered rates if enabled
    -- =====================================================
    IF v_cap.cap_method IN ('tiered', 'both') THEN
        IF v_current_referrals < v_cap.tier1_referral_limit THEN
            -- Tier 1: Full rate
            v_tier := 1;
            v_effective_rate := v_cap.tier1_rate_percent;
        ELSIF v_current_referrals < (v_cap.tier1_referral_limit + v_cap.tier2_referral_limit) THEN
            -- Tier 2: Reduced rate
            v_tier := 2;
            v_effective_rate := v_cap.tier2_rate_percent;
        ELSE
            -- Tier 3: Lowest rate
            v_tier := 3;
            v_effective_rate := v_cap.tier3_rate_percent;
        END IF;

        v_tiered_commission := p_net_revenue * (v_effective_rate / 100);

        IF v_tiered_commission < v_base_commission THEN
            v_was_capped := true;
            v_cap_type := 'tiered';
        END IF;
    ELSE
        v_tier := 1;
        v_effective_rate := p_base_rate_percent;
        v_tiered_commission := v_base_commission;
    END IF;

    v_final := v_tiered_commission;

    -- =====================================================
    -- OPTION 1: Apply monthly cap if enabled
    -- =====================================================
    IF v_cap.cap_method IN ('monthly_max', 'both') THEN
        v_remaining := v_cap.max_monthly_commission - COALESCE(v_monthly.capped_commission, 0);

        IF v_remaining <= 0 THEN
            -- Already hit cap this month
            v_final := 0;
            v_was_capped := true;
            v_cap_type := 'monthly_max';
            v_remaining := 0;
        ELSIF v_final > v_remaining THEN
            -- This commission would exceed cap
            v_final := v_remaining;
            v_was_capped := true;
            IF v_cap_type = 'tiered' THEN
                v_cap_type := 'both';
            ELSE
                v_cap_type := 'monthly_max';
            END IF;
        END IF;
    ELSE
        v_remaining := 999999.99;
    END IF;

    RETURN QUERY SELECT
        v_final,
        v_base_commission,
        v_effective_rate,
        v_tier,
        v_was_capped,
        v_cap_type,
        v_remaining;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. RLS Policies
-- =====================================================
ALTER TABLE creator_commission_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_monthly_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to commission_caps"
    ON creator_commission_caps FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to monthly_commissions"
    ON creator_monthly_commissions FOR ALL
    USING (true)
    WITH CHECK (true);
