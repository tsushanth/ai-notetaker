/**
 * Fix Stale iOS Trials Script
 *
 * This script finds iOS subscriptions where:
 * - is_trial = true
 * - trial_end has passed
 * - status = 'active'
 *
 * And fixes them by:
 * 1. Setting is_trial = false
 * 2. Logging a trial_converted event
 *
 * Usage: node scripts/fix-stale-ios-trials.js [--dry-run]
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const isDryRun = process.argv.includes('--dry-run');

async function fixStaleTrials() {
  console.log('\n========== FIX STALE iOS TRIALS ==========\n');
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}\n`);

  const now = new Date().toISOString();

  // Find stale trials
  const { data: staleTrials, error: fetchError } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('platform', 'ios')
    .eq('is_trial', true)
    .eq('status', 'active')
    .lt('trial_end', now);

  if (fetchError) {
    console.error('Error fetching stale trials:', fetchError);
    process.exit(1);
  }

  console.log(`Found ${staleTrials?.length || 0} stale iOS trials\n`);

  if (!staleTrials || staleTrials.length === 0) {
    console.log('No stale trials to fix!');
    return;
  }

  // Get user emails for context
  const userIds = staleTrials.map(s => s.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, email')
    .in('id', userIds);

  const userMap = {};
  users?.forEach(u => { userMap[u.id] = u.email; });

  let fixed = 0;
  let errors = 0;

  for (const subscription of staleTrials) {
    const email = userMap[subscription.user_id] || 'unknown';
    const trialEndedAt = new Date(subscription.trial_end);
    const hoursAgo = Math.round((Date.now() - trialEndedAt) / (1000 * 60 * 60));

    console.log(`\nProcessing: ${email}`);
    console.log(`  User ID: ${subscription.user_id}`);
    console.log(`  Product: ${subscription.product_id}`);
    console.log(`  Trial ended: ${subscription.trial_end} (${hoursAgo} hours ago)`);

    if (isDryRun) {
      console.log('  [DRY RUN] Would fix this subscription');
      fixed++;
      continue;
    }

    try {
      // 1. Update subscription to mark trial as converted
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({
          is_trial: false,
          updated_at: now
        })
        .eq('id', subscription.id);

      if (updateError) throw updateError;

      // 2. Log trial_converted event
      const { error: eventError } = await supabase
        .from('subscription_events')
        .insert({
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          event_type: 'trial_converted',
          platform: 'ios',
          product_id: subscription.product_id,
          price_amount: subscription.price_amount,
          price_currency: subscription.price_currency,
          metadata: {
            source: 'fix_stale_trials_script',
            trial_end: subscription.trial_end,
            fixed_at: now
          },
          created_at: now
        });

      if (eventError) throw eventError;

      console.log('  ✅ Fixed successfully');
      fixed++;
    } catch (error) {
      console.error(`  ❌ Error fixing: ${error.message}`);
      errors++;
    }
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`Total stale trials found: ${staleTrials.length}`);
  console.log(`Successfully fixed: ${fixed}`);
  console.log(`Errors: ${errors}`);

  if (isDryRun) {
    console.log('\n⚠️  This was a dry run. Run without --dry-run to apply changes.');
  }

  console.log('\n========== DONE ==========\n');
}

fixStaleTrials().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
