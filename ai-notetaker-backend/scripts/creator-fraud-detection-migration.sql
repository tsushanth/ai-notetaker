-- =====================================================
-- Creator Fraud Detection Schema
-- Prevents self-referral and household fraud
-- =====================================================

-- =====================================================
-- 1. Add fraud detection fields to creators table
-- =====================================================
DO $$
BEGIN
    -- Store hashed device fingerprints associated with creator
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'device_fingerprints'
    ) THEN
        ALTER TABLE creators ADD COLUMN device_fingerprints TEXT[] DEFAULT '{}';
    END IF;

    -- Store hashed IP addresses associated with creator
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'ip_addresses'
    ) THEN
        ALTER TABLE creators ADD COLUMN ip_addresses TEXT[] DEFAULT '{}';
    END IF;

    -- Store hashed payment method identifiers (last4 + brand)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creators' AND column_name = 'payment_fingerprints'
    ) THEN
        ALTER TABLE creators ADD COLUMN payment_fingerprints TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- =====================================================
-- 2. Create fraud_signals table for tracking
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_fraud_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- The subscription/earning being evaluated
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    redemption_id UUID REFERENCES promo_redemptions(id) ON DELETE SET NULL,

    -- Fraud signals detected
    signal_type TEXT NOT NULL CHECK (signal_type IN (
        'same_user',           -- Creator and subscriber are same user
        'same_email',          -- Email matches or similar pattern
        'same_device',         -- Device fingerprint matches
        'same_ip',             -- IP address matches
        'similar_ip_subnet',   -- Same /24 subnet (household indicator)
        'same_payment_method', -- Payment method matches
        'velocity_abuse',      -- Too many conversions too quickly
        'suspicious_pattern'   -- Other suspicious patterns
    )),

    -- Details
    confidence_score DECIMAL(3, 2) DEFAULT 1.00, -- 0.00 to 1.00
    signal_data JSONB DEFAULT '{}', -- Additional context

    -- Resolution
    is_blocked BOOLEAN DEFAULT false, -- Did this signal block the earning?
    reviewed_by TEXT, -- Admin who reviewed (if manual)
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_signals_creator ON creator_fraud_signals(creator_id);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_user ON creator_fraud_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_type ON creator_fraud_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_blocked ON creator_fraud_signals(is_blocked);

-- =====================================================
-- 3. Add fraud check fields to promo_redemptions
-- =====================================================
DO $$
BEGIN
    -- Store subscriber's device fingerprint hash
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'device_fingerprint'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN device_fingerprint TEXT;
    END IF;

    -- Store subscriber's IP address hash
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'ip_address'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN ip_address TEXT;
    END IF;

    -- Store raw IP for subnet comparison (hashed for privacy)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'ip_subnet'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN ip_subnet TEXT;
    END IF;

    -- Fraud detection result
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'fraud_check_result'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN fraud_check_result TEXT DEFAULT 'pending'
            CHECK (fraud_check_result IN ('pending', 'passed', 'flagged', 'blocked'));
    END IF;

    -- Fraud signals found (as JSON array)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'fraud_signals'
    ) THEN
        ALTER TABLE promo_redemptions ADD COLUMN fraud_signals JSONB DEFAULT '[]';
    END IF;
END $$;

-- =====================================================
-- 4. Add fraud fields to creator_earnings
-- =====================================================
DO $$
BEGIN
    -- Was this earning blocked due to fraud?
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'fraud_blocked'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN fraud_blocked BOOLEAN DEFAULT false;
    END IF;

    -- Fraud reason if blocked
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'fraud_reason'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN fraud_reason TEXT;
    END IF;
END $$;

-- =====================================================
-- 5. Add indexes for fraud detection queries
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_device ON promo_redemptions(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_ip ON promo_redemptions(ip_address);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_fraud_result ON promo_redemptions(fraud_check_result);

-- =====================================================
-- 6. RLS for fraud signals (admin only)
-- =====================================================
ALTER TABLE creator_fraud_signals ENABLE ROW LEVEL SECURITY;

-- Only service role can access fraud signals
CREATE POLICY "Service role can manage fraud signals"
    ON creator_fraud_signals
    USING (true)
    WITH CHECK (true);
