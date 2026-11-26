-- Cost ledger and hard monthly cap of paid speech (src/services/pollySpeech.js). Only the backend's service role can read
-- or write it. Safe to run twice. Needed only before TTS_POLLY_ENABLED is switched on (without it Polly is never used).
-- Rollback: ...-ROLLBACK.sql
begin;
create table if not exists public.paid_speech_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,  -- kept without the account: the month's total must stay
  note_id uuid,
  provider text not null default 'polly',
  engine text not null,
  language text not null,
  characters integer not null,
  cost_usd numeric(12, 6) not null,
  status text not null default 'reserved' check (status in ('reserved', 'done', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists paid_speech_usage_created_idx on public.paid_speech_usage (created_at desc);
create index if not exists paid_speech_usage_user_idx on public.paid_speech_usage (user_id);
alter table public.paid_speech_usage enable row level security;
revoke all on public.paid_speech_usage from anon, authenticated;
revoke all on sequence public.paid_speech_usage_id_seq from anon, authenticated;
grant select, insert, update on public.paid_speech_usage to service_role;

-- Checks the month's total and takes the reservation in one step; the lock makes two machines queue.
-- 50 is the ceiling whatever the caller passes.
create or replace function public.reserve_paid_speech(
  p_user uuid, p_note uuid, p_engine text, p_language text, p_characters integer, p_cost numeric, p_cap numeric
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_month numeric;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('paid_speech_usage'));
  select coalesce(sum(cost_usd), 0) into v_month from paid_speech_usage
   where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  if p_cost < 0 or v_month + p_cost > least(p_cap, 50) then
    return jsonb_build_object('ok', false, 'month_usd', v_month);
  end if;
  insert into paid_speech_usage (user_id, note_id, engine, language, characters, cost_usd)
  values (p_user, p_note, p_engine, p_language, p_characters, p_cost) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'month_usd', v_month + p_cost);
end;
$$;
revoke all on function public.reserve_paid_speech(uuid, uuid, text, text, integer, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reserve_paid_speech(uuid, uuid, text, text, integer, numeric, numeric) to service_role;
commit;
