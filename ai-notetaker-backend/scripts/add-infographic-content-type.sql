-- Migration: Verify ai_content table is ready for infographic content type
-- The infographic content type doesn't require a constraint update
-- This script just verifies the table structure

-- Verify the ai_content table exists and show its structure
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_content'
ORDER BY ordinal_position;

-- Show existing content types in use (for reference)
SELECT DISTINCT content_type, COUNT(*) as count
FROM ai_content
GROUP BY content_type
ORDER BY content_type;
