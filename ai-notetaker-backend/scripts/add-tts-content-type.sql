-- Migration: Remove constraint and clean up duplicates for unique index

-- Step 1: Drop the existing check constraint entirely
ALTER TABLE ai_content DROP CONSTRAINT IF EXISTS ai_content_content_type_check;

-- Step 2: Remove duplicates, keeping only the most recent entry for each (note_id, content_type)
DELETE FROM ai_content a
USING ai_content b
WHERE a.note_id = b.note_id
  AND a.content_type = b.content_type
  AND a.created_at < b.created_at;

-- Step 3: Create unique index for upsert to work
CREATE UNIQUE INDEX IF NOT EXISTS ai_content_note_type_unique
ON ai_content (note_id, content_type);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully cleaned duplicates and created unique index!';
END $$;
