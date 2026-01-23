#!/usr/bin/env node
/**
 * Conversion Metrics Analysis Script
 * Run with: node scripts/analyze-conversion-metrics.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function analyzeConversionMetrics() {
  console.log('\n📊 SCRIBEAI CONVERSION METRICS ANALYSIS');
  console.log('='.repeat(60));

  const days = 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  console.log(`\nAnalyzing last ${days} days (since ${startDate.toISOString().split('T')[0]})\n`);

  // 1. Get all analytics events
  const { data: events, error: eventsError } = await supabase
    .from('analytics_events')
    .select('event_name, event_data, created_at, user_id')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });

  if (eventsError) {
    console.error('Error fetching events:', eventsError);
    return;
  }

  console.log(`Total events in period: ${events.length}`);

  // 2. Analyze funnel
  const uniqueUsers = new Set();
  const onboardingStarted = new Set();
  const onboardingCompleted = new Set();
  const onboardingSkipped = new Set();
  const paywallViewed = new Set();
  const paywallSources = {};
  const trialStarted = new Set();
  const trialSkipped = new Set();
  const reachedValue = new Set();
  const subscriptionBilled = new Set();
  const noteCreated = new Set();

  // Feature usage
  const featureUsers = {
    quiz: new Set(),
    flashcards: new Set(),
    podcast: new Set(),
    chat: new Set(),
    summary: new Set(),
    mindmap: new Set(),
    infographic: new Set()
  };

  events.forEach(e => {
    const userId = e.user_id || e.event_data?.user_id || e.event_data?.server_user_id;
    if (!userId) return;

    uniqueUsers.add(userId);
    const props = e.event_data?.properties || {};

    switch (e.event_name) {
      case 'onboarding_started':
        onboardingStarted.add(userId);
        break;
      case 'onboarding_completed':
        onboardingCompleted.add(userId);
        break;
      case 'onboarding_skipped':
        onboardingSkipped.add(userId);
        break;
      case 'paywall_viewed':
        paywallViewed.add(userId);
        const source = props.source || 'unknown';
        paywallSources[source] = (paywallSources[source] || 0) + 1;
        break;
      case 'trial_started':
        trialStarted.add(userId);
        break;
      case 'trial_skipped':
        trialSkipped.add(userId);
        break;
      case 'reached_value':
        reachedValue.add(userId);
        break;
      case 'subscription_billed':
        subscriptionBilled.add(userId);
        break;
      case 'note_created':
        noteCreated.add(userId);
        break;

      // Feature tracking
      case 'quiz_tab_viewed':
      case 'quiz_generated':
        featureUsers.quiz.add(userId);
        break;
      case 'flashcards_tab_viewed':
      case 'flashcards_generated':
        featureUsers.flashcards.add(userId);
        break;
      case 'podcast_tab_viewed':
      case 'podcast_generated':
        featureUsers.podcast.add(userId);
        break;
      case 'chat_tab_viewed':
      case 'chat_message_sent':
        featureUsers.chat.add(userId);
        break;
      case 'summary_tab_viewed':
      case 'summary_generated':
        featureUsers.summary.add(userId);
        break;
      case 'mindmap_tab_viewed':
      case 'mindmap_generated':
        featureUsers.mindmap.add(userId);
        break;
      case 'infographic_tab_viewed':
      case 'infographic_generated':
        featureUsers.infographic.add(userId);
        break;
    }
  });

  const totalUsers = uniqueUsers.size;

  // Print funnel
  console.log('\n' + '─'.repeat(60));
  console.log('📈 CONVERSION FUNNEL');
  console.log('─'.repeat(60));

  const funnel = [
    { name: 'Total Users', count: totalUsers, percent: 100 },
    { name: 'Onboarding Started', count: onboardingStarted.size, percent: (onboardingStarted.size / totalUsers * 100) },
    { name: 'Onboarding Completed', count: onboardingCompleted.size, percent: (onboardingCompleted.size / totalUsers * 100) },
    { name: 'Created First Note', count: noteCreated.size, percent: (noteCreated.size / totalUsers * 100) },
    { name: 'Reached Value', count: reachedValue.size, percent: (reachedValue.size / totalUsers * 100) },
    { name: 'Paywall Viewed', count: paywallViewed.size, percent: (paywallViewed.size / totalUsers * 100) },
    { name: 'Trial Started', count: trialStarted.size, percent: (trialStarted.size / totalUsers * 100) },
    { name: 'Trial Skipped (no trial)', count: trialSkipped.size, percent: (trialSkipped.size / totalUsers * 100) },
    { name: 'Subscription Billed', count: subscriptionBilled.size, percent: (subscriptionBilled.size / totalUsers * 100) }
  ];

  funnel.forEach(step => {
    const bar = '█'.repeat(Math.round(step.percent / 5)) + '░'.repeat(20 - Math.round(step.percent / 5));
    console.log(`${step.name.padEnd(25)} ${String(step.count).padStart(5)} ${bar} ${step.percent.toFixed(1)}%`);
  });

  // Key conversion rates
  console.log('\n' + '─'.repeat(60));
  console.log('🎯 KEY CONVERSION RATES');
  console.log('─'.repeat(60));

  const paywallToTrial = paywallViewed.size > 0 ? (trialStarted.size / paywallViewed.size * 100) : 0;
  const trialToPaid = trialStarted.size > 0 ? (subscriptionBilled.size / trialStarted.size * 100) : 0;
  const overallConversion = totalUsers > 0 ? (subscriptionBilled.size / totalUsers * 100) : 0;
  const skipRate = paywallViewed.size > 0 ? (trialSkipped.size / paywallViewed.size * 100) : 0;

  console.log(`Paywall → Trial Start:     ${paywallToTrial.toFixed(1)}%`);
  console.log(`Trial → Paid Subscription: ${trialToPaid.toFixed(1)}%`);
  console.log(`Overall (User → Paid):     ${overallConversion.toFixed(1)}%`);
  console.log(`Trial Skip Rate:           ${skipRate.toFixed(1)}%`);

  // Paywall sources
  console.log('\n' + '─'.repeat(60));
  console.log('📍 PAYWALL VIEW SOURCES');
  console.log('─'.repeat(60));

  const sortedSources = Object.entries(paywallSources)
    .sort((a, b) => b[1] - a[1]);

  sortedSources.forEach(([source, count]) => {
    const percent = (count / events.filter(e => e.event_name === 'paywall_viewed').length * 100);
    console.log(`${source.padEnd(30)} ${String(count).padStart(5)} (${percent.toFixed(1)}%)`);
  });

  // Feature usage
  console.log('\n' + '─'.repeat(60));
  console.log('🔧 FEATURE USAGE (unique users)');
  console.log('─'.repeat(60));

  const sortedFeatures = Object.entries(featureUsers)
    .map(([name, users]) => ({ name, count: users.size }))
    .sort((a, b) => b.count - a.count);

  sortedFeatures.forEach(({ name, count }) => {
    const percent = totalUsers > 0 ? (count / totalUsers * 100) : 0;
    console.log(`${name.padEnd(20)} ${String(count).padStart(5)} users (${percent.toFixed(1)}% of total)`);
  });

  // 3. Get subscription data
  console.log('\n' + '─'.repeat(60));
  console.log('💳 CURRENT SUBSCRIPTION STATUS');
  console.log('─'.repeat(60));

  const { data: subscriptions, error: subError } = await supabase
    .from('subscriptions')
    .select('status, product_id, platform, is_trial, created_at');

  if (!subError && subscriptions) {
    const statusCounts = {};
    const platformCounts = {};

    subscriptions.forEach(sub => {
      statusCounts[sub.status] = (statusCounts[sub.status] || 0) + 1;
      platformCounts[sub.platform] = (platformCounts[sub.platform] || 0) + 1;
    });

    console.log('\nBy Status:');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status.padEnd(20)} ${count}`);
      });

    console.log('\nBy Platform:');
    Object.entries(platformCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([platform, count]) => {
        console.log(`  ${platform.padEnd(20)} ${count}`);
      });
  }

  // 4. Daily active users trend
  console.log('\n' + '─'.repeat(60));
  console.log('📅 DAILY ACTIVE USERS (Last 7 days)');
  console.log('─'.repeat(60));

  const last7Days = new Date();
  last7Days.setDate(last7Days.getDate() - 7);

  const recentEvents = events.filter(e => new Date(e.created_at) >= last7Days);
  const dailyUsers = {};

  recentEvents.forEach(e => {
    const date = e.created_at.split('T')[0];
    const userId = e.user_id || e.event_data?.user_id;
    if (!dailyUsers[date]) dailyUsers[date] = new Set();
    if (userId) dailyUsers[date].add(userId);
  });

  Object.entries(dailyUsers)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, users]) => {
      const bar = '█'.repeat(Math.min(users.size, 50));
      console.log(`${date}  ${String(users.size).padStart(4)} ${bar}`);
    });

  console.log('\n' + '='.repeat(60));
  console.log('Analysis complete!\n');
}

analyzeConversionMetrics().catch(console.error);
