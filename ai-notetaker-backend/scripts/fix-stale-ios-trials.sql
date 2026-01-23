-- Fix stale iOS trials that should have converted
-- These are subscriptions where:
-- 1. is_trial = true
-- 2. trial_end has passed
-- 3. status = 'active' (meaning they're still paying)
-- 4. No trial_converted event was logged

-- First, let's see what we're about to fix
SELECT
    s.id,
    s.user_id,
    s.product_id,
    s.status,
    s.is_trial,
    s.trial_end,
    s.current_period_end,
    s.price_amount,
    s.price_currency,
    u.email
FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id::uuid = u.id
WHERE s.is_trial = true
  AND s.trial_end < NOW()
  AND s.platform = 'ios'
  AND s.status = 'active';

-- Run this to fix the stale trials:
-- This will:
-- 1. Set is_trial = false for active subscriptions past trial_end
-- 2. Log trial_converted events for revenue tracking

-- Step 1: Update subscriptions to mark trial as converted
UPDATE subscriptions
SET
    is_trial = false,
    updated_at = NOW()
WHERE is_trial = true
  AND trial_end < NOW()
  AND platform = 'ios'
  AND status = 'active'
RETURNING id, user_id, product_id, price_amount, price_currency;

-- Step 2: Insert trial_converted events for each fixed subscription
-- Run this after Step 1, using the returned IDs
-- You'll need to insert one event per subscription

-- Template for inserting events (replace VALUES with actual data):
/*
INSERT INTO subscription_events (
    user_id,
    subscription_id,
    event_type,
    platform,
    product_id,
    price_amount,
    price_currency,
    environment,
    metadata,
    created_at
)
SELECT
    s.user_id,
    s.id,
    'trial_converted',
    'ios',
    s.product_id,
    s.price_amount,
    s.price_currency,
    'production',
    '{"source": "manual_fix", "reason": "stale_trial_recovery"}'::jsonb,
    COALESCE(s.trial_end, NOW())
FROM subscriptions s
WHERE s.id IN ('subscription-id-1', 'subscription-id-2');
*/

-- Combined fix (do both in one transaction):
DO $$
DECLARE
    fixed_sub RECORD;
BEGIN
    -- Loop through each stale trial and fix it
    FOR fixed_sub IN
        SELECT id, user_id, product_id, price_amount, price_currency, trial_end
        FROM subscriptions
        WHERE is_trial = true
          AND trial_end < NOW()
          AND platform = 'ios'
          AND status = 'active'
    LOOP
        -- Update the subscription
        UPDATE subscriptions
        SET is_trial = false, updated_at = NOW()
        WHERE id = fixed_sub.id;

        -- Log the trial_converted event
        INSERT INTO subscription_events (
            user_id,
            subscription_id,
            event_type,
            platform,
            product_id,
            price_amount,
            price_currency,
            environment,
            metadata,
            created_at
        ) VALUES (
            fixed_sub.user_id,
            fixed_sub.id,
            'trial_converted',
            'ios',
            fixed_sub.product_id,
            fixed_sub.price_amount,
            fixed_sub.price_currency,
            'production',
            '{"source": "manual_fix", "reason": "stale_trial_recovery"}'::jsonb,
            COALESCE(fixed_sub.trial_end, NOW())
        );

        RAISE NOTICE 'Fixed subscription % for user %', fixed_sub.id, fixed_sub.user_id;
    END LOOP;
END $$;

-- Verify the fix worked
SELECT
    'Before' as status,
    COUNT(*) FILTER (WHERE is_trial = true AND trial_end < NOW() AND status = 'active') as stale_trials,
    COUNT(*) FILTER (WHERE is_trial = false AND status = 'active') as converted_subscriptions
FROM subscriptions
WHERE platform = 'ios';
