-- Add discount tracking to promo_redemptions table
-- This tracks whether a user received their one-time 10% discount

-- Add discount_applied column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'promo_redemptions' AND column_name = 'discount_applied'
    ) THEN
        ALTER TABLE promo_redemptions
        ADD COLUMN discount_applied BOOLEAN DEFAULT false;

        COMMENT ON COLUMN promo_redemptions.discount_applied IS
            'Whether the 10% discount was applied for this redemption. Users can only receive this discount once.';
    END IF;
END $$;

-- Create index for efficient lookup of users who have used their discount
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_discount_applied
ON promo_redemptions(user_id, discount_applied)
WHERE discount_applied = true;

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'promo_redemptions' AND column_name = 'discount_applied';
