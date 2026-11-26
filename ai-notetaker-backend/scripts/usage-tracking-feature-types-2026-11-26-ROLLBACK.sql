-- Puts the previous check back. NOT VALID: rows of the newer types written in between are kept (nothing is deleted),
-- only new ones are refused again.
begin;
alter table public.usage_tracking drop constraint if exists usage_tracking_feature_type_check;
alter table public.usage_tracking add constraint usage_tracking_feature_type_check check (feature_type in (
  'note_created', 'summary', 'quiz', 'flashcards', 'podcast', 'chat', 'diagram'
)) not valid;
commit;
