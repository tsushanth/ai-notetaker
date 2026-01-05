-- Check what subscription-related tables already exist
-- Run this first to see your current state

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'subscriptions',
    'subscription_events',
    'user_trials',
    'device_trials',
    'usage_tracking',
    'subscription_metrics',
    'notes',
    'users'
)
ORDER BY table_name;

-- Check total user count
SELECT COUNT(*) as total_users FROM auth.users;

-- Check if notes table exists and has data
SELECT
    'notes' as table_name,
    COUNT(*) as row_count
FROM notes
UNION ALL
SELECT
    'auth.users',
    COUNT(*)
FROM auth.users;
