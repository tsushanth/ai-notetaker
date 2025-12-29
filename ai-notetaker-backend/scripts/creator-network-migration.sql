-- =====================================================
-- Creator Network Database Schema
-- Run this migration to add creator program tables
-- =====================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. CREATORS TABLE - Creator profiles and settings
-- =====================================================
CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Can link to user if they have a Scribe AI account, but NOT required
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE,

  -- Creator profile info (required for standalone creators)
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,  -- Used for promo code generation

  -- Social media / creator profile
  social_platform TEXT,  -- 'youtube', 'tiktok', 'instagram', 'twitter', 'other'
  social_url TEXT,
  social_followers INTEGER,

  -- Stripe Connect for payouts
  stripe_connect_account_id TEXT,
  stripe_connect_status TEXT DEFAULT 'pending' CHECK (stripe_connect_status IN (
    'pending',       -- Not yet connected
    'onboarding',    -- Started Stripe onboarding
    'active',        -- Can receive payouts
    'restricted',    -- Needs more info
    'disabled'       -- Disabled by us
  )),
  stripe_onboarding_complete BOOLEAN DEFAULT false,

  -- Revenue settings
  revenue_share_percent DECIMAL(5, 2) DEFAULT 25.00,  -- 25% default
  minimum_payout_amount DECIMAL(10, 2) DEFAULT 50.00, -- $50 minimum

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),

  -- Premium access for creator
  has_premium_access BOOLEAN DEFAULT true,  -- Creators get free premium

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. PROMO_CODES TABLE - Unique codes linked to creators
-- =====================================================
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

  -- Code format: SCRIBEAI-<USERNAME_PREFIX><NUMBER?>
  code TEXT NOT NULL UNIQUE,

  -- Code settings
  is_active BOOLEAN DEFAULT true,
  discount_type TEXT DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed', 'trial_extension')),
  discount_value DECIMAL(10, 2) DEFAULT 0,  -- Percentage or fixed amount
  trial_extension_days INTEGER DEFAULT 0,   -- Extra trial days (optional)

  -- Validity
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,  -- NULL = no expiry
  max_redemptions INTEGER,  -- NULL = unlimited
  current_redemptions INTEGER DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. PROMO_REDEMPTIONS TABLE - When users apply codes
-- =====================================================
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  promo_code_id UUID REFERENCES promo_codes(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  creator_id UUID REFERENCES creators(id) ON DELETE SET NULL,

  -- Redemption details
  code_used TEXT NOT NULL,  -- Store the actual code text
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Attribution status
  attribution_status TEXT DEFAULT 'pending' CHECK (attribution_status IN (
    'pending',      -- Code applied, waiting for subscription
    'attributed',   -- User subscribed, creator credited
    'expired',      -- User didn't subscribe in time
    'cancelled',    -- User cancelled/refunded
    'invalid'       -- Invalid redemption
  )),
  attributed_at TIMESTAMPTZ,  -- When conversion happened

  -- Platform info
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),

  -- Discount applied
  discount_type TEXT,
  discount_value DECIMAL(10, 2),

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. CREATOR_EARNINGS TABLE - Track earnings per transaction
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

  -- Source of earning
  redemption_id UUID REFERENCES promo_redemptions(id) ON DELETE SET NULL,
  subscription_id UUID,  -- Reference to subscriptions table
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Transaction details
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'subscription_new',    -- New subscription
    'subscription_renewal', -- Renewal
    'adjustment',          -- Manual adjustment
    'clawback'             -- Refund/cancellation
  )),

  -- Revenue calculation
  gross_amount DECIMAL(10, 2) NOT NULL,     -- Total subscription price
  platform_fee_percent DECIMAL(5, 2),        -- Apple/Google cut (15-30%)
  platform_fee_amount DECIMAL(10, 2),        -- Calculated platform fee
  net_revenue DECIMAL(10, 2) NOT NULL,       -- Revenue after platform fee
  revenue_share_percent DECIMAL(5, 2) NOT NULL, -- Creator's share %
  creator_earning DECIMAL(10, 2) NOT NULL,   -- Creator's actual earning
  currency TEXT DEFAULT 'USD',

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',    -- Waiting for payout
    'approved',   -- Approved for payout
    'paid',       -- Included in a payout
    'cancelled',  -- Cancelled (refund)
    'held'        -- On hold
  )),

  -- Payout reference
  payout_id UUID,  -- Will reference creator_payouts when paid

  -- Period info
  earning_period_start TIMESTAMPTZ,
  earning_period_end TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 5. CREATOR_PAYOUTS TABLE - Payout history
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_payouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,

  -- Payout amount
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',

  -- Stripe payout details
  stripe_transfer_id TEXT,
  stripe_payout_id TEXT,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',     -- Created, not yet processed
    'processing',  -- Stripe transfer initiated
    'completed',   -- Successfully paid
    'failed',      -- Transfer failed
    'cancelled'    -- Cancelled before processing
  )),

  -- Period covered
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  -- Processing dates
  initiated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error tracking
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES for performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_creators_user_id ON creators(user_id);
CREATE INDEX IF NOT EXISTS idx_creators_email ON creators(email);
CREATE INDEX IF NOT EXISTS idx_creators_username ON creators(username);
CREATE INDEX IF NOT EXISTS idx_creators_status ON creators(status);
CREATE INDEX IF NOT EXISTS idx_creators_stripe_status ON creators(stripe_connect_status);

CREATE INDEX IF NOT EXISTS idx_promo_codes_creator_id ON promo_codes(creator_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user_id ON promo_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_creator_id ON promo_redemptions(creator_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(code_used);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_status ON promo_redemptions(attribution_status);

CREATE INDEX IF NOT EXISTS idx_creator_earnings_creator_id ON creator_earnings(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_status ON creator_earnings(status);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_payout ON creator_earnings(payout_id);
CREATE INDEX IF NOT EXISTS idx_creator_earnings_created ON creator_earnings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_payouts_creator_id ON creator_payouts(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_payouts_status ON creator_payouts(status);

-- =====================================================
-- TRIGGERS for updated_at
-- =====================================================
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

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_payouts ENABLE ROW LEVEL SECURITY;

-- Creators can view their own profile
CREATE POLICY "Creators can view own profile"
    ON creators FOR SELECT
    USING (auth.uid() = user_id);

-- Public can view active promo codes (for validation)
CREATE POLICY "Anyone can view active promo codes"
    ON promo_codes FOR SELECT
    USING (is_active = true);

-- Users can view their own redemptions
CREATE POLICY "Users can view own redemptions"
    ON promo_redemptions FOR SELECT
    USING (auth.uid() = user_id);

-- Creators can view earnings for their account
CREATE POLICY "Creators can view own earnings"
    ON creator_earnings FOR SELECT
    USING (creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid()));

-- Creators can view their own payouts
CREATE POLICY "Creators can view own payouts"
    ON creator_payouts FOR SELECT
    USING (creator_id IN (SELECT id FROM creators WHERE user_id = auth.uid()));

-- =====================================================
-- Helper function to generate promo code
-- =====================================================
CREATE OR REPLACE FUNCTION generate_promo_code(creator_username TEXT)
RETURNS TEXT AS $$
DECLARE
    base_prefix TEXT;
    candidate_code TEXT;
    suffix_num INTEGER := 1;
BEGIN
    -- Get first 3 characters of username, uppercase
    base_prefix := UPPER(LEFT(creator_username, 3));
    candidate_code := 'SCRIBEAI-' || base_prefix;

    -- Check if code exists, add number suffix if needed
    WHILE EXISTS (SELECT 1 FROM promo_codes WHERE code = candidate_code) LOOP
        suffix_num := suffix_num + 1;
        candidate_code := 'SCRIBEAI-' || base_prefix || suffix_num::TEXT;
    END LOOP;

    RETURN candidate_code;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Add promo_code_id to subscriptions table (for attribution)
-- =====================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'subscriptions' AND column_name = 'promo_code_id'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN promo_code_id UUID REFERENCES promo_codes(id);
        ALTER TABLE subscriptions ADD COLUMN creator_id UUID REFERENCES creators(id);
        ALTER TABLE subscriptions ADD COLUMN discount_applied DECIMAL(10, 2) DEFAULT 0;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_promo_code ON subscriptions(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions(creator_id);
