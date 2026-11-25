-- ScribeAI: close open row-level-security and storage policies (2026-11-25). Undo: rls-close-open-policies-2026-11-25-ROLLBACK.sql.
-- The backend reaches every object below with the service-role key, which bypasses RLS. The apps and the website call only
-- /auth/v1 (uploads go through signed upload URLs, which need no policy). pg_stat_statements showed no write by the anon or
-- authenticated roles to any public table, and no storage read by them, before this change.
set local lock_timeout = '5s';

-- 1. Server-only tables whose policies were `true` for every role despite their "service role" names.
drop policy if exists "Service role full access to activity_config" on public.creator_activity_config;
drop policy if exists "Service role full access to clawback_events" on public.creator_clawback_events;
drop policy if exists "Service role full access to commission_caps" on public.creator_commission_caps;
drop policy if exists "Service role full access to content_submissions" on public.creator_content_submissions;
drop policy if exists "Service role full access to creator_earnings" on public.creator_earnings;
drop policy if exists "Service role full access to fraud_anomaly_config" on public.creator_fraud_anomaly_config;
drop policy if exists "Service role full access to fraud_flags" on public.creator_fraud_flags;
drop policy if exists "Service role full access to fraud_scans" on public.creator_fraud_scans;
drop policy if exists "Service role full access to fraud_signals" on public.creator_fraud_signals;
drop policy if exists "Service role full access to monthly_commissions" on public.creator_monthly_commissions;
drop policy if exists "Service role full access to creator_payouts" on public.creator_payouts;
drop policy if exists "Service role full access to creator_usage" on public.creator_usage;
drop policy if exists "Service role full access to creator_usage_limits" on public.creator_usage_limits;
drop policy if exists "Service role full access to creators" on public.creators;
drop policy if exists "Service role can manage device_trials" on public.device_trials;
drop policy if exists "Service role full access to promo_codes" on public.promo_codes;
drop policy if exists "Service role full access to promo_redemptions" on public.promo_redemptions;
drop policy if exists "Service role full access to trial_abuse_clusters" on public.trial_abuse_clusters;
drop policy if exists "Service role full access to trial_abuse_config" on public.trial_abuse_config;
drop policy if exists "Service role full access to trial_fingerprints" on public.trial_fingerprints;
drop policy if exists "Anyone can insert participants" on public.challenge_participants;
drop policy if exists "Anyone can view participants" on public.challenge_participants;
revoke all on table
  public.creator_activity_config,
  public.creator_clawback_events,
  public.creator_commission_caps,
  public.creator_content_submissions,
  public.creator_earnings,
  public.creator_fraud_anomaly_config,
  public.creator_fraud_flags,
  public.creator_fraud_scans,
  public.creator_fraud_signals,
  public.creator_monthly_commissions,
  public.creator_payouts,
  public.creator_usage,
  public.creator_usage_limits,
  public.creators,
  public.device_trials,
  public.promo_codes,
  public.promo_redemptions,
  public.trial_abuse_clusters,
  public.trial_abuse_config,
  public.trial_fingerprints,
  public.challenge_participants
  from anon, authenticated;

-- 2. notes: any signed-in user could insert a note for any other user. The owner-scoped policies stay.
drop policy if exists "Enable insert for authenticated users and service role" on public.notes;

-- 3. Rows whose columns the server trusts (stored file path, shared note id, call recording ids, phone verification state).
--    No client writes them. Owner reads stay, except verified_phones, which also exposed the verification code.
revoke insert, update, delete, truncate, references, trigger on table
  public.recordings, public.shared_notes, public.phone_calls
  from anon, authenticated;
revoke all on table public.verified_phones from anon, authenticated;

-- 4. Storage: anyone could upload into any bucket and list every file. Public-bucket download URLs and signed upload URLs
--    do not use these policies; the service role bypasses them.
drop policy if exists "Enable insert for authenticated users only" on storage.objects;
drop policy if exists "Allow signed URL uploads" on storage.objects;
drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Enable read access for all users" on storage.objects;
drop policy if exists "Allow public reads" on storage.objects;
drop policy if exists "Public audio access" on storage.objects;
drop policy if exists "Authenticated users can read audio" on storage.objects;
drop policy if exists "Authenticated users can read" on storage.objects;
