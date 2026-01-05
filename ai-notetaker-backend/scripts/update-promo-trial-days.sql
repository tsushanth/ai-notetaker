-- Update existing promo codes to have 7 trial extension days
-- This extends the trial from 7 to 14 days for users who apply a promo code on mobile

-- Update all existing promo codes that have 0 trial extension days
UPDATE promo_codes
SET trial_extension_days = 7
WHERE trial_extension_days = 0 OR trial_extension_days IS NULL;

-- Verify the update
SELECT
    id,
    code,
    trial_extension_days,
    discount_type,
    discount_value,
    is_active
FROM promo_codes
ORDER BY created_at DESC
LIMIT 20;
