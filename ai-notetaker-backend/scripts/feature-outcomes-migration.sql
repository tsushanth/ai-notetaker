-- Feature outcomes: one row per user request (src/middleware/featureOutcomes.js), and the view the hourly check reads
-- (src/services/featureHealth.js). Route patterns, status, timing and the account id only; no request content.
-- RLS is on with no policies and the view runs as its caller, so only the backend's service role can read either.
-- Safe to run twice. Apply BEFORE or after the deploy: without it the backend drops the rows and logs once an hour.
-- Re-running this file recreates the view: then run feature-health-exclude-test-accounts-2026-11-26.sql again.
create table if not exists public.feature_outcomes (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  feature text not null,          -- "POST /api/ai/summary", ids replaced by :id
  outcome text not null check (outcome in ('ok', 'pending', 'denied', 'limit', 'client_error', 'server_error', 'abandoned')),
  status integer,                 -- null when the caller left before an answer was sent
  duration_ms integer not null,
  client text,                    -- android | web | ios | other
  user_id uuid                    -- no foreign key: removed by the account deletion service
);
create index if not exists feature_outcomes_ts_idx on public.feature_outcomes (ts desc);
create index if not exists feature_outcomes_user_idx on public.feature_outcomes (user_id);
alter table public.feature_outcomes enable row level security;

-- The one query that covers every feature. An "attempt" is a request that should have succeeded.
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
revoke all on public.feature_outcomes, public.feature_health from anon, authenticated;
-- The identity column's sequence gets the project's default grants too.
revoke all on sequence public.feature_outcomes_id_seq from anon, authenticated;

-- Optional retention (run when wanted): delete from public.feature_outcomes where ts < now() - interval '90 days';
