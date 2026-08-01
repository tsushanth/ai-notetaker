const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function debugIOSTrials() {
  console.log('\n========== iOS TRIAL DEBUGGING (DETAILED) ==========\n');

  // 1. Check iOS subscriptions with all fields
  console.log('1. iOS subscriptions - checking critical fields:');
  const { data: allIOS } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('platform', 'ios');

  allIOS?.forEach(sub => {
    console.log('\n  ========================');
    console.log(`  User ID: ${sub.user_id}`);
    console.log(`  Product: ${sub.product_id}`);
    console.log(`  Status: ${sub.status}`);
    console.log(`  is_trial: ${sub.is_trial}`);
    console.log(`  trial_end: ${sub.trial_end}`);
    console.log(`  original_transaction_id: ${sub.original_transaction_id || '❌ MISSING!'}`);
    console.log(`  current_period_end: ${sub.current_period_end || 'null'}`);
    console.log(`  auto_renew_enabled: ${sub.auto_renew_enabled}`);
    console.log(`  created_at: ${sub.created_at}`);
    console.log(`  updated_at: ${sub.updated_at}`);

    // Check for issues
    const issues = [];
    if (!sub.original_transaction_id) {
      issues.push('❌ No original_transaction_id - Apple webhooks cannot match this subscription!');
    }
    if (sub.is_trial && sub.trial_end && new Date(sub.trial_end) < new Date()) {
      issues.push('❌ STALE TRIAL: is_trial=true but trial_end has passed');
    }
    if (sub.created_at === sub.updated_at) {
      issues.push('⚠️  Never updated since creation');
    }

    if (issues.length > 0) {
      console.log('\n  ISSUES:');
      issues.forEach(i => console.log(`    ${i}`));
    }
  });

  // 2. Check iOS sync endpoint - what data does it receive?
  console.log('\n\n2. Checking subscription_events metadata for sync details:');
  const { data: events } = await supabase
    .from('subscription_events')
    .select('*')
    .eq('platform', 'ios')
    .order('created_at', { ascending: false })
    .limit(20);

  events?.forEach(e => {
    console.log(`\n  ${e.event_type} at ${e.created_at}`);
    console.log(`    User: ${e.user_id}`);
    console.log(`    Metadata: ${JSON.stringify(e.metadata)}`);
  });

  // 3. Summary and recommendations
  console.log('\n\n========== DIAGNOSIS ==========\n');

  const staleTrials = allIOS?.filter(s =>
    s.is_trial === true && s.trial_end && new Date(s.trial_end) < new Date()
  ) || [];

  const missingTxnId = allIOS?.filter(s => !s.original_transaction_id) || [];

  console.log(`Total iOS subscriptions: ${allIOS?.length || 0}`);
  console.log(`Stale trials (should have converted): ${staleTrials.length}`);
  console.log(`Missing original_transaction_id: ${missingTxnId.length}`);

  if (missingTxnId.length > 0) {
    console.log('\n⚠️  CRITICAL: Subscriptions without original_transaction_id cannot receive Apple webhooks!');
    console.log('   Apple needs this ID to match webhook notifications to subscriptions.');
  }

  if (staleTrials.length > 0) {
    console.log('\n📋 STALE TRIALS TO FIX:');
    staleTrials.forEach(s => {
      console.log(`   - User ${s.user_id}: trial ended at ${s.trial_end}`);
    });
  }

  // 4. Check if Apple webhook URL is configured
  console.log('\n\n========== APPLE WEBHOOK CONFIG CHECK ==========\n');
  console.log('Apple Server Notifications should be configured in App Store Connect to send to:');
  console.log('  POST https://ai-notetaker-backend.fly.dev/api/subscriptions/webhook/apple');
  console.log('\nNo webhook events found in database - verify webhook URL in App Store Connect!');

  console.log('\n========== END DEBUG ==========\n');
}

debugIOSTrials().catch(console.error);
