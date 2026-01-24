# University Outreach System Setup Guide

Complete setup instructions for the email outreach system using Amazon SES.

---

## Quick Start Checklist

```
□ 1. Run database migration
□ 2. Configure AWS credentials
□ 3. Set up DNS records in Cloudflare
□ 4. Verify domain in AWS SES
□ 5. Request SES production access
□ 6. Configure SNS notifications (optional but recommended)
□ 7. Start warmup period
□ 8. Run scraper to collect contacts
□ 9. Create and launch campaigns
```

---

## 1. Database Migration

Run the migration in Supabase SQL Editor:

```bash
# Location: ai-notetaker-backend/scripts/outreach-migration.sql
```

This creates:
- `universities` - University list with scrape status
- `faculty_contacts` - Scraped faculty contacts
- `outreach_campaigns` - Email campaigns
- `outreach_emails` - Individual email tracking
- `email_domains` - Domain warmup tracking
- `warmup_schedule` - Warmup daily targets

---

## 2. AWS Credentials

Add to your environment (Cloud Run or .env):

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
```

### Create IAM User for SES

1. Go to AWS IAM Console
2. Create new user: `scribeai-ses-sender`
3. Attach policy: `AmazonSESFullAccess`
4. Create access key and save credentials

---

## 3. DNS Records (Cloudflare)

Add these records for `outreach.scribeai.online`:

### SPF Record
```
Type: TXT
Name: outreach
Value: v=spf1 include:amazonses.com ~all
TTL: Auto
```

### DMARC Record
```
Type: TXT
Name: _dmarc.outreach
Value: v=DMARC1; p=none; rua=mailto:dmarc@scribeai.online
TTL: Auto
```

### DKIM Records (after SES verification)
SES will provide 3 CNAME records. Add them as:
```
Type: CNAME
Name: [token1]._domainkey.outreach
Value: [token1].dkim.amazonses.com
TTL: Auto

Type: CNAME
Name: [token2]._domainkey.outreach
Value: [token2].dkim.amazonses.com
TTL: Auto

Type: CNAME
Name: [token3]._domainkey.outreach
Value: [token3].dkim.amazonses.com
TTL: Auto
```

### MX Record (for receiving replies)
```
Type: MX
Name: outreach
Value: 10 inbound-smtp.us-east-1.amazonaws.com
TTL: Auto
```

---

## 4. Verify Domain in AWS SES

1. Go to AWS SES Console → Verified Identities
2. Click "Create Identity"
3. Choose "Domain"
4. Enter: `outreach.scribeai.online`
5. Check "Use a custom MAIL FROM domain" (optional)
6. Click "Create Identity"
7. Add the DKIM CNAME records to Cloudflare
8. Wait for verification (usually 5-10 minutes)

---

## 5. Request SES Production Access

New SES accounts are in "sandbox" mode (can only send to verified emails).

1. Go to AWS SES Console
2. Click "Request production access"
3. Fill out the form:
   - **Mail type**: Marketing
   - **Website URL**: https://scribeai.online
   - **Use case description**:
   ```
   We are sending educational outreach emails to university faculty
   to introduce our AI-powered study tool for their students.
   We will:
   - Send personalized emails to verified faculty email addresses
   - Maintain low bounce rates (<2%) through email verification
   - Honor all unsubscribe requests immediately
   - Send maximum 1000-2000 emails per day initially
   - Follow CAN-SPAM and email best practices
   ```
4. Submit and wait (usually approved within 24-48 hours)

---

## 6. Configure SNS Notifications (Recommended)

This enables real-time bounce/complaint tracking:

### Create SNS Topic
1. Go to AWS SNS Console
2. Create topic: `scribeai-ses-notifications`
3. Note the ARN

### Create Subscription
1. Protocol: HTTPS
2. Endpoint: `https://your-api-domain.com/api/outreach/webhook/ses`
3. Confirm subscription (auto-confirmed by our webhook)

### Configure SES to Send Notifications
1. Go to SES → Verified Identities → outreach.scribeai.online
2. Click "Notifications" tab
3. Set up notifications for:
   - Bounces → SNS topic
   - Complaints → SNS topic
   - Deliveries → SNS topic (optional)

---

## 7. Warmup Schedule

Our 1-week aggressive warmup schedule:

| Day | Daily Limit | Cumulative |
|-----|-------------|------------|
| 1   | 50          | 50         |
| 2   | 100         | 150        |
| 3   | 150         | 300        |
| 4   | 250         | 550        |
| 5   | 400         | 950        |
| 6   | 600         | 1,550      |
| 7   | 800         | 2,350      |

### Start Warmup

```bash
# Initialize domain (run once)
curl -X POST https://your-api/api/outreach/warmup/advance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check status
curl https://your-api/api/outreach/warmup-status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Important for Warmup Success

1. **Send to engaged recipients first** - Your existing users, team members, friends
2. **High open rates matter** - Ask warmup recipients to open and maybe reply
3. **Monitor bounce/complaint rates** - Keep bounce <2%, complaints <0.1%
4. **Advance daily** - Call `/warmup/advance` each day to increase limits

---

## 8. API Endpoints

### Warmup & Status
```
GET  /api/outreach/warmup-status     - Get warmup progress
POST /api/outreach/warmup/advance    - Move to next warmup day
GET  /api/outreach/ses-status        - Check SES account status
```

### Universities & Scraping
```
GET  /api/outreach/universities      - List universities
POST /api/outreach/universities      - Add university
GET  /api/outreach/scraper/stats     - Scraping statistics
POST /api/outreach/scraper/run       - Run scraper (batch)
POST /api/outreach/scraper/university/:id - Scrape specific university
```

### Contacts
```
GET  /api/outreach/contacts          - List contacts
GET  /api/outreach/contacts/stats    - Contact statistics
```

### Campaigns
```
GET  /api/outreach/campaigns         - List campaigns
POST /api/outreach/campaigns         - Create campaign
GET  /api/outreach/campaigns/:id     - Get campaign details
PUT  /api/outreach/campaigns/:id     - Update campaign
POST /api/outreach/campaigns/:id/queue - Queue contacts
POST /api/outreach/campaigns/:id/send  - Send queued emails
```

### Testing
```
POST /api/outreach/send-test         - Send test email
GET  /api/outreach/templates         - Get email templates
```

---

## 9. Usage Examples

### Send Test Email (Warmup)
```bash
curl -X POST https://your-api/api/outreach/send-test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "your-email@example.com",
    "subject": "Test from Scribe AI Outreach",
    "body": "<h1>Hello!</h1><p>This is a warmup test email.</p>"
  }'
```

### Run Scraper
```bash
curl -X POST https://your-api/api/outreach/scraper/run \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'
```

### Create Campaign
```bash
curl -X POST https://your-api/api/outreach/campaigns \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Educator Introduction - January 2025",
    "subject_template": "Free study tools for your {{department}} students",
    "body_template": "<p>Hi {{first_name}},</p><p>...</p>",
    "daily_limit": 500
  }'
```

### Queue and Send
```bash
# Queue 100 contacts
curl -X POST https://your-api/api/outreach/campaigns/CAMPAIGN_ID/queue \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'

# Send queued emails
curl -X POST https://your-api/api/outreach/campaigns/CAMPAIGN_ID/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'
```

---

## 10. Email Personalization

Templates support these placeholders:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `{{name}}` | Full name | Dr. Jane Smith |
| `{{first_name}}` | First name | Jane |
| `{{last_name}}` | Last name | Smith |
| `{{title}}` | Job title | Associate Professor |
| `{{department}}` | Department | Computer Science |
| `{{university}}` | University name | Stanford University |
| `{{email}}` | Email address | jsmith@stanford.edu |

---

## 11. Monitoring

### Key Metrics to Watch

- **Bounce rate**: Should be <2%
- **Complaint rate**: Should be <0.1%
- **Open rate**: 20-40% is good for cold outreach
- **Reply rate**: 2-5% is excellent

### Health Checks

```bash
# Check warmup status
GET /api/outreach/warmup-status

# Check SES account
GET /api/outreach/ses-status

# Check contact stats
GET /api/outreach/contacts/stats
```

---

## 12. Troubleshooting

### "Daily sending limit reached"
- Wait until next day, or
- Advance warmup day if ready: `POST /warmup/advance`

### High bounce rate
- Stop sending immediately
- Review contact list quality
- Use email verification service (ZeroBounce)

### Emails going to spam
- Check DKIM, SPF, DMARC are configured
- Review email content (avoid spam trigger words)
- Slow down sending rate
- Ensure warmup was completed properly

### SES sandbox mode
- Request production access (see section 5)
- While in sandbox, can only send to verified email addresses

---

## 13. Cost Estimate

| Component | Monthly Cost |
|-----------|--------------|
| SES (10,000 emails) | ~$1 |
| SES (50,000 emails) | ~$5 |
| Dedicated IP (optional) | $24.95 |
| SNS notifications | ~$0.50 |
| **Total (basic)** | **~$5-10/mo** |

---

## Quick Reference

```bash
# Environment variables needed
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# DNS records needed (Cloudflare)
TXT   outreach           v=spf1 include:amazonses.com ~all
TXT   _dmarc.outreach    v=DMARC1; p=none; rua=mailto:dmarc@scribeai.online
CNAME [token]._domainkey.outreach  [token].dkim.amazonses.com (x3)
MX    outreach           10 inbound-smtp.us-east-1.amazonaws.com

# Start warmup (Day 1)
POST /api/outreach/warmup/advance

# Check status
GET /api/outreach/warmup-status
GET /api/outreach/ses-status
```
