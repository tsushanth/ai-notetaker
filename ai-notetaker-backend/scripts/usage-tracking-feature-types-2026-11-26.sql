-- usage_tracking refused every feature_type added after the table was created (upload, tts, learning, create, compete,
-- formatting, suggestions, infographic, mindmap), so those daily limits were never saved and the global AI budget guard
-- counted nothing for Learn, Create, Compete and infographics. This widens the check; no row is read or changed.
-- The list must match USAGE_FEATURE_TYPES in src/utils/freeTierPolicy.js. Safe to run twice.
-- Rollback: usage-tracking-feature-types-2026-11-26-ROLLBACK.sql
begin;
alter table public.usage_tracking drop constraint if exists usage_tracking_feature_type_check;
alter table public.usage_tracking add constraint usage_tracking_feature_type_check check (feature_type in (
  'note_created', 'summary', 'quiz', 'flashcards', 'podcast', 'chat', 'diagram',
  'mindmap', 'infographic', 'learning', 'create', 'compete', 'suggestions', 'formatting', 'upload', 'tts'
));
commit;
