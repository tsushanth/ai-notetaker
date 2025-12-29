-- =====================================================
-- CREATOR NETWORK COMPLETE MIGRATION
-- Run this file in Supabase SQL Editor to set up all
-- creator network tables and abuse prevention rules
-- =====================================================

-- =====================================================
-- MIGRATION 1: Core Creator Network Tables
-- =====================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CREATORS TABLE
CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  social_platform TEXT,
  social_url TEXT,
  social_followers INTEGER,
  stripe_connect_account_id TEXT,
  stripe_connect_status TEXT DEFAULT 'pending' CHECK (stripe_connect_status IN (
    'pending', 'onboarding', 'active', 'restricted', 'disabled'
  )),
  stripe_onboarding_complete BOOLEAN DEFAULT false,
  revenue_share_percent DECIMAL(5, 2) DEFAULT 25.00,
  minimum_payout_amount DECIMAL(10, 2) DEFAULT 50.00,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  has_premium_access BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PROMO_CODES TABLE
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  discount_type TEXT DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed', 'trial_extension')),
  discount_value DECIMAL(10, 2) DEFAULT 0,
  trial_extension_days INTEGER DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  max_redemptions INTEGER,
  current_redemptions INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROMO_REDEMPTIONS TABLE
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  creator_id UUID REFERENCES creators(id) ON DELETE SET NULL,
  code_used TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  attribution_status TEXT DEFAULT 'pending' CHECK (attribution_status IN (
    'pending', 'attributed', 'expired', 'cancelled', 'invalid'
  )),
  attributed_at TIMESTAMPTZ,
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  discount_type TEXT,
  discount_value DECIMAL(10, 2),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CREATOR_EARNINGS TABLE
CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
  redemption_id UUID REFERENCES promo_redemptions(id) ON DELETE SET NULL,
  subscription_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'subscription_new', 'subscription_renewal', 'adjustment', 'clawback'
  )),
  gross_amount DECIMAL(10, 2) NOT NULL,
  platform_fee_percent DECIMAL(5, 2),
  platform_fee_amount DECIMAL(10, 2),
  net_revenue DECIMAL(10, 2) NOT NULL,
  revenue_share_percent DECIMAL(5, 2) NOT NULL,
  creator_earning DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'maturing', 'approved', 'paid', 'cancelled', 'clawback', 'held', 'rejected'
  )),
  payout_id UUID,
  earning_period_start TIMESTAMPTZ,
  earning_period_end TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CREATOR_PAYOUTS TABLE
CREATE TABLE IF NOT EXISTS creator_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  stripe_transfer_id TEXT,
  stripe_payout_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  )),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  initiated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_creators_user_id ON creators(user_id);
CREATE INDEX IF NOT EXISTS idx_creators_email ON creators(email);
CREATE INDEX IF NOT EXISTS idx_creators_username ON creators(username);
CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status);
CREATE INDEX IF NOT EXISTS idx_promo_codes_creator_id ON promo_codes(creator_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user_id ON promo_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_creator_id ON promo_redemptions(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_id ON creator_earnings(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_status ON creator_earnings(status);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator_id ON creator_payouts(creator_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_creators_updated_at ON creators;
CREATE TRIGGER update_creators_updated_at
    BEFORE UPDATE ON creators
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_promo_codes_updated_at ON promo_codes;
CREATE TRIGGER update_promo_codes_updated_at
    BEFORE UPDATE ON promo_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payouts ENABLE ROW LEVEL SECURITY;

-- RLS policies for service role (DROP then CREATE pattern)
DROP POLICY IF EXISTS "Service role full access to creators" ON creators;
CREATE POLICY "Service role full access to creators"
    ON creators FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to promo_codes" ON promo_codes;
CREATE POLICY "Service role full access to promo_codes"
    ON promo_codes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to promo_redemptions" ON promo_redemptions;
CREATE POLICY "Service role full access to promo_redemptions"
    ON promo_redemptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to creator_earnings" ON creator_earnings;
CREATE POLICY "Service role full access to creator_earnings"
    ON creator_earnings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to creator_payouts" ON creator_payouts;
CREATE POLICY "Service role full access to creator_payouts"
    ON creator_payouts FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 2: Earning Maturity (Rule 3)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'matures_at') THEN
        ALTER TABLE creator_earnings ADD COLUMN matures_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'approved_at') THEN
        ALTER TABLE creator_earnings ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'subscription_active_at_maturity') THEN
        ALTER TABLE creator_earnings ADD COLUMN subscription_active_at_maturity BOOLEAN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'clawback_reason') THEN
        ALTER TABLE creator_earnings ADD COLUMN clawback_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'clawback_at') THEN
        ALTER TABLE creator_earnings ADD COLUMN clawback_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'original_earning_amount') THEN
        ALTER TABLE creator_earnings ADD COLUMN original_earning_amount DECIMAL(10, 2);
    END IF;
END $$;

-- Clawback events table
CREATE TABLE IF NOT EXISTS creator_clawback_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    earning_id UUID REFERENCES creator_earnings(id) ON DELETE SET NULL,
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    subscription_id UUID,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL CHECK (reason IN (
        'refund', 'chargeback', 'subscription_cancelled', 'fraud', 'adjustment', 'duplicate'
    )),
    original_amount DECIMAL(10, 2) NOT NULL,
    clawback_amount DECIMAL(10, 2) NOT NULL,
    source_event_id TEXT,
    source_platform TEXT,
    notes TEXT,
    processed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clawback_events_creator ON creator_clawback_events(creator_id);
ALTER TABLE creator_clawback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to clawback_events" ON creator_clawback_events;
CREATE POLICY "Service role full access to clawback_events"
    ON creator_clawback_events FOR ALL USING (true) WITH CHECK (true);

-- Maturity trigger
CREATE OR REPLACE FUNCTION set_earning_maturity_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.matures_at IS NULL AND NEW.status = 'pending' THEN
        NEW.matures_at := NEW.created_at + INTERVAL '45 days';
        NEW.status := 'maturing';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_earning_maturity ON creator_earnings;
CREATE TRIGGER set_earning_maturity
    BEFORE INSERT ON creator_earnings
    FOR EACH ROW
    EXECUTE FUNCTION set_earning_maturity_date();

-- =====================================================
-- MIGRATION 3: Fraud Detection (Rule 5)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'device_fingerprints') THEN
        ALTER TABLE creators ADD COLUMN device_fingerprints TEXT[] DEFAULT '{}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'ip_addresses') THEN
        ALTER TABLE creators ADD COLUMN ip_addresses TEXT[] DEFAULT '{}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'payment_fingerprints') THEN
        ALTER TABLE creators ADD COLUMN payment_fingerprints TEXT[] DEFAULT '{}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'device_fingerprint') THEN
        ALTER TABLE promo_redemptions ADD COLUMN device_fingerprint TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'ip_address') THEN
        ALTER TABLE promo_redemptions ADD COLUMN ip_address TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'ip_subnet') THEN
        ALTER TABLE promo_redemptions ADD COLUMN ip_subnet TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'fraud_check_result') THEN
        ALTER TABLE promo_redemptions ADD COLUMN fraud_check_result TEXT DEFAULT 'pending'
            CHECK (fraud_check_result IN ('pending', 'passed', 'flagged', 'blocked'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'fraud_signals') THEN
        ALTER TABLE promo_redemptions ADD COLUMN fraud_signals JSONB DEFAULT '[]';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'fraud_blocked') THEN
        ALTER TABLE creator_earnings ADD COLUMN fraud_blocked BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'fraud_reason') THEN
        ALTER TABLE creator_earnings ADD COLUMN fraud_reason TEXT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS creator_fraud_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    redemption_id UUID REFERENCES promo_redemptions(id) ON DELETE SET NULL,
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'same_user', 'same_email', 'same_device', 'same_ip', 'similar_ip_subnet',
        'same_payment_method', 'velocity_abuse', 'suspicious_pattern'
    )),
    confidence_score DECIMAL(3, 2) DEFAULT 1.00,
    signal_data JSONB DEFAULT '{}',
    is_blocked BOOLEAN DEFAULT false,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_creator ON creator_fraud_signals(creator_id);
ALTER TABLE creator_fraud_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to fraud_signals" ON creator_fraud_signals;
CREATE POLICY "Service role full access to fraud_signals"
    ON creator_fraud_signals FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 4: Trial Abuse Prevention (Rule 6)
-- =====================================================

CREATE TABLE IF NOT EXISTS trial_fingerprints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_fingerprint TEXT,
    payment_fingerprint TEXT,
    email_hash TEXT,
    email_base_hash TEXT,
    ip_hash TEXT,
    ip_subnet_hash TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    trial_started_at TIMESTAMPTZ DEFAULT NOW(),
    trial_ended_at TIMESTAMPTZ,
    trial_converted BOOLEAN DEFAULT false,
    promo_code_id UUID,
    creator_id UUID REFERENCES creators(id) ON DELETE SET NULL,
    platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
    abuse_score DECIMAL(3, 2) DEFAULT 0.00,
    abuse_signals JSONB DEFAULT '[]',
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_device ON trial_fingerprints(device_fingerprint) WHERE device_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_payment ON trial_fingerprints(payment_fingerprint) WHERE payment_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trial_fingerprints_email ON trial_fingerprints(email_hash) WHERE email_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS trial_abuse_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_type TEXT NOT NULL CHECK (cluster_type IN ('device', 'payment', 'email_alias', 'ip_subnet', 'mixed')),
    cluster_hash TEXT NOT NULL,
    trial_count INTEGER DEFAULT 1,
    user_ids UUID[] DEFAULT '{}',
    email_hashes TEXT[] DEFAULT '{}',
    is_flagged BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    review_status TEXT DEFAULT 'pending' CHECK (review_status IN (
        'pending', 'reviewing', 'cleared', 'confirmed_abuse', 'auto_blocked'
    )),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cluster_type, cluster_hash)
);

CREATE TABLE IF NOT EXISTS trial_abuse_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    max_trials_per_device INTEGER DEFAULT 1,
    max_trials_per_payment_method INTEGER DEFAULT 1,
    max_trials_per_email_base INTEGER DEFAULT 2,
    max_trials_per_ip INTEGER DEFAULT 3,
    max_trials_per_subnet INTEGER DEFAULT 5,
    device_lookback_days INTEGER DEFAULT 365,
    payment_lookback_days INTEGER DEFAULT 365,
    email_lookback_days INTEGER DEFAULT 365,
    ip_lookback_days INTEGER DEFAULT 90,
    subnet_lookback_days INTEGER DEFAULT 90,
    cluster_flag_threshold INTEGER DEFAULT 3,
    cluster_block_threshold INTEGER DEFAULT 5,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_active_trial_config UNIQUE (is_active)
);

INSERT INTO trial_abuse_config (
    max_trials_per_device, max_trials_per_payment_method, max_trials_per_email_base,
    max_trials_per_ip, max_trials_per_subnet, cluster_flag_threshold, cluster_block_threshold, is_active
) VALUES (1, 1, 2, 3, 5, 3, 5, true) ON CONFLICT DO NOTHING;

ALTER TABLE trial_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_abuse_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_abuse_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to trial_fingerprints" ON trial_fingerprints;
CREATE POLICY "Service role full access to trial_fingerprints"
    ON trial_fingerprints FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to trial_abuse_clusters" ON trial_abuse_clusters;
CREATE POLICY "Service role full access to trial_abuse_clusters"
    ON trial_abuse_clusters FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to trial_abuse_config" ON trial_abuse_config;
CREATE POLICY "Service role full access to trial_abuse_config"
    ON trial_abuse_config FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 5: Activity Tracking (Rule 7)
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'last_activity_check_at') THEN
        ALTER TABLE creators ADD COLUMN last_activity_check_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'premium_granted_at') THEN
        ALTER TABLE creators ADD COLUMN premium_granted_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'premium_expires_at') THEN
        ALTER TABLE creators ADD COLUMN premium_expires_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'activity_status') THEN
        ALTER TABLE creators ADD COLUMN activity_status TEXT DEFAULT 'active'
            CHECK (activity_status IN ('active', 'warning', 'final_warning', 'downgraded', 'exempt'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'downgrade_warning_sent_at') THEN
        ALTER TABLE creators ADD COLUMN downgrade_warning_sent_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'final_warning_sent_at') THEN
        ALTER TABLE creators ADD COLUMN final_warning_sent_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'downgraded_at') THEN
        ALTER TABLE creators ADD COLUMN downgraded_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'is_activity_exempt') THEN
        ALTER TABLE creators ADD COLUMN is_activity_exempt BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'content_submissions_count') THEN
        ALTER TABLE creators ADD COLUMN content_submissions_count INTEGER DEFAULT 0;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS creator_activity_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    activity_window_days INTEGER DEFAULT 90,
    min_paid_referrals INTEGER DEFAULT 1,
    min_content_submissions INTEGER DEFAULT 2,
    min_total_signups INTEGER DEFAULT 10,
    warning_period_days INTEGER DEFAULT 14,
    final_warning_days INTEGER DEFAULT 7,
    grace_period_days INTEGER DEFAULT 7,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_active_activity_config UNIQUE (is_active)
);

INSERT INTO creator_activity_config (
    activity_window_days, min_paid_referrals, min_content_submissions, min_total_signups, is_active
) VALUES (90, 1, 2, 10, true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS creator_content_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('video', 'blog', 'social_post', 'podcast', 'other')),
    content_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    platform TEXT,
    is_verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_submissions_creator ON creator_content_submissions(creator_id);
ALTER TABLE creator_activity_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_content_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to activity_config" ON creator_activity_config;
CREATE POLICY "Service role full access to activity_config"
    ON creator_activity_config FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to content_submissions" ON creator_content_submissions;
CREATE POLICY "Service role full access to content_submissions"
    ON creator_content_submissions FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 6: Usage Limits (Rule 8)
-- =====================================================

CREATE TABLE IF NOT EXISTS creator_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    usage_type TEXT NOT NULL CHECK (usage_type IN (
        'ai_summary', 'ai_quiz', 'ai_flashcards', 'ai_podcast', 'ai_diagram',
        'ai_chat', 'transcription', 'pdf_processing', 'video_processing'
    )),
    tokens_used INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    note_id UUID,
    request_size_bytes INTEGER,
    processing_time_ms INTEGER,
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'queued', 'processing', 'failed', 'rate_limited')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creator_usage_creator_id ON creator_usage(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_usage_created_at ON creator_usage(created_at DESC);

CREATE TABLE IF NOT EXISTS creator_usage_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    max_generations_per_month INTEGER DEFAULT 500,
    max_generations_per_day INTEGER DEFAULT 50,
    max_input_tokens INTEGER DEFAULT 100000,
    max_output_tokens INTEGER DEFAULT 16000,
    max_podcast_per_month INTEGER DEFAULT 100,
    max_video_processing_per_month INTEGER DEFAULT 50,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_default_limits UNIQUE (is_default)
);

INSERT INTO creator_usage_limits (
    is_default, max_generations_per_month, max_generations_per_day, max_podcast_per_month, max_video_processing_per_month
) VALUES (true, 500, 50, 100, 50) ON CONFLICT DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'current_month_generations') THEN
        ALTER TABLE creators ADD COLUMN current_month_generations INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'current_day_generations') THEN
        ALTER TABLE creators ADD COLUMN current_day_generations INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'abuse_flagged') THEN
        ALTER TABLE creators ADD COLUMN abuse_flagged BOOLEAN DEFAULT false;
    END IF;
END $$;

ALTER TABLE creator_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_usage_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to creator_usage" ON creator_usage;
CREATE POLICY "Service role full access to creator_usage"
    ON creator_usage FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to creator_usage_limits" ON creator_usage_limits;
CREATE POLICY "Service role full access to creator_usage_limits"
    ON creator_usage_limits FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 7: Commission Caps (Rule 9)
-- =====================================================

CREATE TABLE IF NOT EXISTS creator_commission_caps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT false,
    max_monthly_commission DECIMAL(10, 2) DEFAULT 500.00,
    tier1_referral_limit INTEGER DEFAULT 20,
    tier1_rate_percent DECIMAL(5, 2) DEFAULT 25.00,
    tier2_referral_limit INTEGER DEFAULT 30,
    tier2_rate_percent DECIMAL(5, 2) DEFAULT 15.00,
    tier3_rate_percent DECIMAL(5, 2) DEFAULT 10.00,
    cap_method TEXT DEFAULT 'both' CHECK (cap_method IN ('monthly_max', 'tiered', 'both')),
    new_creator_grace_days INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_default_commission_cap UNIQUE (is_default)
);

INSERT INTO creator_commission_caps (
    is_default, max_monthly_commission, tier1_referral_limit, tier1_rate_percent,
    tier2_referral_limit, tier2_rate_percent, tier3_rate_percent, cap_method, is_active
) VALUES (true, 500.00, 20, 25.00, 30, 15.00, 10.00, 'both', true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS creator_monthly_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    year_month TEXT NOT NULL,
    total_referrals INTEGER DEFAULT 0,
    paid_referrals INTEGER DEFAULT 0,
    gross_commission DECIMAL(10, 2) DEFAULT 0.00,
    capped_commission DECIMAL(10, 2) DEFAULT 0.00,
    cap_savings DECIMAL(10, 2) DEFAULT 0.00,
    tier1_referrals INTEGER DEFAULT 0,
    tier1_commission DECIMAL(10, 2) DEFAULT 0.00,
    tier2_referrals INTEGER DEFAULT 0,
    tier2_commission DECIMAL(10, 2) DEFAULT 0.00,
    tier3_referrals INTEGER DEFAULT 0,
    tier3_commission DECIMAL(10, 2) DEFAULT 0.00,
    monthly_cap_hit BOOLEAN DEFAULT false,
    monthly_cap_hit_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(creator_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_commissions_creator ON creator_monthly_commissions(creator_id, year_month DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'current_month_commission') THEN
        ALTER TABLE creators ADD COLUMN current_month_commission DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'current_month_referrals') THEN
        ALTER TABLE creators ADD COLUMN current_month_referrals INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'is_cap_exempt') THEN
        ALTER TABLE creators ADD COLUMN is_cap_exempt BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'original_commission') THEN
        ALTER TABLE creator_earnings ADD COLUMN original_commission DECIMAL(10, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'was_capped') THEN
        ALTER TABLE creator_earnings ADD COLUMN was_capped BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'cap_type_applied') THEN
        ALTER TABLE creator_earnings ADD COLUMN cap_type_applied TEXT
            CHECK (cap_type_applied IN ('none', 'monthly_max', 'tiered', 'both'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'effective_rate_percent') THEN
        ALTER TABLE creator_earnings ADD COLUMN effective_rate_percent DECIMAL(5, 2);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'tier_applied') THEN
        ALTER TABLE creator_earnings ADD COLUMN tier_applied INTEGER;
    END IF;
END $$;

ALTER TABLE creator_commission_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_monthly_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to commission_caps" ON creator_commission_caps;
CREATE POLICY "Service role full access to commission_caps"
    ON creator_commission_caps FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to monthly_commissions" ON creator_monthly_commissions;
CREATE POLICY "Service role full access to monthly_commissions"
    ON creator_monthly_commissions FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- MIGRATION 8: Fraud Anomaly Detection (Rule 10)
-- =====================================================

CREATE TABLE IF NOT EXISTS creator_fraud_anomaly_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    refund_rate_threshold_percent DECIMAL(5, 2) DEFAULT 40.00,
    min_referrals_for_refund_check INTEGER DEFAULT 5,
    refund_lookback_days INTEGER DEFAULT 90,
    max_signups_per_device INTEGER DEFAULT 2,
    max_signups_per_ip INTEGER DEFAULT 3,
    max_signups_per_subnet INTEGER DEFAULT 5,
    device_ip_lookback_days INTEGER DEFAULT 30,
    max_signups_per_velocity_window INTEGER DEFAULT 10,
    velocity_window_hours INTEGER DEFAULT 2,
    max_signups_per_bin INTEGER DEFAULT 3,
    bin_lookback_days INTEGER DEFAULT 30,
    geo_anomaly_threshold_percent DECIMAL(5, 2) DEFAULT 80.00,
    min_signups_for_geo_check INTEGER DEFAULT 10,
    auto_freeze_on_flag BOOLEAN DEFAULT true,
    auto_suspend_on_severe BOOLEAN DEFAULT false,
    severe_fraud_threshold DECIMAL(3, 2) DEFAULT 0.90,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_active_fraud_config UNIQUE (is_active)
);

INSERT INTO creator_fraud_anomaly_config (
    refund_rate_threshold_percent, min_referrals_for_refund_check, max_signups_per_device,
    max_signups_per_ip, max_signups_per_velocity_window, velocity_window_hours, auto_freeze_on_flag, is_active
) VALUES (40.00, 5, 2, 3, 10, 2, true, true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS creator_fraud_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    flag_type TEXT NOT NULL CHECK (flag_type IN (
        'high_refund_rate', 'device_clustering', 'ip_clustering', 'subnet_clustering',
        'velocity_spike', 'bin_clustering', 'geo_anomaly', 'self_referral', 'synthetic_identity', 'manual_flag'
    )),
    severity_score DECIMAL(3, 2) NOT NULL DEFAULT 0.50,
    evidence JSONB NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'reviewing', 'confirmed', 'dismissed', 'resolved')),
    commission_frozen BOOLEAN DEFAULT false,
    commission_frozen_at TIMESTAMPTZ,
    creator_suspended BOOLEAN DEFAULT false,
    creator_suspended_at TIMESTAMPTZ,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    resolution_notes TEXT,
    affected_earnings_ids UUID[] DEFAULT '{}',
    affected_redemption_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_creator ON creator_fraud_flags(creator_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_status ON creator_fraud_flags(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS creator_fraud_scans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    scan_type TEXT NOT NULL CHECK (scan_type IN ('scheduled', 'triggered', 'manual')),
    flags_created INTEGER DEFAULT 0,
    anomalies_detected JSONB DEFAULT '[]',
    scan_metrics JSONB DEFAULT '{}',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_scans_creator ON creator_fraud_scans(creator_id, created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'fraud_risk_score') THEN
        ALTER TABLE creators ADD COLUMN fraud_risk_score DECIMAL(3, 2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'active_fraud_flags') THEN
        ALTER TABLE creators ADD COLUMN active_fraud_flags INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'commission_frozen') THEN
        ALTER TABLE creators ADD COLUMN commission_frozen BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'commission_frozen_at') THEN
        ALTER TABLE creators ADD COLUMN commission_frozen_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'commission_frozen_reason') THEN
        ALTER TABLE creators ADD COLUMN commission_frozen_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'last_fraud_scan_at') THEN
        ALTER TABLE creators ADD COLUMN last_fraud_scan_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creators' AND column_name = 'requires_fraud_review') THEN
        ALTER TABLE creators ADD COLUMN requires_fraud_review BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'card_bin_hash') THEN
        ALTER TABLE promo_redemptions ADD COLUMN card_bin_hash TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'geo_country') THEN
        ALTER TABLE promo_redemptions ADD COLUMN geo_country TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'geo_region') THEN
        ALTER TABLE promo_redemptions ADD COLUMN geo_region TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'promo_redemptions' AND column_name = 'anomaly_score') THEN
        ALTER TABLE promo_redemptions ADD COLUMN anomaly_score DECIMAL(3, 2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'was_refunded') THEN
        ALTER TABLE creator_earnings ADD COLUMN was_refunded BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'refunded_at') THEN
        ALTER TABLE creator_earnings ADD COLUMN refunded_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'was_chargeback') THEN
        ALTER TABLE creator_earnings ADD COLUMN was_chargeback BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creator_earnings' AND column_name = 'chargeback_at') THEN
        ALTER TABLE creator_earnings ADD COLUMN chargeback_at TIMESTAMPTZ;
    END IF;
END $$;

ALTER TABLE creator_fraud_anomaly_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_fraud_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_fraud_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to fraud_anomaly_config" ON creator_fraud_anomaly_config;
CREATE POLICY "Service role full access to fraud_anomaly_config"
    ON creator_fraud_anomaly_config FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to fraud_flags" ON creator_fraud_flags;
CREATE POLICY "Service role full access to fraud_flags"
    ON creator_fraud_flags FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to fraud_scans" ON creator_fraud_scans;
CREATE POLICY "Service role full access to fraud_scans"
    ON creator_fraud_scans FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- COMPLETE!
-- =====================================================
SELECT 'Creator Network migration complete! All 10 rules are now configured.' as status;
