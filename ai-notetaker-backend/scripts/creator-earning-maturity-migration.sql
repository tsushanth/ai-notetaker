-- =====================================================
-- Creator Earning Maturity Schema
-- Delays payouts 30-60 days to prevent refund abuse
-- =====================================================

-- =====================================================
-- 1. Add maturity fields to creator_earnings table
-- =====================================================
DO $$
BEGIN
    -- When the earning becomes eligible for payout (30-60 days after creation)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'matures_at'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN matures_at TIMESTAMPTZ;
    END IF;

    -- When the earning was approved for payout
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    -- Track if subscription is still active at maturity
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'subscription_active_at_maturity'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN subscription_active_at_maturity BOOLEAN;
    END IF;

    -- Clawback tracking
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'clawback_reason'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN clawback_reason TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'clawback_at'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN clawback_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'creator_earnings' AND column_name = 'original_earning_amount'
    ) THEN
        ALTER TABLE creator_earnings ADD COLUMN original_earning_amount DECIMAL(10, 2);
    END IF;
END $$;

-- =====================================================
-- 2. Update status check constraint to include new statuses
-- =====================================================
DO $$
BEGIN
    -- Drop existing constraint if it exists
    ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_status_check;

    -- Add updated constraint with new statuses
    ALTER TABLE creator_earnings ADD CONSTRAINT creator_earnings_status_check
        CHECK (status IN (
            'pending',    -- Initial state, waiting for maturity period
            'maturing',   -- In 30-60 day hold period
            'approved',   -- Matured and approved for payout
            'paid',       -- Included in a payout
            'cancelled',  -- Cancelled (refund before maturity)
            'clawback',   -- Clawed back (refund/chargeback after approval)
            'held',       -- On hold (fraud or manual review)
            'rejected'    -- Rejected (fraud confirmed)
        ));
END $$;

-- =====================================================
-- 3. Add indexes for maturity queries
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_creator_earnings_matures_at
    ON creator_earnings(matures_at)
    WHERE status = 'maturing';

CREATE INDEX IF NOT EXISTS idx_creator_earnings_approved
    ON creator_earnings(approved_at)
    WHERE status = 'approved';

-- =====================================================
-- 4. Create clawback_events table for audit trail
-- =====================================================
CREATE TABLE IF NOT EXISTS creator_clawback_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Related records
    earning_id UUID REFERENCES creator_earnings(id) ON DELETE SET NULL,
    creator_id UUID REFERENCES creators(id) ON DELETE CASCADE NOT NULL,
    subscription_id UUID,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Clawback details
    reason TEXT NOT NULL CHECK (reason IN (
        'refund',           -- User requested refund
        'chargeback',       -- Payment disputed
        'subscription_cancelled', -- User cancelled before maturity
        'fraud',            -- Fraud detected
        'adjustment',       -- Manual adjustment
        'duplicate'         -- Duplicate earning
    )),

    -- Amounts
    original_amount DECIMAL(10, 2) NOT NULL,
    clawback_amount DECIMAL(10, 2) NOT NULL,

    -- Source info
    source_event_id TEXT, -- Stripe refund ID, chargeback ID, etc.
    source_platform TEXT, -- 'stripe', 'apple', 'google'

    -- Notes
    notes TEXT,
    processed_by TEXT, -- 'system' or admin email

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clawback_events_creator ON creator_clawback_events(creator_id);
CREATE INDEX IF NOT EXISTS idx_clawback_events_earning ON creator_clawback_events(earning_id);
CREATE INDEX IF NOT EXISTS idx_clawback_events_created ON creator_clawback_events(created_at DESC);

-- =====================================================
-- 5. Add RLS for clawback events
-- =====================================================
ALTER TABLE creator_clawback_events ENABLE ROW LEVEL SECURITY;

-- Only service role can access clawback events
CREATE POLICY "Service role can manage clawback events"
    ON creator_clawback_events
    USING (true)
    WITH CHECK (true);

-- =====================================================
-- 6. Function to set maturity date on new earnings
-- =====================================================
CREATE OR REPLACE FUNCTION set_earning_maturity_date()
RETURNS TRIGGER AS $$
BEGIN
    -- Set maturity date to 45 days from creation (middle of 30-60 day window)
    -- This gives buffer for both App Store (30 days) and potential chargebacks (60 days)
    IF NEW.matures_at IS NULL AND NEW.status = 'pending' THEN
        NEW.matures_at := NEW.created_at + INTERVAL '45 days';
        NEW.status := 'maturing';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS set_earning_maturity ON creator_earnings;
CREATE TRIGGER set_earning_maturity
    BEFORE INSERT ON creator_earnings
    FOR EACH ROW
    EXECUTE FUNCTION set_earning_maturity_date();

-- =====================================================
-- 7. Update existing pending earnings to maturing status
-- =====================================================
UPDATE creator_earnings
SET
    status = 'maturing',
    matures_at = created_at + INTERVAL '45 days'
WHERE status = 'pending' AND matures_at IS NULL;
