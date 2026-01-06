-- Migration: Add 'mindmap' to ai_content content_type check constraint
-- Run this in your Supabase SQL Editor
--
-- This script updates the check constraint on the ai_content table
-- to allow 'mindmap' as a valid content_type value.

-- Step 1: Drop the existing check constraint
ALTER TABLE ai_content DROP CONSTRAINT IF EXISTS ai_content_content_type_check;

-- Step 2: Add the updated check constraint with 'mindmap' included
ALTER TABLE ai_content ADD CONSTRAINT ai_content_content_type_check
  CHECK (content_type IN ('summary', 'quiz', 'flashcards', 'podcast', 'diagram', 'mindmap'));

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully added mindmap to ai_content content_type constraint!';
END $$;
