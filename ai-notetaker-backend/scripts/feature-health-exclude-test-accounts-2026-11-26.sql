-- Feature health leaves our own test accounts out, so a test run cannot raise a "feature failing" alert by itself.
-- Apply after scripts/feature-outcomes-migration.sql (and again if that file is ever re-run, because it recreates the view).
-- Safe to run twice. Reverse: scripts/feature-health-exclude-test-accounts-2026-11-26-ROLLBACK.sql.
--
-- {{OWNER_EMAIL_REGEX}} is deliberately not stored in this repository. Replace it before running with the owner filter
-- the outcome checks use (OWNER_EMAIL_REGEX in the failure reporter, worker/checks/lib.mjs). It names our own accounts;
-- do not add patterns that could match other people.

-- The view runs as its caller and the backend's service role cannot read auth.users, so one definer function returns
-- only the ids. The client roles (anon, authenticated) may not call it.
create or replace function public.monitoring_test_user_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $fn$ select id from auth.users where coalesce(email, '') ~* '{{OWNER_EMAIL_REGEX}}' $fn$;
revoke all on function public.monitoring_test_user_ids() from public, anon, authenticated;
grant execute on function public.monitoring_test_user_ids() to service_role;
-- The dashboard's read-only SQL role (it can already read every table) keeps being able to read the view.
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    grant execute on function public.monitoring_test_user_ids() to supabase_read_only_user;
  end if;
end $do$;

create or replace view public.feature_health with (security_invoker = true) as
select feature,
       count(*) filter (where ts > now() - interval '24 hours') as attempts_24h,
       count(*) filter (where ts > now() - interval '24 hours' and outcome = 'ok') as ok_24h,
       count(*) as attempts_7d,
       count(*) filter (where outcome = 'ok') as ok_7d,
       count(*) filter (where outcome = 'abandoned') as abandoned_7d,
       percentile_cont(0.95) within group (order by duration_ms)::int as p95_ms_7d,
       max(ts) filter (where outcome = 'ok') as last_ok
from public.feature_outcomes
where ts > now() - interval '7 days'
  and outcome in ('ok', 'client_error', 'server_error', 'abandoned')
  and (user_id is null or user_id not in (select public.monitoring_test_user_ids()))
group by feature;
revoke all on public.feature_health from anon, authenticated;
