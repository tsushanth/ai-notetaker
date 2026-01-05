-- Complete Subscription System Setup
-- Run this script ONCE to set up all subscription-related tables
-- Safe to run multiple times - uses IF NOT EXISTS

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- FIRST: Add missing columns to existing tables
-- =============================================

-- Add device_id to subscriptions if it exists but column doesn't
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'subscriptions' AND column_name = 'device_id'
        ) THEN
            ALTER TABLE subscriptions ADD COLUMN device_id TEXT;
            RAISE NOTICE 'Added device_id column to subscriptions table';
        END IF;
    END IF;
END $$;

-- =============================================
-- 1. SUBSCRIPTIONS TABLE (main subscription records)
-- =============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'grace_period', 'pending')),
  original_transaction_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  is_trial BOOLEAN DEFAULT false,
  cancellation_date TIMESTAMPTZ,
  cancellation_reason TEXT,
  auto_renew_enabled BOOLEAN DEFAULT true,
  price_amount DECIMAL(10, 2),
  price_currency TEXT DEFAULT 'USD',
  device_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_original_transaction_id ON subscriptions(original_transaction_id);

-- =============================================
-- 2. SUBSCRIPTION EVENTS TABLE (audit trail)
-- =============================================
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'trial_started', 'trial_converted', 'trial_cancelled', 'trial_expired',
    'subscription_started', 'subscription_renewed', 'subscription_cancelled',
    'subscription_expired', 'subscription_grace_period', 'subscription_reactivated',
    'refund_issued', 'billing_issue', 'price_change'
  )),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  product_id TEXT,
  transaction_id TEXT,
  original_transaction_id TEXT,
  price_amount DECIMAL(10, 2),
  price_currency TEXT,
  environment TEXT CHECK (environment IN ('production', 'sandbox')),
  raw_notification JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created_at ON subscription_events(created_at DESC);

-- =============================================
-- 3. USER TRIALS TABLE (server-side trial tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS user_trials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  trial_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_end TIMESTAMPTZ NOT NULL,
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_trials_user_id ON user_trials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_trials_device_id ON user_trials(device_id);

-- =============================================
-- 4. DEVICE TRIALS TABLE (prevents reinstall abuse)
-- =============================================
CREATE TABLE IF NOT EXISTS device_trials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id TEXT NOT NULL UNIQUE,
  device_fingerprint TEXT,
  first_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trial_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_end TIMESTAMPTZ NOT NULL,
  trial_used BOOLEAN DEFAULT true,
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_trials_device_id ON device_trials(device_id);
CREATE INDEX IF NOT EXISTS idx_device_trials_first_user_id ON device_trials(first_user_id);

-- =============================================
-- 5. USAGE TRACKING TABLE (free tier limits)
-- =============================================
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feature_type TEXT NOT NULL CHECK (feature_type IN (
    'note_created', 'summary', 'quiz', 'flashcards', 'podcast', 'chat', 'diagram'
  )),
  month_year TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_month ON usage_tracking(month_year);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_month ON usage_tracking(user_id, month_year);

-- =============================================
-- 6. SUBSCRIPTION METRICS TABLE (funnel analytics)
-- =============================================
CREATE TABLE IF NOT EXISTS subscription_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'app_install', 'onboarding_started', 'onboarding_completed',
    'paywall_viewed', 'trial_screen_viewed', 'trial_started', 'trial_skipped',
    'purchase_initiated', 'purchase_completed', 'purchase_failed', 'purchase_cancelled',
    'trial_reminder_sent', 'trial_expired', 'subscription_renewed', 'subscription_cancelled', 'churn'
  )),
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  source TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_metrics_user_id ON subscription_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_device_id ON subscription_metrics(device_id);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_event_type ON subscription_metrics(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_created_at ON subscription_metrics(created_at DESC);

-- =============================================
-- 7. UPDATED_AT TRIGGER FOR SUBSCRIPTIONS
-- =============================================
CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_subscriptions_updated_at();

-- =============================================
-- 8. ENABLE ROW LEVEL SECURITY
-- =============================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_metrics ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 9. RLS POLICIES
-- =============================================

-- Subscriptions
DROP POLICY IF EXISTS "Users can view their own subscription" ON subscriptions;
CREATE POLICY "Users can view their own subscription"
    ON subscriptions FOR SELECT
    USING (auth.uid() = user_id);

-- Subscription Events
DROP POLICY IF EXISTS "Users can view their own subscription events" ON subscription_events;
CREATE POLICY "Users can view their own subscription events"
    ON subscription_events FOR SELECT
    USING (auth.uid() = user_id);

-- User Trials
DROP POLICY IF EXISTS "Users can view their own trial" ON user_trials;
CREATE POLICY "Users can view their own trial"
    ON user_trials FOR SELECT
    USING (auth.uid() = user_id);

-- Device Trials (service role only - no user access)
DROP POLICY IF EXISTS "Service role can manage device_trials" ON device_trials;
CREATE POLICY "Service role can manage device_trials"
    ON device_trials FOR ALL
    USING (true)
    WITH CHECK (true);

-- Usage Tracking
DROP POLICY IF EXISTS "Users can view their own usage" ON usage_tracking;
CREATE POLICY "Users can view their own usage"
    ON usage_tracking FOR SELECT
    USING (auth.uid() = user_id);

-- Subscription Metrics
DROP POLICY IF EXISTS "Users can view their own metrics" ON subscription_metrics;
CREATE POLICY "Users can view their own metrics"
    ON subscription_metrics FOR SELECT
    USING (auth.uid() = user_id);

-- =============================================
-- SUCCESS MESSAGE
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '✅ All subscription tables created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - subscriptions (main subscription records)';
    RAISE NOTICE '  - subscription_events (audit trail)';
    RAISE NOTICE '  - user_trials (server-side trial tracking)';
    RAISE NOTICE '  - device_trials (prevents reinstall abuse)';
    RAISE NOTICE '  - usage_tracking (free tier limits)';
    RAISE NOTICE '  - subscription_metrics (funnel analytics)';
    RAISE NOTICE '';
    RAISE NOTICE 'You can now run the analyze-subscription-metrics.sql queries.';
END $$;
