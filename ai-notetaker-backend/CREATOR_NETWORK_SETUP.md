# Creator Network Setup Guide

Complete setup requirements for the Scribe AI Creator Network with all 10 abuse prevention rules.

---

## Overview of Abuse Prevention Rules

| Rule | Description | Status |
|------|-------------|--------|
| 1 | Auto-approve creator signups | Implemented |
| 2 | Promo code format: `SCRIBEAI-<USERNAME_PREFIX><NUMBER>` | Implemented |
| 3 | 25% revenue share with 45-day earning maturity | Implemented |
| 4 | $50 minimum payout, monthly frequency | Implemented |
| 5 | Self-referral and household fraud detection | Implemented |
| 6 | Trial churn gaming prevention | Implemented |
| 7 | Creator premium access with activity requirements | Implemented |
| 8 | Usage limits to prevent generation farming | Implemented |
| 9 | Commission caps (monthly max + tiered rates) | Implemented |
| 10 | Automatic fraud & anomaly flagging | Implemented |

---

## 1. Database Migrations

Run these migrations **in order** in your Supabase SQL Editor:

```bash
# Order matters! Run in this sequence:
1. creator-network-migration.sql              # Core tables (creators, promo_codes, etc.)
2. creator-earning-maturity-migration.sql     # Rule 3: 45-day maturity
3. creator-fraud-detection-migration.sql      # Rule 5: Self-referral detection
4. trial-abuse-prevention-migration.sql       # Rule 6: Trial churn prevention
5. creator-activity-tracking-migration.sql    # Rule 7: Activity requirements
6. creator-usage-limits-migration.sql         # Rule 8: Usage limits
7. creator-commission-caps-migration.sql      # Rule 9: Commission caps
8. creator-fraud-anomaly-migration.sql        # Rule 10: Fraud anomaly detection
```

**Location:** `ai-notetaker-backend/scripts/`

---

## 2. Environment Variables

### Required Variables (add to Cloud Run or .env)

```bash
# Stripe Connect (REQUIRED for payouts)
STRIPE_SECRET_KEY=sk_live_xxxxx         # Your Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_xxxxx       # Stripe webhook signing secret

# Cron Job Security (REQUIRED for scheduled jobs)
CRON_SECRET_TOKEN=your-secure-random-token

# Enable scheduled jobs (optional, default: false)
ENABLE_CRON_JOBS=true
```

### Setting Environment Variables in Cloud Run

```bash
# Add Stripe keys
gcloud run services update ai-notetaker-backend \
  --update-secrets="STRIPE_SECRET_KEY=stripe-secret-key:latest"

# Add cron token
gcloud run services update ai-notetaker-backend \
  --update-env-vars="CRON_SECRET_TOKEN=your-secure-token"

# Enable cron jobs (if using in-process scheduling)
gcloud run services update ai-notetaker-backend \
  --update-env-vars="ENABLE_CRON_JOBS=true"
```

---

## 3. Stripe Connect Setup

### 3.1 Enable Stripe Connect in Dashboard

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Connect** > **Settings**
3. Enable **Express accounts**
4. Configure branding (logo, colors, business name)

### 3.2 Configure Redirect URLs

In Stripe Connect settings, add these redirect URLs:

```
# Production
https://your-domain.com/creator/settings?stripe=success
https://your-domain.com/creator/settings?stripe=refresh

# Development
http://localhost:3000/creator/settings?stripe=success
http://localhost:3000/creator/settings?stripe=refresh
```

### 3.3 Configure Webhook Endpoint

Create a webhook endpoint in Stripe Dashboard pointing to:
```
POST https://your-api-domain.com/api/creators/stripe/webhook
```

Subscribe to these events:
- `account.updated`
- `transfer.created`
- `transfer.failed`
- `payout.paid`
- `payout.failed`

---

## 4. Scheduled Jobs Setup

### Option A: Cloud Scheduler (Recommended for GCP)

Create Cloud Scheduler jobs calling these endpoints:

```bash
# 1. Daily maturity processing (2 AM UTC)
gcloud scheduler jobs create http process-maturity \
  --schedule="0 2 * * *" \
  --uri="https://your-api/api/jobs/process-maturity" \
  --http-method=POST \
  --headers="x-cron-token=YOUR_CRON_SECRET_TOKEN"

# 2. Monthly commission cap reset (1st of month, 1 AM UTC)
gcloud scheduler jobs create http reset-monthly-caps \
  --schedule="0 1 1 * *" \
  --uri="https://your-api/api/jobs/reset-monthly-caps" \
  --http-method=POST \
  --headers="x-cron-token=YOUR_CRON_SECRET_TOKEN"

# 3. Monthly payouts (1st of month, 3 AM UTC)
gcloud scheduler jobs create http process-payouts \
  --schedule="0 3 1 * *" \
  --uri="https://your-api/api/jobs/process-payouts" \
  --http-method=POST \
  --headers="x-cron-token=YOUR_CRON_SECRET_TOKEN"

# 4. Daily activity checks (4 AM UTC)
gcloud scheduler jobs create http process-activity-checks \
  --schedule="0 4 * * *" \
  --uri="https://your-api/api/jobs/process-activity-checks" \
  --http-method=POST \
  --headers="x-cron-token=YOUR_CRON_SECRET_TOKEN"

# 5. Daily fraud anomaly scan (5 AM UTC)
gcloud scheduler jobs create http scan-fraud-anomalies \
  --schedule="0 5 * * *" \
  --uri="https://your-api/api/jobs/scan-fraud-anomalies" \
  --http-method=POST \
  --headers="x-cron-token=YOUR_CRON_SECRET_TOKEN"
```

### Option B: In-Process Cron (node-cron)

If using in-process scheduling:

```bash
# Install node-cron
npm install node-cron

# Enable in environment
ENABLE_CRON_JOBS=true
```

**Note:** In-process cron only works if the service is always running. Cloud Scheduler is more reliable for serverless.

---

## 5. Job Schedule Summary

| Job | Schedule | Endpoint | Description |
|-----|----------|----------|-------------|
| Maturity Processing | Daily 2 AM UTC | `/api/jobs/process-maturity` | Approves mature earnings (45+ days) |
| Monthly Cap Reset | 1st @ 1 AM UTC | `/api/jobs/reset-monthly-caps` | Resets monthly commission tracking |
| Monthly Payouts | 1st @ 3 AM UTC | `/api/jobs/process-payouts` | Processes creator payouts via Stripe |
| Activity Checks | Daily 4 AM UTC | `/api/jobs/process-activity-checks` | Sends warnings, processes downgrades |
| Fraud Scan | Daily 5 AM UTC | `/api/jobs/scan-fraud-anomalies` | Scans for fraud patterns |

---

## 6. API Endpoints Added

### Public Endpoints
- `POST /api/promo-codes/validate` - Validate a promo code
- `POST /api/promo-codes/apply` - Apply code to user account

### Creator Endpoints (authenticated)
- `POST /api/creators/register` - Register as creator
- `GET /api/creators/profile` - Get creator profile
- `PUT /api/creators/profile` - Update profile
- `GET /api/creators/dashboard` - Get dashboard stats
- `GET /api/creators/promo-codes` - List promo codes
- `POST /api/creators/promo-codes` - Create new code
- `GET /api/creators/earnings` - Earnings history
- `GET /api/creators/payouts` - Payout history
- `GET /api/creators/payout-estimate` - Next payout estimate
- `GET /api/creators/activity-status` - Activity requirements status
- `GET /api/creators/usage-status` - Usage limits status
- `GET /api/creators/commission-caps` - Commission cap status
- `GET /api/creators/fraud-status` - Fraud status (own account)
- `POST /api/creators/stripe/connect` - Start Stripe onboarding
- `GET /api/creators/stripe/status` - Check Stripe account status
- `POST /api/creators/stripe/dashboard` - Get Stripe dashboard link

### Admin Endpoints (requires admin role)
- `GET /api/creators/admin/fraud-review` - List flagged creators
- `GET /api/creators/admin/fraud-status/:creatorId` - Get creator fraud status
- `POST /api/creators/admin/scan-creator/:creatorId` - Manually scan creator
- `POST /api/creators/admin/resolve-flag/:flagId` - Resolve fraud flag
- `POST /api/creators/admin/freeze-commissions/:creatorId` - Freeze commissions
- `POST /api/creators/admin/unfreeze-commissions/:creatorId` - Unfreeze commissions

### Job Endpoints (requires cron token)
- `POST /api/jobs/process-maturity` - Process matured earnings
- `POST /api/jobs/process-payouts` - Process monthly payouts
- `POST /api/jobs/process-activity-checks` - Check creator activity
- `POST /api/jobs/reset-monthly-caps` - Reset monthly commission tracking
- `POST /api/jobs/scan-fraud-anomalies` - Scan for fraud patterns
- `GET /api/jobs/status` - Get job system status

---

## 7. Default Configuration Values

### Commission Caps (Rule 9)
```javascript
{
  maxMonthlyCommission: 500.00,      // $500/month max
  tier1ReferralLimit: 20,            // First 20 referrals at 25%
  tier1RatePercent: 25.00,
  tier2ReferralLimit: 30,            // Next 30 (21-50) at 15%
  tier2RatePercent: 15.00,
  tier3RatePercent: 10.00,           // 51+ at 10%
  capMethod: 'both',                 // Apply both caps
  newCreatorGraceDays: 30            // 30-day grace period
}
```

### Fraud Anomaly Detection (Rule 10)
```javascript
{
  refundRateThreshold: 40.00,        // Flag at 40% refund rate
  minReferralsForCheck: 5,           // Min 5 referrals before checking
  maxSignupsPerDevice: 2,            // Max 2 per device
  maxSignupsPerIP: 3,                // Max 3 per IP
  maxSignupsPerSubnet: 5,            // Max 5 per subnet
  maxSignupsPerVelocityWindow: 10,   // Max 10 in velocity window
  velocityWindowHours: 2,            // 2 hour window
  maxSignupsPerBIN: 3,               // Max 3 per card BIN
  autoFreezeOnFlag: true,            // Auto-freeze on flag
  autoSuspendOnSevere: false,        // Don't auto-suspend
  severeFraudThreshold: 0.90         // 0.90 severity = severe
}
```

### Activity Requirements (Rule 7)
```javascript
{
  activityWindowDays: 90,            // 90-day activity window
  minPaidReferrals: 1,               // 1 paid referral, OR
  minContentSubmissions: 2,          // 2 content submissions, OR
  minTotalSignups: 10,               // 10 total signups
  warningPeriodDays: 14,             // 14 days before first warning
  finalWarningDays: 7,               // Final warning 7 days before
  gracePeriodDays: 7                 // 7-day grace after final warning
}
```

### Usage Limits (Rule 8)
```javascript
{
  maxGenerationsPerMonth: 500,       // 500/month
  maxGenerationsPerDay: 50,          // 50/day
  maxInputTokens: 100000,            // 100k input tokens
  maxOutputTokens: 16000,            // 16k output tokens
  maxPodcastPerMonth: 100,           // 100 podcasts/month
  maxVideoProcessingPerMonth: 50,    // 50 video processings/month
  cooldownAfterLargeJob: 60          // 60 sec cooldown after large jobs
}
```

### Trial Abuse Prevention (Rule 6)
```javascript
{
  maxTrialsPerDevice: 1,             // 1 trial per device
  maxTrialsPerPaymentMethod: 1,      // 1 trial per payment
  maxTrialsPerEmailBase: 2,          // 2 trials per email base (+alias)
  maxTrialsPerIP: 3,                 // 3 trials per IP
  maxTrialsPerSubnet: 5,             // 5 trials per subnet
  deviceLookbackDays: 365,           // 1 year device lookback
  clusterFlagThreshold: 3,           // Flag cluster at 3+ trials
  clusterBlockThreshold: 5           // Block cluster at 5+ trials
}
```

---

## 8. Mobile App Integration

### iOS (PaywallView.swift)
Add promo code input field:
```swift
// 1. Add text field for promo code
// 2. Call POST /api/promo-codes/validate on change
// 3. Store validated code and send with subscription sync
// 4. Show success/error feedback
```

### Android (PaywallScreen.kt)
Add promo code input composable:
```kotlin
// 1. Add PromoCodeSection composable
// 2. Call POST /api/promo-codes/validate on change
// 3. Store validated code and send with subscription sync
// 4. Show success/error feedback
```

### Promo Code Redemption Metadata

When syncing subscriptions, include:
```json
{
  "promo_code": "SCRIBEAI-XXX",
  "device_fingerprint": "hashed_device_id",
  "ip_address": "hashed_ip",
  "card_bin_hash": "hashed_first_6_digits"
}
```

---

## 9. Testing Checklist

- [ ] Run all database migrations successfully
- [ ] Verify Stripe Connect credentials work
- [ ] Test creator registration flow
- [ ] Test promo code validation
- [ ] Test promo code application on subscription
- [ ] Test Stripe Connect onboarding flow
- [ ] Verify cron jobs run on schedule
- [ ] Test earning maturity (45-day hold)
- [ ] Test commission cap calculations
- [ ] Test fraud detection flags
- [ ] Test activity check warnings
- [ ] Test payout processing (sandbox first!)

---

## 10. Monitoring & Alerts

### Key Metrics to Monitor
- Creator registrations per day
- Promo code redemptions per day
- Fraud flags created per day
- Earnings by status (maturing, approved, paid)
- Failed payouts
- Activity downgrades

### Logs to Watch
```bash
# View job logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ai-notetaker-backend AND textPayload:\"job\""

# View fraud flags
gcloud logging read "textPayload:\"fraud\" OR textPayload:\"anomaly\""
```

---

## Quick Deploy Checklist

1. [ ] Run all 8 database migrations
2. [ ] Add `STRIPE_SECRET_KEY` to Cloud Run secrets
3. [ ] Add `CRON_SECRET_TOKEN` to Cloud Run env vars
4. [ ] Create 5 Cloud Scheduler jobs
5. [ ] Configure Stripe Connect redirect URLs
6. [ ] Configure Stripe webhook endpoint
7. [ ] Deploy updated backend code
8. [ ] Test creator registration
9. [ ] Test promo code validation
10. [ ] Test Stripe Connect flow
