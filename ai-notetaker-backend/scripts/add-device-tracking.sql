-- Add Device ID Tracking Migration
-- Run this script to add device tracking for trial abuse prevention
-- This is safe to run on production - it uses IF NOT EXISTS

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- First, create user_trials table if it doesn't exist
-- =============================================
CREATE TABLE IF NOT EXISTS user_trials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  trial_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_end TIMESTAMPTZ NOT NULL,
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for user_trials
CREATE INDEX IF NOT EXISTS idx_user_trials_user_id ON user_trials(user_id);

-- Enable RLS on user_trials
ALTER TABLE user_trials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_trials
DROP POLICY IF EXISTS "Users can view their own trial" ON user_trials;
CREATE POLICY "Users can view their own trial"
    ON user_trials FOR SELECT
    USING (auth.uid() = user_id);

-- Add device_id column if table already exists but column doesn't
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_trials' AND column_name = 'device_id'
    ) THEN
        ALTER TABLE user_trials ADD COLUMN device_id TEXT;
    END IF;
END $$;

-- Create index for device lookups
CREATE INDEX IF NOT EXISTS idx_user_trials_device_id ON user_trials(device_id);

-- Create device_trials table to track trials by device (prevents reinstall bypass)
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

-- Create indexes for device_trials
CREATE INDEX IF NOT EXISTS idx_device_trials_device_id ON device_trials(device_id);
CREATE INDEX IF NOT EXISTS idx_device_trials_first_user_id ON device_trials(first_user_id);

-- Create subscription_metrics table for detailed funnel tracking
CREATE TABLE IF NOT EXISTS subscription_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'app_install',
    'onboarding_started',
    'onboarding_completed',
    'paywall_viewed',
    'trial_screen_viewed',
    'trial_started',
    'trial_skipped',
    'purchase_initiated',
    'purchase_completed',
    'purchase_failed',
    'purchase_cancelled',
    'trial_reminder_sent',
    'trial_expired',
    'subscription_renewed',
    'subscription_cancelled',
    'churn'
  )),
  platform TEXT CHECK (platform IN ('ios', 'android', 'web')),
  source TEXT, -- e.g., 'onboarding', 'settings', 'feature_gate'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for subscription_metrics
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_user_id ON subscription_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_device_id ON subscription_metrics(device_id);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_event_type ON subscription_metrics(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_metrics_created_at ON subscription_metrics(created_at DESC);

-- Enable RLS
ALTER TABLE device_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role can access all, users can only read their own)
DROP POLICY IF EXISTS "Service role can manage device_trials" ON device_trials;
CREATE POLICY "Service role can manage device_trials"
    ON device_trials FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own metrics" ON subscription_metrics;
CREATE POLICY "Users can view their own metrics"
    ON subscription_metrics FOR SELECT
    USING (auth.uid() = user_id);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Device tracking tables created successfully!';
    RAISE NOTICE 'Tables added/updated: user_trials (device_id column), device_trials, subscription_metrics';
    RAISE NOTICE 'This enables:';
    RAISE NOTICE '1. Tracking trials by device ID to prevent reinstall abuse';
    RAISE NOTICE '2. Detailed subscription funnel metrics';
END $$;
