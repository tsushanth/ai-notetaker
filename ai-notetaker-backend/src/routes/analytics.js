const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Batch track analytics events (non-blocking insert)
router.post('/batch', authenticate, asyncHandler(async (req, res) => {
  const { events } = req.body;
  const userId = req.userId;

  // Respond immediately - don't wait for DB
  res.status(200).json({ success: true });

  // Process in background
  setImmediate(async () => {
    try {
      if (!Array.isArray(events) || events.length === 0) return;

      const rows = events.map(event => ({
        user_id: userId,
        event_name: event.event,
        event_data: {
          ...event,
          server_user_id: userId,
          server_timestamp: new Date().toISOString()
        },
        created_at: event.timestamp || new Date().toISOString()
      }));

      // Batch insert
      const { error } = await supabase
        .from('analytics_events')
        .insert(rows);

      if (error) {
        logger.error('Analytics batch insert failed', { error: error.message });
      } else {
        logger.debug(`Analytics: ${rows.length} events stored`, { userId });
      }
    } catch (err) {
      logger.error('Analytics background processing error', { error: err.message });
    }
  });
}));

// Single event (backward compatibility)
router.post('/event', authenticate, asyncHandler(async (req, res) => {
  const eventData = req.body;
  const userId = req.userId;

  // Respond immediately
  res.status(200).json({ success: true });

  // Process in background
  setImmediate(async () => {
    try {
      await supabase
        .from('analytics_events')
        .insert({
          user_id: userId,
          event_name: eventData.event,
          event_data: {
            ...eventData,
            server_user_id: userId,
            server_timestamp: new Date().toISOString()
          },
          created_at: new Date().toISOString()
        });
    } catch (err) {
      logger.error('Analytics insert error', { error: err.message });
    }
  });
}));

// Get funnel metrics (admin only - this can be slower)
router.get('/funnel', authenticate, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: events, error } = await supabase
    .from('analytics_events')
    .select('event_name, event_data, created_at')
    .gte('created_at', startDate.toISOString());

  if (error) throw error;

  const metrics = calculateFunnelMetrics(events);
  res.json({ success: true, data: metrics });
}));

function calculateFunnelMetrics(events) {
  const uniqueUsers = new Set();
  const reachedValue = new Set();
  const trialStarted = new Set();
  const trialCancelled24h = new Set();
  const billedSuccessfully = new Set();

  events.forEach(e => {
    const userId = e.event_data?.user_id || e.event_data?.server_user_id;
    if (!userId) return;

    uniqueUsers.add(userId);

    switch (e.event_name) {
      case 'reached_value':
        reachedValue.add(userId);
        break;
      case 'trial_started':
        trialStarted.add(userId);
        break;
      case 'trial_cancelled':
        const daysInTrial = e.event_data?.properties?.days_in_trial || 0;
        if (daysInTrial <= 1) {
          trialCancelled24h.add(userId);
        }
        break;
      case 'subscription_billed':
        billedSuccessfully.add(userId);
        break;
    }
  });

  const totalUsers = uniqueUsers.size;
  const trialCount = trialStarted.size;

  return {
    total_users: totalUsers,
    reached_value: {
      count: reachedValue.size,
      percent: totalUsers ? ((reachedValue.size / totalUsers) * 100).toFixed(1) : 0
    },
    trial_started: {
      count: trialCount,
      percent: totalUsers ? ((trialCount / totalUsers) * 100).toFixed(1) : 0
    },
    trial_cancelled_24h: {
      count: trialCancelled24h.size,
      percent: trialCount ? ((trialCancelled24h.size / trialCount) * 100).toFixed(1) : 0
    },
    billed_successfully: {
      count: billedSuccessfully.size,
      percent: trialCount ? ((billedSuccessfully.size / trialCount) * 100).toFixed(1) : 0
    }
  };
}

module.exports = router;