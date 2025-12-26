const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

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
 */
router.get('/ready', async (req, res) => {
  try {
    // Quick check that supabaseAdmin works
    const { error } = await supabaseAdmin
      .from('notes')
      .select('id')
      .limit(1);

    if (error) {
      logger.warn('Readiness check failed', { error: error.message });
      return res.status(503).json({
        ready: false,
        reason: 'Database connection failed',
        error: error.message
      });
    }

    res.status(200).json({ ready: true });
  } catch (error) {
    res.status(503).json({
      ready: false,
      reason: error.message
    });
  }
});

module.exports = router;
