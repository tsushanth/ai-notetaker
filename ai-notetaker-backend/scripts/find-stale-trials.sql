-- Find subscriptions that are marked as trials but whose trial period has ended
-- These may have converted to paid subscriptions without the backend being notified
-- Looking at ALL TIME to catch all missed conversions

-- 1. Find all stale trials (trial_end has passed but still marked as trial)
SELECT
    s.id,
    s.user_id,
    s.product_id,
    s.platform,
    s.status,
    s.is_trial,
    s.trial_end,
    s.current_period_end,
    s.original_transaction_id,
    s.price_amount,
    s.price_currency,
    s.created_at,
    s.updated_at,
    u.email
FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id::uuid = u.id
WHERE s.is_trial = true
  AND s.trial_end < NOW()
  AND s.platform = 'ios'
ORDER BY s.trial_end DESC;

-- 2. Count of stale trials by status
SELECT
    status,
    COUNT(*) as count,
    SUM(COALESCE(price_amount, 0)) as potential_revenue
FROM subscriptions
WHERE is_trial = true
  AND trial_end < NOW()
  AND platform = 'ios'
GROUP BY status;

-- 3. Find ALL subscription events (no time filter - see complete history)
SELECT
    se.event_type,
    COUNT(*) as count
FROM subscription_events se
GROUP BY se.event_type
ORDER BY count DESC;

-- 4. Find subscription events with time breakdown (last 90 days)
SELECT
    DATE_TRUNC('week', se.created_at) as week,
    se.event_type,
    COUNT(*) as count
FROM subscription_events se
WHERE se.created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('week', se.created_at), se.event_type
ORDER BY week DESC, count DESC;

-- 5. Identify users who should have converted (trial ended, no trial_converted or subscription_started event)
-- These are trials that ENDED but we never recorded a conversion
SELECT DISTINCT
    s.user_id,
    s.original_transaction_id,
    s.product_id,
    s.trial_end,
    s.price_amount,
    s.price_currency,
    s.status,
    u.email
FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id::uuid = u.id
LEFT JOIN subscription_events se_converted ON se_converted.subscription_id = s.id
    AND se_converted.event_type IN ('trial_converted', 'subscription_started')
WHERE s.is_trial = true
  AND s.trial_end < NOW()
  AND s.platform = 'ios'
  AND s.status NOT IN ('expired', 'cancelled')
  AND se_converted.id IS NULL
ORDER BY s.trial_end DESC;

-- 6. Summary: How many trials started vs converted vs expired
SELECT
    'trial_started' as metric,
    COUNT(*) as count
FROM subscription_events WHERE event_type = 'trial_started'
UNION ALL
SELECT
    'trial_converted' as metric,
    COUNT(*) as count
FROM subscription_events WHERE event_type = 'trial_converted'
UNION ALL
SELECT
    'trial_expired' as metric,
    COUNT(*) as count
FROM subscription_events WHERE event_type = 'trial_expired'
UNION ALL
SELECT
    'subscription_started' as metric,
    COUNT(*) as count
FROM subscription_events WHERE event_type = 'subscription_started';

-- 8. Events breakdown by platform (iOS vs Android vs Web)
SELECT
    se.platform,
    se.event_type,
    COUNT(*) as count
FROM subscription_events se
GROUP BY se.platform, se.event_type
ORDER BY se.platform, count DESC;

-- 9. Subscription counts by platform
SELECT
    s.platform,
    s.status,
    s.is_trial,
    COUNT(*) as count
FROM subscriptions s
GROUP BY s.platform, s.status, s.is_trial
ORDER BY s.platform, count DESC;

-- 10. Weekly events by platform (last 90 days)
SELECT
    DATE_TRUNC('week', se.created_at) as week,
    se.platform,
    se.event_type,
    COUNT(*) as count
FROM subscription_events se
WHERE se.created_at > NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('week', se.created_at), se.platform, se.event_type
ORDER BY week DESC, se.platform, count DESC;

-- 11. Revenue by platform (from subscription_started and trial_converted events with price)
SELECT
    se.platform,
    se.event_type,
    COUNT(*) as transaction_count,
    SUM(COALESCE(se.price_amount, 0)) as total_revenue,
    se.price_currency
FROM subscription_events se
WHERE se.event_type IN ('subscription_started', 'trial_converted', 'subscription_renewed')
  AND se.price_amount IS NOT NULL
GROUP BY se.platform, se.event_type, se.price_currency
ORDER BY se.platform, total_revenue DESC;

-- 7. Check for orphaned subscriptions (subscriptions with no events at all)
SELECT
    s.id,
    s.user_id,
    s.product_id,
    s.platform,
    s.status,
    s.is_trial,
    s.trial_end,
    s.created_at,
    u.email
FROM subscriptions s
LEFT JOIN auth.users u ON s.user_id::uuid = u.id
LEFT JOIN subscription_events se ON se.subscription_id = s.id
WHERE se.id IS NULL
ORDER BY s.created_at DESC;
