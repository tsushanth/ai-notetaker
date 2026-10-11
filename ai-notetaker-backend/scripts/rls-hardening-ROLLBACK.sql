-- Exact inverse of rls-hardening.sql. Run any part to undo that stage immediately; nothing here loses data.
-- Stage C
alter table public.users disable row level security;
alter table public.analytics_events disable row level security;
alter table public.profiles disable row level security;
-- Stage B
alter table public.transcripts disable row level security;
alter table public.summaries disable row level security;
alter table public.company_emails disable row level security;
alter table public.company_campaigns disable row level security;
alter table public.professional_contacts disable row level security;
alter table public.companies disable row level security;
alter table public.outreach_daily_stats disable row level security;
alter table public.warmup_schedule disable row level security;
alter table public.email_domains disable row level security;
alter table public.outreach_emails disable row level security;
alter table public.outreach_campaigns disable row level security;
alter table public.faculty_contacts disable row level security;
alter table public.universities disable row level security;
-- Stage A (restores the original open grants)
grant execute on function public.check_quota(uuid, text, integer) to public, anon, authenticated;
grant execute on function public.get_content_stats(uuid) to public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text, integer) to public, anon, authenticated;
grant execute on function public.reset_monthly_usage() to public, anon, authenticated;
grant execute on function public.search_transcripts(uuid, text) to public, anon, authenticated;
grant execute on function public.update_cloned_voice_usage(uuid) to public, anon, authenticated;
grant select on public.user_stats to anon, authenticated;
alter view public.user_stats reset (security_invoker);
