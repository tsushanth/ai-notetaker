-- Removes the generation ledger (and with it the cost record). Without it the backend generates no transcript.
begin;
drop function if exists public.reserve_transcript_generation(uuid, text, integer, integer, integer, integer);
drop table if exists public.transcript_generations;
commit;
