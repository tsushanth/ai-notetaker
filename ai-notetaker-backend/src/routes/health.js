const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { getEnvSummary, requiredEnvVars, optionalEnvVars } = require('../config/envValidation');

/**
 * Health check endpoint
 * GET /health
 *
 * Tests actual database connectivity using the service key (supabaseAdmin)
 * which is what the app uses for real operations.
 */
router.get('/', async (req, res) => {
  const checks = {
    supabaseAnon: { status: 'unknown', latencyMs: null },
    supabaseAdmin: { status: 'unknown', latencyMs: null },
    openai: { status: 'unknown' }
  };

  let isHealthy = true;

  try {
    // Check Supabase anon key connection
    const anonStart = Date.now();
    const { error: anonError } = await supabase
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    checks.supabaseAnon.latencyMs = Date.now() - anonStart;
    checks.supabaseAnon.status = anonError ? 'unhealthy' : 'healthy';
    if (anonError) {
      checks.supabaseAnon.error = anonError.message;
      isHealthy = false;
    }

    // Check Supabase admin/service key connection (THIS IS CRITICAL)
    const adminStart = Date.now();
    const { error: adminError } = await supabaseAdmin
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    checks.supabaseAdmin.latencyMs = Date.now() - adminStart;
    checks.supabaseAdmin.status = adminError ? 'unhealthy' : 'healthy';
    if (adminError) {
      checks.supabaseAdmin.error = adminError.message;
      isHealthy = false;
      logger.error('Health check failed: supabaseAdmin connection error', {
        error: adminError.message
      });
    }

    // Check OpenAI API key is configured
    checks.openai.status = process.env.OPENAI_API_KEY ? 'configured' : 'not configured';

    const status = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || 'unknown',
      checks
    };

    // Return 503 if any critical service is unhealthy
    const httpStatus = isHealthy ? 200 : 503;
    res.status(httpStatus).json(status);

  } catch (error) {
    logger.error('Health check exception', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      checks
    });
  }
});

/**
 * Simple liveness probe for Cloud Run
 * GET /health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * Readiness probe - checks if app can serve traffic
 * GET /health/ready
 *
 * Includes retry logic and timeout to handle transient network issues
 */
router.get('/ready', async (req, res) => {
  const TIMEOUT_MS = 5000; // 5 second timeout
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 500;

  const checkDatabase = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const { error } = await supabaseAdmin
        .from('notes')
        .select('id')
        .limit(1)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);
      return { success: !error, error: error?.message };
    } catch (err) {
      clearTimeout(timeoutId);
      return { success: false, error: err.message };
    }
  };

  // Retry logic for transient failures
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await checkDatabase();

    if (result.success) {
      return res.status(200).json({ ready: true });
    }

    if (attempt < MAX_RETRIES) {
      logger.warn('Readiness check failed, retrying', {
        attempt,
        maxRetries: MAX_RETRIES,
        error: result.error
      });
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    } else {
      logger.warn('Readiness check failed after retries', { error: result.error });
      return res.status(503).json({
        ready: false,
        reason: 'Database connection failed',
        error: result.error
      });
    }
  }
});

/**
 * Environment configuration status
 * GET /health/env
 *
 * Shows which environment variables are configured (not their values)
 * Useful for debugging deployment issues
 */
router.get('/env', (req, res) => {
  const summary = getEnvSummary();

  // Count status
  const requiredCount = Object.keys(summary.required).length;
  const requiredPresent = Object.values(summary.required).filter(v => v.present).length;
  const optionalCount = Object.keys(summary.optional).length;
  const optionalPresent = Object.values(summary.optional).filter(v => v.present).length;

  res.status(200).json({
    status: requiredPresent === requiredCount ? 'complete' : 'incomplete',
    required: {
      total: requiredCount,
      present: requiredPresent,
      missing: requiredCount - requiredPresent,
      variables: summary.required
    },
    optional: {
      total: optionalCount,
      present: optionalPresent,
      variables: summary.optional
    }
  });
});

module.exports = router;
