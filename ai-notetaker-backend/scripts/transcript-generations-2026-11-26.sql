-- Ledger of generated YouTube transcripts (src/services/transcriptGeneration.js): the per-user daily limit, the monthly
-- credit cap and the cost record. Only the backend's service role can read or write it. Safe to run twice.
-- Apply BEFORE the deploy: without it the backend generates nothing. Rollback: ...-ROLLBACK.sql
begin;
create table if not exists public.transcript_generations (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,  -- kept without the account: the month's total must stay
  video_id text not null,
  duration_seconds integer not null,
  credits integer not null,       -- counted against the monthly cap: the estimate, or 1 when the vendor refused the request
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'released')),
  job_id text,
  note_id uuid,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transcript_generations_user_idx on public.transcript_generations (user_id, created_at desc);
create index if not exists transcript_generations_created_idx on public.transcript_generations (created_at desc);
alter table public.transcript_generations enable row level security;
revoke all on public.transcript_generations from anon, authenticated;
revoke all on sequence public.transcript_generations_id_seq from anon, authenticated;
grant select, insert, update on public.transcript_generations to service_role;

-- Checks both limits and takes the reservation in one step; the lock makes two machines queue.
create or replace function public.reserve_transcript_generation(
  p_user uuid, p_video text, p_duration integer, p_credits integer, p_user_daily integer, p_monthly_cap integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
  v_oldest timestamptz;
  v_month integer;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('transcript_generations'));

  if exists (select 1 from transcript_generations
             where user_id = p_user and video_id = p_video and status = 'pending' and created_at > now() - interval '70 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'pending');
  end if;

  select count(*), min(created_at) into v_count, v_oldest from transcript_generations
   where user_id = p_user and status <> 'released' and created_at > now() - interval '24 hours';
  if v_count >= p_user_daily then
    return jsonb_build_object('ok', false, 'reason', 'user_daily', 'retry_at', v_oldest + interval '24 hours');
  end if;

  select coalesce(sum(credits), 0) into v_month from transcript_generations
   where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  if v_month + p_credits > p_monthly_cap then
    return jsonb_build_object('ok', false, 'reason', 'monthly', 'month_credits', v_month);
  end if;

  insert into transcript_generations (user_id, video_id, duration_seconds, credits)
  values (p_user, p_video, p_duration, p_credits) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'month_credits', v_month + p_credits);
end;
$$;
revoke all on function public.reserve_transcript_generation(uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_transcript_generation(uuid, text, integer, integer, integer, integer) to service_role;
commit;
