-- ScribeAI database hardening (2026-10-10). Applied in three stages, verifying after each. Undo with rls-hardening-ROLLBACK.sql.
--
-- Evidence before changing anything: pg_stat_statements since 2025-11 shows the `anon` and `authenticated` roles never queried any
-- object below; the backend reaches all of them with the service-role key, which bypasses RLS (src/config/supabase.js `supabaseAdmin`,
-- src/routes/analytics.js uses SUPABASE_SERVICE_KEY). The mobile and web clients only call /auth/v1 endpoints, never /rest/v1.
-- With the public anon key, before this change: users 4,235 rows, analytics_events 43,219, user_stats 4,999 (auth emails),
-- faculty_contacts 3,530 and more were readable, and get_user_id_by_email answered anyone.

-- ===== Stage A: the view and the SECURITY DEFINER functions that bypass RLS =====
-- user_stats joined auth.users (emails) and ran with its owner's rights, so it exposed them to anon even where RLS is on.
alter view public.user_stats set (security_invoker = true);
revoke all on public.user_stats from public, anon, authenticated;

-- Seven SECURITY DEFINER functions were callable through /rest/v1/rpc by anyone. The backend only calls get_user_id_by_email
-- (with the service role); the rest are unused or already broken.
revoke execute on function public.check_quota(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.get_content_stats(uuid) from public, anon, authenticated;
revoke execute on function public.get_user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.increment_usage(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.reset_monthly_usage() from public, anon, authenticated;
revoke execute on function public.search_transcripts(uuid, text) from public, anon, authenticated;
revoke execute on function public.update_cloned_voice_usage(uuid) from public, anon, authenticated;
grant execute on function public.check_quota(uuid, text, integer) to service_role;
grant execute on function public.get_content_stats(uuid) to service_role;
grant execute on function public.get_user_id_by_email(text) to service_role;
grant execute on function public.increment_usage(uuid, text, integer) to service_role;
grant execute on function public.reset_monthly_usage() to service_role;
grant execute on function public.search_transcripts(uuid, text) to service_role;
grant execute on function public.update_cloned_voice_usage(uuid) to service_role;

-- ===== Stage B: outreach and scraping tables, plus two empty ones (no policies: only the service role may touch them) =====
alter table public.universities enable row level security;
alter table public.faculty_contacts enable row level security;
alter table public.outreach_campaigns enable row level security;
alter table public.outreach_emails enable row level security;
alter table public.email_domains enable row level security;
alter table public.warmup_schedule enable row level security;
alter table public.outreach_daily_stats enable row level security;
alter table public.companies enable row level security;
alter table public.professional_contacts enable row level security;
alter table public.company_campaigns enable row level security;
alter table public.company_emails enable row level security;
alter table public.summaries enable row level security;
alter table public.transcripts enable row level security;

-- ===== Stage C: the tables that hold user data =====
alter table public.profiles enable row level security;
alter table public.analytics_events enable row level security;
alter table public.users enable row level security;
