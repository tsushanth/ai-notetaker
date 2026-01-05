-- Fix Missing Columns Script
-- Run this FIRST before setup-all-subscription-tables.sql

-- Add device_id to subscriptions if missing
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscriptions') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'device_id') THEN
            ALTER TABLE subscriptions ADD COLUMN device_id TEXT;
            RAISE NOTICE 'Added device_id to subscriptions';
        ELSE
            RAISE NOTICE 'device_id already exists in subscriptions';
        END IF;
    ELSE
        RAISE NOTICE 'subscriptions table does not exist yet';
    END IF;
END $$;

-- Add device_id to user_trials if missing
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_trials') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_trials' AND column_name = 'device_id') THEN
            ALTER TABLE user_trials ADD COLUMN device_id TEXT;
            RAISE NOTICE 'Added device_id to user_trials';
        ELSE
            RAISE NOTICE 'device_id already exists in user_trials';
        END IF;
    ELSE
        RAISE NOTICE 'user_trials table does not exist yet';
    END IF;
END $$;

-- Show current table columns
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('subscriptions', 'user_trials', 'subscription_events')
ORDER BY table_name, ordinal_position;
