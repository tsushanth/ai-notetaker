const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

/**
 * Health check endpoint
 * GET /health
 */
router.get('/', async (req, res) => {
  try {
    // Check Supabase connection
    const { error } = await supabase.from('notes').select('count', { count: 'exact', head: true });
    
    const status = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      services: {
        supabase: error ? 'unhealthy' : 'healthy',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'not configured'
      }
    };

    res.status(200).json(status);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;
