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
const subscriptionsRoutes = require('./routes/subscriptions');
const onboardingRoutes = require('./routes/onboarding');
const formattingRoutes = require('./routes/formatting');
const authRoutes = require('./routes/auth');
const creatorsRoutes = require('./routes/creators');
const meetingsRoutes = require('./routes/meetings');
const outreachRoutes = require('./routes/outreach');
const { createJobRoutes, initializeCronJobs } = require('./jobs/creatorPayoutJobs');

const app = express();

// ============================================
// CRITICAL FIX: Trust Proxy Configuration
// This MUST be set before any other middleware
// Google Cloud Run acts as a reverse proxy
// ============================================
app.set('trust proxy', true);

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

// Recall.ai webhook - needs raw body for signature verification
const RECALL_WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET;

function verifyRecallSignature(signature, body) {
  if (!RECALL_WEBHOOK_SECRET || !signature) {
    logger.warn('Recall webhook signature verification skipped - missing secret or signature');
    return true; // Allow through in development if not configured
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', RECALL_WEBHOOK_SECRET)
      .update(body, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
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

    // Verify webhook signature
    if (RECALL_WEBHOOK_SECRET && !verifyRecallSignature(signature, rawBody)) {
      logger.warn('Invalid Recall webhook signature received');
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
      res.json({ received: true }); // Still acknowledge to prevent retries
    }
  }
);

// Stripe webhook
app.post('/api/subscriptions/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      if (webhookSecret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        // For testing without webhook signature verification
        event = JSON.parse(req.body.toString());
        logger.warn('Stripe webhook signature verification skipped - no webhook secret configured');
      }
    } catch (err) {
      logger.error('Stripe webhook signature verification failed', { error: err.message });
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info('Stripe webhook received', { type: event.type, id: event.id });

    // Import the handler functions from subscriptions route
    const { handleStripeWebhook } = require('./routes/subscriptions');

    try {
      await handleStripeWebhook(event, stripe);
      res.json({ received: true });
    } catch (error) {
      logger.error('Stripe webhook processing error', { error: error.message });
      res.json({ received: true }); // Still acknowledge to prevent retries
    }
  }
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

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
  // Proper key generator for Cloud Run/proxied environments
  keyGenerator: (req) => {
    // Google Cloud Run sets X-Forwarded-For header
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // X-Forwarded-For can be a comma-separated list, take the first (original client)
      return forwarded.split(',')[0].trim();
    }
    // Fallback to req.ip (which works correctly when trust proxy is enabled)
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  // Skip rate limiting for allowlisted IPs or when disabled
  skip: (req) => {
    if (rateLimitDisabled) {
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
app.use('/api/jobs', createJobRoutes());

// Initialize cron jobs (if node-cron is installed)
if (process.env.ENABLE_CRON_JOBS === 'true') {
  initializeCronJobs();
}

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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`Trust proxy enabled: ${app.get('trust proxy')}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

module.exports = app;