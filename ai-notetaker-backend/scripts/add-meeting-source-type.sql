-- Add 'meeting' to the allowed source_type values in notes table
-- This is required for the meeting bot feature to create notes from meeting transcripts

-- First, check what source_type values currently exist
-- SELECT DISTINCT source_type FROM notes;

-- Fix any NULL or invalid source_type values (set to 'manual' as default)
UPDATE notes
SET source_type = 'manual'
WHERE source_type IS NULL
   OR source_type NOT IN ('recording', 'pdf', 'video', 'slideshow', 'manual', 'meeting');

-- Drop the existing constraint
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_source_type_check;

-- Add the updated constraint with 'meeting' included
ALTER TABLE notes ADD CONSTRAINT notes_source_type_check
  CHECK (source_type IN ('recording', 'pdf', 'video', 'slideshow', 'manual', 'meeting'));

-- Verify the constraint was updated
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'notes'::regclass AND contype = 'c';
