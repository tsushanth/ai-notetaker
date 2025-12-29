/**
 * Creator Payout Jobs
 * Scheduled jobs for processing earning maturity and payouts
 *
 * JOBS:
 * 1. processMaturedEarnings - Daily at 2 AM UTC
 *    - Checks earnings that have reached 45-day maturity
 *    - Verifies subscription still active, no refunds/chargebacks
 *    - Moves status from 'maturing' to 'approved'
 *
 * 2. processMonthlyPayouts - 1st of each month at 3 AM UTC
 *    - Processes payouts for all creators with approved earnings >= $50
 *    - Creates Stripe transfers to connected accounts
 *
 * SETUP OPTIONS:
 * 1. Cloud Run + Cloud Scheduler (recommended for GCP)
 * 2. Node-cron in the main app process
 * 3. External cron service calling API endpoints
 */

const { logger } = require('../utils/logger');
const earningMaturityService = require('../services/earningMaturityService');
const payoutService = require('../services/payoutService');
const creatorActivityService = require('../services/creatorActivityService');
const commissionCapService = require('../services/commissionCapService');
const fraudAnomalyService = require('../services/fraudAnomalyService');

/**
 * Process earnings that have reached maturity (daily job)
 * Run this daily to approve mature earnings
 */
async function runMaturityProcessing() {
  logger.info('Starting maturity processing job');

  try {
    const result = await earningMaturityService.processMaturedEarnings();

    logger.info('Maturity processing complete', {
      processed: result.processed,
      approved: result.approved,
      cancelled: result.cancelled,
      errors: result.errors,
    });

    return result;
  } catch (error) {
    logger.error('Maturity processing job failed', { error: error.message });
    throw error;
  }
}

/**
 * Process monthly payouts (monthly job)
 * Run this on the 1st of each month
 */
async function runMonthlyPayouts() {
  logger.info('Starting monthly payout processing job');

  try {
    const result = await payoutService.processMonthlyPayouts();

    logger.info('Monthly payout processing complete', {
      processed: result.processed,
      successful: result.successful,
      failed: result.failed,
      skipped: result.skipped,
    });

    return result;
  } catch (error) {
    logger.error('Monthly payout processing job failed', { error: error.message });
    throw error;
  }
}

/**
 * Process creator activity checks (daily job)
 * Run this daily to check activity and send warnings/downgrades
 *
 * ACTIVITY REQUIREMENTS (ANY of these keeps creator status):
 * - 1+ paid referral in 90 days, OR
 * - 2+ content submissions in 90 days, OR
 * - 10+ referred signups (trial or paid) in 90 days
 *
 * DOWNGRADE PROCESS:
 * 1. First warning email when inactive
 * 2. Final warning 7 days before downgrade
 * 3. Automatic downgrade after grace period
 */
async function runActivityChecks() {
  logger.info('Starting creator activity checks job');

  try {
    const result = await creatorActivityService.processActivityChecks();

    logger.info('Activity checks complete', {
      processed: result.processed,
      warnings: result.warnings,
      finalWarnings: result.finalWarnings,
      downgrades: result.downgrades,
      reactivations: result.reactivations,
      errors: result.errors,
    });

    return result;
  } catch (error) {
    logger.error('Activity checks job failed', { error: error.message });
    throw error;
  }
}

/**
 * Reset monthly commission cap tracking (monthly job)
 * Run this on the 1st of each month at 1 AM UTC (before payouts)
 *
 * RULE 9: Commission caps reset at the start of each month
 * This resets:
 * - current_month_commission to 0
 * - current_month_referrals to 0
 * - commission_month_reset_at to current date
 */
async function runMonthlyCapReset() {
  logger.info('Starting monthly commission cap reset job');

  try {
    const result = await commissionCapService.resetMonthlyTracking();

    logger.info('Monthly cap reset complete', {
      success: result.success,
      previousMonth: result.previousMonth,
      error: result.error,
    });

    return result;
  } catch (error) {
    logger.error('Monthly cap reset job failed', { error: error.message });
    throw error;
  }
}

/**
 * Process fraud anomaly detection (daily job)
 * Run this daily to scan all creators for fraud patterns
 *
 * RULE 10: Automatic fraud & anomaly flagging
 *
 * AUTO-FLAG CREATORS WHEN:
 * - 40-50% of referred users refund or chargeback
 * - Multiple signups share device IPs or fingerprints
 * - 10+ paid signups happen within same 1-2 hours
 * - Signups all share same BIN (virtual card farm)
 * - Highly suspicious geos unrelated to creator audience
 *
 * ACTIONS:
 * - Freeze commission
 * - Require manual review
 * - Optional creator suspension (for severe cases)
 */
async function runFraudAnomalyScan() {
  logger.info('Starting fraud anomaly scan job');

  try {
    const result = await fraudAnomalyService.scanAllCreatorsForAnomalies();

    logger.info('Fraud anomaly scan complete', {
      success: result.success,
      scanned: result.scanned,
      flagged: result.flagged,
      totalFlags: result.totalFlags,
      errors: result.errors?.length || 0,
      durationMs: result.durationMs,
    });

    return result;
  } catch (error) {
    logger.error('Fraud anomaly scan job failed', { error: error.message });
    throw error;
  }
}

/**
 * Initialize cron jobs using node-cron
 * Call this from app.js if using in-process scheduling
 */
function initializeCronJobs() {
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    logger.warn('node-cron not installed. Cron jobs will not run in-process.');
    logger.info('Use Cloud Scheduler or external cron to call job endpoints instead.');
    return;
  }

  // Daily maturity processing at 2 AM UTC
  cron.schedule('0 2 * * *', async () => {
    logger.info('Cron: Starting daily maturity processing');
    try {
      await runMaturityProcessing();
    } catch (error) {
      logger.error('Cron: Maturity processing failed', { error: error.message });
    }
  }, {
    timezone: 'UTC'
  });

  // Monthly cap reset on 1st of each month at 1 AM UTC (before payouts)
  cron.schedule('0 1 1 * *', async () => {
    logger.info('Cron: Starting monthly commission cap reset');
    try {
      await runMonthlyCapReset();
    } catch (error) {
      logger.error('Cron: Monthly cap reset failed', { error: error.message });
    }
  }, {
    timezone: 'UTC'
  });

  // Monthly payouts on 1st of each month at 3 AM UTC
  cron.schedule('0 3 1 * *', async () => {
    logger.info('Cron: Starting monthly payout processing');
    try {
      await runMonthlyPayouts();
    } catch (error) {
      logger.error('Cron: Monthly payout processing failed', { error: error.message });
    }
  }, {
    timezone: 'UTC'
  });

  // Daily activity checks at 4 AM UTC
  cron.schedule('0 4 * * *', async () => {
    logger.info('Cron: Starting daily activity checks');
    try {
      await runActivityChecks();
    } catch (error) {
      logger.error('Cron: Activity checks failed', { error: error.message });
    }
  }, {
    timezone: 'UTC'
  });

  // Daily fraud anomaly scan at 5 AM UTC
  cron.schedule('0 5 * * *', async () => {
    logger.info('Cron: Starting daily fraud anomaly scan');
    try {
      await runFraudAnomalyScan();
    } catch (error) {
      logger.error('Cron: Fraud anomaly scan failed', { error: error.message });
    }
  }, {
    timezone: 'UTC'
  });

  logger.info('Cron jobs initialized: maturity (daily 2 AM UTC), cap reset (monthly 1st 1 AM UTC), payouts (monthly 1st 3 AM UTC), activity checks (daily 4 AM UTC), fraud scan (daily 5 AM UTC)');
}

/**
 * Express router for job endpoints (for Cloud Scheduler)
 */
function createJobRoutes() {
  const express = require('express');
  const router = express.Router();

  // Middleware to verify Cloud Scheduler requests
  const verifySchedulerRequest = (req, res, next) => {
    // In production, verify the request is from Cloud Scheduler
    // Check for specific headers or use IAM authentication
    const schedulerToken = req.headers['x-cloudscheduler'];
    const appEngineToken = req.headers['x-appengine-cron'];

    // For development, allow all requests
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    // In production, require either Cloud Scheduler or App Engine cron header
    // Or use a secret token
    const secretToken = process.env.CRON_SECRET_TOKEN;
    const providedToken = req.headers['x-cron-token'];

    if (schedulerToken || appEngineToken || (secretToken && providedToken === secretToken)) {
      return next();
    }

    logger.warn('Unauthorized cron request', {
      ip: req.ip,
      headers: Object.keys(req.headers),
    });

    return res.status(403).json({
      success: false,
      error: 'Unauthorized',
    });
  };

  /**
   * POST /api/jobs/process-maturity
   * Trigger maturity processing (for Cloud Scheduler)
   */
  router.post('/process-maturity', verifySchedulerRequest, async (req, res) => {
    try {
      const result = await runMaturityProcessing();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Job endpoint: maturity processing failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/jobs/process-payouts
   * Trigger payout processing (for Cloud Scheduler)
   */
  router.post('/process-payouts', verifySchedulerRequest, async (req, res) => {
    try {
      const result = await runMonthlyPayouts();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Job endpoint: payout processing failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/jobs/process-activity-checks
   * Trigger activity checks (for Cloud Scheduler)
   * Checks creator activity and sends warnings/downgrades
   */
  router.post('/process-activity-checks', verifySchedulerRequest, async (req, res) => {
    try {
      const result = await runActivityChecks();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Job endpoint: activity checks failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/jobs/reset-monthly-caps
   * Trigger monthly commission cap reset (for Cloud Scheduler)
   * Resets monthly commission tracking for all creators
   * Run on 1st of each month BEFORE payouts
   */
  router.post('/reset-monthly-caps', verifySchedulerRequest, async (req, res) => {
    try {
      const result = await runMonthlyCapReset();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Job endpoint: monthly cap reset failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/jobs/scan-fraud-anomalies
   * Trigger fraud anomaly scan (for Cloud Scheduler)
   * Scans all creators for fraud patterns and flags suspicious activity
   *
   * RULE 10: Auto-flags creators for:
   * - High refund/chargeback rates
   * - Device/IP clustering
   * - Velocity spikes
   * - BIN clustering (virtual card farms)
   * - Geographic anomalies
   */
  router.post('/scan-fraud-anomalies', verifySchedulerRequest, async (req, res) => {
    try {
      const result = await runFraudAnomalyScan();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Job endpoint: fraud anomaly scan failed', { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/jobs/status
   * Check job system status
   */
  router.get('/status', verifySchedulerRequest, async (req, res) => {
    res.json({
      success: true,
      data: {
        maturityProcessing: 'enabled',
        payoutProcessing: 'enabled',
        activityChecks: 'enabled',
        monthlyCapReset: 'enabled',
        fraudAnomalyScan: 'enabled',
        schedule: {
          maturity: 'Daily at 2 AM UTC',
          monthlyCapReset: '1st of month at 1 AM UTC',
          payouts: '1st of month at 3 AM UTC',
          activityChecks: 'Daily at 4 AM UTC',
          fraudAnomalyScan: 'Daily at 5 AM UTC',
        },
      },
    });
  });

  return router;
}

module.exports = {
  runMaturityProcessing,
  runMonthlyPayouts,
  runActivityChecks,
  runMonthlyCapReset,
  runFraudAnomalyScan,
  initializeCronJobs,
  createJobRoutes,
};
