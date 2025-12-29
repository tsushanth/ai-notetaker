-- Migration: Add formatted_content field to notes table
-- This field stores AI-formatted version of raw notes for better display
-- Safe to run multiple times (idempotent)

-- Add formatted_content column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'formatted_content'
    ) THEN
        ALTER TABLE notes ADD COLUMN formatted_content TEXT;
        RAISE NOTICE 'Column formatted_content added to notes table';
    ELSE
        RAISE NOTICE 'Column formatted_content already exists';
    END IF;
END $$;

-- Add formatting_status column to track formatting state
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notes' AND column_name = 'formatting_status'
    ) THEN
        ALTER TABLE notes ADD COLUMN formatting_status TEXT DEFAULT 'pending'
            CHECK (formatting_status IN ('pending', 'processing', 'completed', 'failed'));
        RAISE NOTICE 'Column formatting_status added to notes table';
    ELSE
        RAISE NOTICE 'Column formatting_status already exists';
    END IF;
END $$;

-- Create index on formatting_status for efficient migration queries
CREATE INDEX IF NOT EXISTS idx_notes_formatting_status ON notes(formatting_status);

-- Show current status
SELECT
    COUNT(*) as total_notes,
    COUNT(formatted_content) as formatted_notes,
    COUNT(*) - COUNT(formatted_content) as unformatted_notes
FROM notes;
