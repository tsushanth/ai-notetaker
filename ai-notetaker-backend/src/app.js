const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ============================================
// CRITICAL: Validate environment variables FIRST
// Server will exit if required vars are missing
// ============================================
const { validateEnvOrExit } = require('./config/envValidation');
validateEnvOrExit();

const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./utils/logger');

// Import routes
const healthRoutes = require('./routes/health');
const notesRoutes = require('./routes/notes');
const recordingsRoutes = require('./routes/recordings');
const uploadsRoutes = require('./routes/uploads');
const aiRoutes = require('./routes/ai');
const userRoutes = require('./routes/user');
const analyticsRoutes = require('./routes/analytics');
const alertsRoutes = require('./routes/alerts');
const { reportCrash, reportFailure, reportCounted, reportUnreportedServerError } = require('./utils/failureReporter');
const subscriptionsRoutes = require('./routes/subscriptions');
const onboardingRoutes = require('./routes/onboarding');
const formattingRoutes = require('./routes/formatting');
const authRoutes = require('./routes/auth');
const creatorsRoutes = require('./routes/creators');
const meetingsRoutes = require('./routes/meetings');
const outreachRoutes = require('./routes/outreach');
const ttsRoutes = require('./routes/tts');
const exportsRoutes = require('./routes/exports');
const sharingRoutes = require('./routes/sharing');
const integrationsRoutes = require('./routes/integrations');
const learningRoutes = require('./routes/learning');
const learnPageRoutes = require('./routes/learnPage');
const createContentRoutes = require('./routes/createContent');
const createPageRoutes = require('./routes/createPage');
const competeRoutes = require('./routes/compete');
const competePageRoutes = require('./routes/competePage');
const competeCreatePageRoutes = require('./routes/competeCreatePage');
const configRoutes = require('./routes/config');
const { requireFeature } = require('./config/featureFlags');
const phoneRoutes = require('./routes/phone');
const adminRoutes = require('./routes/admin');
const twilioWebhookRoutes = require('./routes/twilioWebhooks');
const { createJobRoutes, initializeCronJobs } = require('./jobs/creatorPayoutJobs');

const app = express();

// ============================================
// CRITICAL FIX: Trust Proxy Configuration
// This MUST be set before any other middleware
// Google Cloud Run acts as a reverse proxy
// ============================================
app.set('trust proxy', true);

// These pages must be served before Helmet (use inline scripts)
// Each is hidden (404) unless its feature flag is on; see config/featureFlags.js
app.use('/learn', requireFeature('learn', { page: true }), learnPageRoutes);
app.use('/create', requireFeature('create', { page: true }), createPageRoutes);
app.use('/compete', requireFeature('compete', { page: true }), competePageRoutes);
app.use('/compete-create', requireFeature('compete', { page: true }), competeCreatePageRoutes);

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
const allowAllOrigins = allowedOriginsEnv === '*';
const allowedOrigins = allowAllOrigins ? [] : allowedOriginsEnv.split(',');

app.use(cors({
  origin: (origin, callback) => {
    // Allow all origins if ALLOWED_ORIGINS is '*'
    if (allowAllOrigins) {
      callback(null, true);
      return;
    }
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ============================================
// IMPORTANT: Webhooks need raw body for signature verification
// These routes MUST be defined BEFORE express.json() middleware
// ============================================
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { logger } = require('./utils/logger');
const crypto = require('crypto');
const meetingService = require('./services/meetingService');
const { verifyStripeWebhook } = require('./utils/stripeWebhook');
const { verifyRecallWebhook } = require('./utils/recallWebhook');

// Recall.ai webhook - needs raw body for signature verification
const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET;
// Optional: Recall's workspace verification secret (used for real-time endpoints and accounts created on/after
// 2025-12-15). Tried in addition to RECALL_WEBHOOK_SECRET.
const RECALL_VERIFICATION_SECRET = process.env.RECALL_VERIFICATION_SECRET;

// LEGACY check (never matched Recall's real traffic: Recall signs with Svix headers, not x-recall-signature).
// Kept only so phase 1 never rejects anything the old code accepted. Replaced by the Svix check in phase 2.
function legacyRecallAccepts(signature, body) {
  if (!RECALL_WEBHOOK_SECRET || !signature) return true;
  try {
    const expectedSignature = crypto.createHmac('sha256', RECALL_WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch (error) {
    logger.error('Recall webhook signature verification error', { error: error.message });
    return false;
  }
}

app.post('/api/meetings/webhook/recall',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const rawBody = req.body.toString();
    const signature = req.headers['x-recall-signature'] || req.headers['x-webhook-signature'];

    // PHASE 1 (log-only for the Svix check): verify with Recall's documented Svix scheme. A failure is logged
    // (header NAMES only) and counted but the request is still accepted, because we have not yet seen a genuine
    // signed delivery in our logs. Phase 2 (separate PR) rejects instead.
    const svix = verifyRecallWebhook({
      rawBody: req.body,
      headers: req.headers,
      secrets: [RECALL_WEBHOOK_SECRET, RECALL_VERIFICATION_SECRET],
    });
    if (svix.ok) {
      logger.info('webhookAuth', { provider: 'recall', outcome: 'ok', scheme: svix.scheme });
    } else {
      logger.warn('webhookAuth', { provider: 'recall', outcome: 'unverified_accepted', reason: svix.reason, signatureHeaders: svix.headerNames.join(',') || 'none' });
      reportCounted('webhook_recall', `Recall webhook not verified (phase 1, accepted): ${svix.reason}`, { reason: svix.reason, signatureHeaders: svix.headerNames.join(',') || 'none' });
    }

    if (!svix.ok && !legacyRecallAccepts(signature, rawBody)) {
      logger.warn('Invalid Recall webhook signature received');
      reportFailure('webhook_recall', new Error('Recall webhook rejected: invalid signature'), { code: 'BAD_SIGNATURE' });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      logger.error('Failed to parse Recall webhook payload', { error: err.message });
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Log full payload to understand structure
    logger.info('Recall webhook received', {
      event: payload.event,
      fullPayload: JSON.stringify(payload),
    });

    try {
      await meetingService.handleBotStatusWebhook(payload);
      res.json({ received: true });
    } catch (error) {
      logger.error('Recall webhook processing error', { error: error.message });
      reportFailure('webhook_recall', new Error('Recall webhook processing failed (acknowledged 200)'), { code: 'PROCESSING_FAILED' });
      res.json({ received: true }); // Still acknowledge to prevent retries
    }
  }
);

// Stripe webhook
app.post('/api/subscriptions/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const verified = verifyStripeWebhook({
      stripe,
      rawBody: req.body,
      signature: req.headers['stripe-signature'],
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    if (!verified.ok) {
      logger.error('Stripe webhook rejected', { code: verified.code, error: verified.message });
      // A missing header is internet scanner noise; a bad signature or a missing secret is worth an alert.
      if (verified.code !== 'MISSING_SIGNATURE') {
        reportFailure('webhook_stripe', new Error(`Stripe webhook rejected: ${verified.code}`), { code: verified.code });
      }
      return res.status(verified.status).send(`Webhook Error: ${verified.message}`);
    }
    const event = verified.event;

    logger.info('Stripe webhook received', { type: event.type, id: event.id });

    // Import the handler functions from subscriptions route
    const { handleStripeWebhook } = require('./routes/subscriptions');

    try {
      await handleStripeWebhook(event, stripe);
      res.json({ received: true });
    } catch (error) {
      logger.error('Stripe webhook processing error', { error: error.message });
      reportFailure('webhook_stripe', new Error('Stripe webhook processing failed (acknowledged 200)'), { code: 'PROCESSING_FAILED', event_type: String(event.type || 'unknown') });
      res.json({ received: true }); // Still acknowledge to prevent retries
    }
  }
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);
// Safety net: any 5xx sent without going through errorHandler (res.status(500).json in a catch) still pages.
app.use((req, res, next) => { res.on('finish', () => reportUnreportedServerError(req, res)); next(); });

// Rate limiting allowlist (for testing)
// Add IPs to RATE_LIMIT_ALLOWLIST env var as comma-separated values
const rateLimitAllowlist = (process.env.RATE_LIMIT_ALLOWLIST || '').split(',').filter(ip => ip.trim());
const rateLimitDisabled = process.env.RATE_LIMIT_DISABLED === 'true';

// Rate limiting with proper proxy support
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Prefer a per-user key when the request carries an auth token. Falls
  // back to IP only when truly anonymous. This stops users behind a shared
  // NAT (or behind one user's testing burst) from being denied service.
  keyGenerator: (req) => {
    // Token can ride on the Authorization header (API clients) or on
    // ?token= (server-rendered pages loaded in a WebView).
    let token = null;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      token = auth.substring(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }
    if (token) {
      try {
        // Just decode the JWT body — we don't need to verify the signature
        // for the purpose of bucketing requests. If the payload is forged
        // the user still hits their own bucket; downstream auth handles auth.
        const parts = token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload && payload.sub) return `user:${payload.sub}`;
        }
      } catch (_) { /* fall through to IP */ }
    }
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return `ip:${forwarded.split(',')[0].trim()}`;
    }
    return `ip:${req.ip || req.connection.remoteAddress || 'unknown'}`;
  },
  // Skip rate limiting for allowlisted IPs, disabled, or polling endpoints
  skip: (req) => {
    if (rateLimitDisabled) {
      return true;
    }
    // Skip rate limiting for podcast status polling (called every 2s during generation)
    if (req.path.includes('/ai/podcast/status/')) {
      return true;
    }
    // Bypass for subscribed clients: the app sends `x-bypass-rate-limit`
    // with a shared secret only when the user is subscribed.
    const bypassToken = process.env.RATE_LIMIT_BYPASS_TOKEN;
    if (bypassToken && req.headers['x-bypass-rate-limit'] === bypassToken) {
      return true;
    }
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    const isAllowlisted = rateLimitAllowlist.some(ip => clientIp.includes(ip.trim()));
    if (isAllowlisted) {
      console.log(`Rate limit bypassed for allowlisted IP: ${clientIp}`);
    }
    return isAllowlisted;
  },
  // Skip failed requests to prevent attackers from bypassing rate limit
  skipFailedRequests: false,
  skipSuccessfulRequests: false,
  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
    console.log(`Rate limit exceeded for IP: ${clientIp}`);
    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later.'
    });
  }
});
app.use('/api/', limiter);

// Routes
app.use('/health', healthRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/recordings', recordingsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/user', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/formatting', formattingRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/creators', creatorsRoutes);
app.use('/api/meetings', meetingsRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/notes', exportsRoutes);
app.use('/api/notes', sharingRoutes);
app.use('/api', sharingRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/config', configRoutes);
// Worker callbacks of the learning pipeline stay reachable: they are not the user-facing feature.
app.use('/api/learn', requireFeature('learn', { except: /^\/webhook\// }), learningRoutes);
app.use('/api/create', requireFeature('create'), createContentRoutes);
app.use('/api/compete', requireFeature('compete'), competeRoutes);
app.use('/api/phone', requireFeature('phone_calls'), phoneRoutes);
app.use('/api/admin', adminRoutes);
// Twilio webhooks need to be reachable without the /api prefix to match
// the Voice/Status callback URLs configured in twilioService.js.
app.use('/v1/webhooks/twilio', twilioWebhookRoutes);
// learnPageRoutes mounted before helmet() above
app.use('/api/jobs', createJobRoutes());

// Initialize cron jobs (if node-cron is installed)
if (process.env.ENABLE_CRON_JOBS === 'true') {
  initializeCronJobs();
}
// Outreach daily stats rollup (read/aggregate only). Off unless OUTREACH_STATS_ROLLUP_CRON=true.
require('./services/outreachStatsRollup').initializeOutreachRollupCron();

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

// Start server
// Process-level failures: log, report (awaited so the email goes out), then exit like Node's default.
for (const evt of ['uncaughtException', 'unhandledRejection']) {
    process.on(evt, (err) => {
        console.error(evt, err);
        reportCrash(evt, err).finally(() => process.exit(1));
    });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Trust proxy enabled: ${app.get('trust proxy')}`);
  require('./services/recordingReconciler').startRecordingReconciler();
  require('./services/llmMonitor').startProbe({ log: (m) => console.warn(`[llm-monitor] ${m}`) });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  // Send the last buffered LLM usage and health rows before the machine stops (capped so shutdown cannot hang).
  try {
    const { llmUsage } = require('./config/openai');
    const monitor = require('./services/llmMonitor').getMonitor();
    await Promise.race([
      Promise.allSettled([llmUsage.flush(), monitor ? monitor.recorder.flush() : null]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* best effort */ }
  process.exit(0);
});

module.exports = app;