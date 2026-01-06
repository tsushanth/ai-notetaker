-- Remove the source_type CHECK constraint entirely
-- This allows the application to control valid source types
-- without requiring database migrations for new types
--
-- Run this in Supabase SQL Editor

-- Drop the existing constraint (no replacement needed)
-- The application layer (validation.js) will handle validation
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_type_check;

-- Verify the constraint was removed
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'notes'::regclass AND contype = 'c';
-- Should return empty or only show other constraints (not source_type)
