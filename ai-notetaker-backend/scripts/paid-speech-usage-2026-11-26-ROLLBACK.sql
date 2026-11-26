-- Removes the paid speech ledger (and with it the cost record). Without it Polly is never used.
begin;
drop function if exists public.reserve_paid_speech(uuid, uuid, text, text, integer, numeric, numeric);
drop table if exists public.paid_speech_usage;
commit;
