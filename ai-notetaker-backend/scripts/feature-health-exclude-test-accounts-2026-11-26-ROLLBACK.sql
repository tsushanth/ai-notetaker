-- Reverses feature-health-exclude-test-accounts-2026-11-26.sql: the view counts every account again.
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
group by feature;
revoke all on public.feature_health from anon, authenticated;
drop function if exists public.monitoring_test_user_ids();
