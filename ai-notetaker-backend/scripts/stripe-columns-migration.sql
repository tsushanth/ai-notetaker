-- Migration: Add Stripe columns to subscriptions table
-- Run this in Supabase SQL Editor

-- Add Stripe customer ID column
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add Stripe subscription ID column
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Add index for faster lookups by Stripe customer ID
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
ON subscriptions(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

-- Add index for faster lookups by Stripe subscription ID
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
ON subscriptions(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- Add unique constraint on stripe_subscription_id to prevent duplicates
ALTER TABLE subscriptions
ADD CONSTRAINT unique_stripe_subscription_id
UNIQUE (stripe_subscription_id);

-- Verify the columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'subscriptions'
AND column_name LIKE 'stripe%';
