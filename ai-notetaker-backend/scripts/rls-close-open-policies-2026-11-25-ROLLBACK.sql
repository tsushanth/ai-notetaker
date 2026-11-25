-- Reverse of rls-close-open-policies-2026-11-25.sql. Restores the exact grants and policies recorded before the change.
-- WARNING: this reopens write access to anyone holding the public app key. Prefer restoring only the single object that is needed.

grant all on table
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
  public.challenge_participants,
  public.verified_phones
  to anon, authenticated;
create policy "Service role full access to activity_config" on public.creator_activity_config as permissive for all to public using (true) with check (true);
create policy "Service role full access to clawback_events" on public.creator_clawback_events as permissive for all to public using (true) with check (true);
create policy "Service role full access to commission_caps" on public.creator_commission_caps as permissive for all to public using (true) with check (true);
create policy "Service role full access to content_submissions" on public.creator_content_submissions as permissive for all to public using (true) with check (true);
create policy "Service role full access to creator_earnings" on public.creator_earnings as permissive for all to public using (true) with check (true);
create policy "Service role full access to fraud_anomaly_config" on public.creator_fraud_anomaly_config as permissive for all to public using (true) with check (true);
create policy "Service role full access to fraud_flags" on public.creator_fraud_flags as permissive for all to public using (true) with check (true);
create policy "Service role full access to fraud_scans" on public.creator_fraud_scans as permissive for all to public using (true) with check (true);
create policy "Service role full access to fraud_signals" on public.creator_fraud_signals as permissive for all to public using (true) with check (true);
create policy "Service role full access to monthly_commissions" on public.creator_monthly_commissions as permissive for all to public using (true) with check (true);
create policy "Service role full access to creator_payouts" on public.creator_payouts as permissive for all to public using (true) with check (true);
create policy "Service role full access to creator_usage" on public.creator_usage as permissive for all to public using (true) with check (true);
create policy "Service role full access to creator_usage_limits" on public.creator_usage_limits as permissive for all to public using (true) with check (true);
create policy "Service role full access to creators" on public.creators as permissive for all to public using (true) with check (true);
create policy "Service role can manage device_trials" on public.device_trials as permissive for all to public using (true) with check (true);
create policy "Service role full access to promo_codes" on public.promo_codes as permissive for all to public using (true) with check (true);
create policy "Service role full access to promo_redemptions" on public.promo_redemptions as permissive for all to public using (true) with check (true);
create policy "Service role full access to trial_abuse_clusters" on public.trial_abuse_clusters as permissive for all to public using (true) with check (true);
create policy "Service role full access to trial_abuse_config" on public.trial_abuse_config as permissive for all to public using (true) with check (true);
create policy "Service role full access to trial_fingerprints" on public.trial_fingerprints as permissive for all to public using (true) with check (true);
create policy "Anyone can insert participants" on public.challenge_participants as permissive for insert to public with check (true);
create policy "Anyone can view participants" on public.challenge_participants as permissive for select to public using (true);

create policy "Enable insert for authenticated users and service role" on public.notes as permissive for insert to authenticated, service_role with check (true);

grant insert, update, delete, truncate, references, trigger on table
  public.recordings, public.shared_notes, public.phone_calls
  to anon, authenticated;

create policy "Enable insert for authenticated users only" on storage.objects as permissive for insert to anon, authenticated, service_role with check (true);
create policy "Allow signed URL uploads" on storage.objects as permissive for insert to anon, authenticated with check (bucket_id = 'documents'::text);
create policy "Authenticated users can upload" on storage.objects as permissive for insert to authenticated with check (bucket_id = 'uploads'::text);
create policy "Enable read access for all users" on storage.objects as permissive for select to public using (true);
create policy "Allow public reads" on storage.objects as permissive for select to anon, authenticated using (bucket_id = 'documents'::text);
create policy "Public audio access" on storage.objects as permissive for select to public using (bucket_id = 'audio'::text);
create policy "Authenticated users can read audio" on storage.objects as permissive for select to authenticated using (bucket_id = 'audio'::text);
create policy "Authenticated users can read" on storage.objects as permissive for select to authenticated using (bucket_id = 'uploads'::text);
