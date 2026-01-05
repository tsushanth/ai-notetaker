-- Subscription Metrics Analysis Queries
-- Run these in your Supabase SQL Editor to understand why users aren't converting

-- =============================================
-- 1. OVERALL FUNNEL ANALYSIS
-- =============================================

-- Count total users
SELECT
    'Total Users' as metric,
    COUNT(*) as count
FROM auth.users
UNION ALL
-- Users who have completed onboarding
SELECT
    'Completed Onboarding',
    COUNT(DISTINCT user_id)
FROM user_trials
UNION ALL
-- Users with active trials
SELECT
    'Active Trials',
    COUNT(*)
FROM user_trials
WHERE trial_end > NOW()
UNION ALL
-- Users with expired trials
SELECT
    'Expired Trials',
    COUNT(*)
FROM user_trials
WHERE trial_end <= NOW()
UNION ALL
-- Paying subscribers
SELECT
    'Active Subscriptions',
    COUNT(*)
FROM subscriptions
WHERE status = 'active';

-- =============================================
-- 2. SUBSCRIPTION EVENTS BREAKDOWN
-- =============================================

-- What events are we seeing?
SELECT
    event_type,
    COUNT(*) as event_count,
    COUNT(DISTINCT user_id) as unique_users
FROM subscription_events
GROUP BY event_type
ORDER BY event_count DESC;

-- =============================================
-- 3. TRIAL CONVERSION ANALYSIS
-- =============================================

-- How many days into trial before users drop off?
SELECT
    CASE
        WHEN trial_end <= NOW() THEN 'Expired (not converted)'
        WHEN trial_end > NOW() THEN 'Still in trial'
    END as trial_status,
    COUNT(*) as user_count,
    ROUND(AVG(EXTRACT(EPOCH FROM (trial_end - trial_start)) / 86400), 1) as avg_trial_days
FROM user_trials
GROUP BY 1;

-- =============================================
-- 4. USER ENGAGEMENT DURING TRIAL
-- =============================================

-- How active are users during their trial?
SELECT
    ut.user_id,
    ut.trial_start,
    ut.trial_end,
    ut.trial_end <= NOW() as trial_expired,
    COUNT(DISTINCT n.id) as notes_created,
    (SELECT COUNT(*) FROM usage_tracking WHERE user_id = ut.user_id) as ai_usage_count
FROM user_trials ut
LEFT JOIN notes n ON n.user_id = ut.user_id
    AND n.created_at BETWEEN ut.trial_start AND ut.trial_end
GROUP BY ut.user_id, ut.trial_start, ut.trial_end
ORDER BY notes_created DESC
LIMIT 50;

-- =============================================
-- 5. SUBSCRIPTION SYNC ANALYSIS
-- =============================================

-- Are subscription syncs happening?
SELECT
    platform,
    status,
    is_trial,
    COUNT(*) as count
FROM subscriptions
GROUP BY platform, status, is_trial;

-- =============================================
-- 6. RECENT SUBSCRIPTION EVENTS (last 30 days)
-- =============================================

SELECT
    DATE(created_at) as date,
    event_type,
    COUNT(*) as events
FROM subscription_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), event_type
ORDER BY date DESC, events DESC;

-- =============================================
-- 7. POTENTIAL ISSUES DETECTION
-- =============================================

-- Users who started trial but have no subscription record
SELECT
    ut.user_id,
    ut.trial_start,
    ut.trial_end,
    s.id as subscription_id
FROM user_trials ut
LEFT JOIN subscriptions s ON ut.user_id = s.user_id
WHERE s.id IS NULL
ORDER BY ut.trial_start DESC
LIMIT 20;

-- Users with subscription but expired/cancelled
SELECT
    user_id,
    product_id,
    status,
    current_period_end,
    cancellation_date,
    cancellation_reason
FROM subscriptions
WHERE status != 'active'
ORDER BY cancellation_date DESC NULLS LAST;

-- =============================================
-- 8. CONVERSION RATE CALCULATION
-- =============================================

WITH trial_users AS (
    SELECT COUNT(DISTINCT user_id) as total FROM user_trials
),
converted_users AS (
    SELECT COUNT(DISTINCT user_id) as total
    FROM subscriptions
    WHERE status = 'active' AND is_trial = false
)
SELECT
    tu.total as trial_users,
    cu.total as converted_users,
    CASE
        WHEN tu.total > 0 THEN ROUND((cu.total::numeric / tu.total::numeric) * 100, 2)
        ELSE 0
    END as conversion_rate_percent
FROM trial_users tu, converted_users cu;

-- =============================================
-- 9. IDENTIFY USERS WHO COULD HAVE BYPASSED
-- =============================================

-- Users with trial but no subscription events
SELECT
    ut.user_id,
    ut.trial_start,
    ut.trial_end,
    au.email,
    (SELECT COUNT(*) FROM subscription_events se WHERE se.user_id = ut.user_id) as event_count
FROM user_trials ut
JOIN auth.users au ON au.id = ut.user_id
WHERE NOT EXISTS (
    SELECT 1 FROM subscription_events se
    WHERE se.user_id = ut.user_id
)
ORDER BY ut.trial_start DESC
LIMIT 50;

-- =============================================
-- 10. DAILY SIGNUPS VS CONVERSIONS (CORRECTED)
-- =============================================

-- NOTE: The old query was WRONG - it counted is_trial=true as conversions!
-- A TRUE conversion = is_trial=false (user actually paying)
SELECT
    DATE(ut.trial_start) as date,
    COUNT(DISTINCT ut.user_id) as new_trials,
    COUNT(DISTINCT CASE WHEN s.is_trial = false AND s.status = 'active' THEN s.user_id END) as paid_conversions,
    COUNT(DISTINCT CASE WHEN s.is_trial = true AND s.status = 'active' THEN s.user_id END) as storekit_free_trials
FROM user_trials ut
LEFT JOIN subscriptions s ON ut.user_id = s.user_id
WHERE ut.trial_start > NOW() - INTERVAL '30 days'
GROUP BY DATE(ut.trial_start)
ORDER BY date DESC;

-- =============================================
-- 11. ACTUAL REVENUE - CHECK SUBSCRIPTION DETAILS
-- =============================================

-- This will show you EXACTLY what's in the subscriptions table
-- Look at is_trial column - if it's TRUE, they haven't paid yet!
SELECT
    s.user_id,
    s.product_id,
    s.platform,
    s.status,
    s.is_trial,
    s.trial_end,
    s.current_period_end,
    s.price_amount,
    s.price_currency,
    s.created_at
FROM subscriptions s
WHERE s.status = 'active'
ORDER BY s.created_at DESC;

-- =============================================
-- 12. BREAKDOWN BY TRIAL VS PAID
-- =============================================

SELECT
    CASE
        WHEN is_trial = true THEN '🆓 Free Trial (StoreKit)'
        ELSE '💰 PAID Subscription'
    END as subscription_type,
    platform,
    COUNT(*) as count,
    SUM(CASE WHEN price_amount IS NOT NULL THEN price_amount ELSE 0 END) as total_revenue
FROM subscriptions
WHERE status = 'active'
GROUP BY is_trial, platform;
