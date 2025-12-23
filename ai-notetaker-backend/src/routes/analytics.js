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

// Get feature usage metrics
router.get('/features', authenticate, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: events, error } = await supabase
    .from('analytics_events')
    .select('event_name, event_data, created_at')
    .gte('created_at', startDate.toISOString());

  if (error) throw error;

  const metrics = calculateFeatureMetrics(events);
  res.json({ success: true, data: metrics });
}));

// Get session metrics
router.get('/sessions', authenticate, asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: events, error } = await supabase
    .from('analytics_events')
    .select('event_name, event_data, created_at')
    .in('event_name', ['session_start', 'session_end', 'app_launch'])
    .gte('created_at', startDate.toISOString());

  if (error) throw error;

  const metrics = calculateSessionMetrics(events);
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

function calculateFeatureMetrics(events) {
  const featureUsage = {
    quiz: { views: 0, generated: 0, completed: 0, users: new Set() },
    flashcards: { views: 0, generated: 0, completed: 0, users: new Set() },
    podcast: { views: 0, generated: 0, plays: 0, completed: 0, users: new Set() },
    chat: { views: 0, messages: 0, users: new Set() },
    summary: { views: 0, generated: 0, users: new Set() }
  };

  const tabSwitches = {};

  events.forEach(e => {
    const userId = e.event_data?.user_id || e.event_data?.server_user_id;
    const props = e.event_data?.properties || {};

    switch (e.event_name) {
      // Quiz
      case 'quiz_tab_viewed':
        featureUsage.quiz.views++;
        if (userId) featureUsage.quiz.users.add(userId);
        break;
      case 'quiz_generated':
        featureUsage.quiz.generated++;
        break;
      case 'quiz_completed':
        featureUsage.quiz.completed++;
        break;

      // Flashcards
      case 'flashcards_tab_viewed':
        featureUsage.flashcards.views++;
        if (userId) featureUsage.flashcards.users.add(userId);
        break;
      case 'flashcards_generated':
        featureUsage.flashcards.generated++;
        break;
      case 'flashcards_completed':
        featureUsage.flashcards.completed++;
        break;

      // Podcast
      case 'podcast_tab_viewed':
        featureUsage.podcast.views++;
        if (userId) featureUsage.podcast.users.add(userId);
        break;
      case 'podcast_generated':
        featureUsage.podcast.generated++;
        break;
      case 'podcast_play_started':
        featureUsage.podcast.plays++;
        break;
      case 'podcast_play_completed':
        featureUsage.podcast.completed++;
        break;

      // Chat
      case 'chat_tab_viewed':
        featureUsage.chat.views++;
        if (userId) featureUsage.chat.users.add(userId);
        break;
      case 'chat_message_sent':
        featureUsage.chat.messages++;
        break;

      // Summary
      case 'summary_tab_viewed':
        featureUsage.summary.views++;
        if (userId) featureUsage.summary.users.add(userId);
        break;
      case 'summary_generated':
        featureUsage.summary.generated++;
        break;

      // Tab switches
      case 'tab_switched':
        const toTab = props.to_tab;
        if (toTab) {
          tabSwitches[toTab] = (tabSwitches[toTab] || 0) + 1;
        }
        break;
    }
  });

  // Convert Sets to counts for JSON serialization
  return {
    quiz: {
      views: featureUsage.quiz.views,
      generated: featureUsage.quiz.generated,
      completed: featureUsage.quiz.completed,
      unique_users: featureUsage.quiz.users.size,
      completion_rate: featureUsage.quiz.generated > 0
        ? ((featureUsage.quiz.completed / featureUsage.quiz.generated) * 100).toFixed(1)
        : 0
    },
    flashcards: {
      views: featureUsage.flashcards.views,
      generated: featureUsage.flashcards.generated,
      completed: featureUsage.flashcards.completed,
      unique_users: featureUsage.flashcards.users.size,
      completion_rate: featureUsage.flashcards.generated > 0
        ? ((featureUsage.flashcards.completed / featureUsage.flashcards.generated) * 100).toFixed(1)
        : 0
    },
    podcast: {
      views: featureUsage.podcast.views,
      generated: featureUsage.podcast.generated,
      plays: featureUsage.podcast.plays,
      completed: featureUsage.podcast.completed,
      unique_users: featureUsage.podcast.users.size,
      play_rate: featureUsage.podcast.generated > 0
        ? ((featureUsage.podcast.plays / featureUsage.podcast.generated) * 100).toFixed(1)
        : 0,
      completion_rate: featureUsage.podcast.plays > 0
        ? ((featureUsage.podcast.completed / featureUsage.podcast.plays) * 100).toFixed(1)
        : 0
    },
    chat: {
      views: featureUsage.chat.views,
      messages: featureUsage.chat.messages,
      unique_users: featureUsage.chat.users.size,
      avg_messages_per_session: featureUsage.chat.views > 0
        ? (featureUsage.chat.messages / featureUsage.chat.views).toFixed(1)
        : 0
    },
    summary: {
      views: featureUsage.summary.views,
      generated: featureUsage.summary.generated,
      unique_users: featureUsage.summary.users.size,
      generation_rate: featureUsage.summary.views > 0
        ? ((featureUsage.summary.generated / featureUsage.summary.views) * 100).toFixed(1)
        : 0
    },
    tab_popularity: tabSwitches
  };
}

function calculateSessionMetrics(events) {
  const sessions = [];
  const dailyActive = {};
  let totalDuration = 0;
  let sessionCount = 0;

  events.forEach(e => {
    const date = e.created_at.split('T')[0];
    const userId = e.event_data?.user_id || e.event_data?.server_user_id;
    const props = e.event_data?.properties || {};

    if (e.event_name === 'session_start') {
      sessionCount++;
      if (!dailyActive[date]) dailyActive[date] = new Set();
      if (userId) dailyActive[date].add(userId);
    }

    if (e.event_name === 'session_end') {
      const duration = props.session_duration_seconds || 0;
      totalDuration += duration;
      sessions.push(duration);
    }
  });

  // Calculate DAU
  const dauData = Object.entries(dailyActive).map(([date, users]) => ({
    date,
    active_users: users.size
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Calculate average session duration
  const avgDuration = sessions.length > 0
    ? (sessions.reduce((a, b) => a + b, 0) / sessions.length).toFixed(0)
    : 0;

  return {
    total_sessions: sessionCount,
    total_duration_minutes: Math.round(totalDuration / 60),
    avg_session_duration_seconds: avgDuration,
    daily_active_users: dauData
  };
}

module.exports = router;