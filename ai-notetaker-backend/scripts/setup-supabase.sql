-- AI Notetaker Database Schema Setup
-- Run this in your Supabase SQL Editor
-- 
-- ⚠️ WARNING: This script will DROP and recreate all tables!
-- ⚠️ All existing data in these tables will be DELETED!
-- ⚠️ Use with caution in production environments!
-- ⚠️ Make sure to backup your data before running this script!
--
-- Tables affected: notes, recordings, ai_content, usage_logs
-- This script will also recreate all indexes, triggers, policies, and views
--

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables (in correct order due to foreign key constraints)
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS ai_content CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
DROP TABLE IF EXISTS notes CASCADE;

-- Create notes table
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT CHECK (source_type IN ('recording', 'pdf', 'video', 'slideshow', 'manual')),
  source_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create recordings table
CREATE TABLE recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  duration INTEGER,
  transcription TEXT,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create AI generated content table
CREATE TABLE ai_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID REFERENCES notes(id) ON DELETE CASCADE NOT NULL,
  content_type TEXT CHECK (content_type IN ('summary', 'quiz', 'flashcards', 'podcast', 'diagram')) NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create usage logs table for tracking API usage
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  cost_usd DECIMAL(10, 6) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_notes_user_id;
DROP INDEX IF EXISTS idx_notes_created_at;
DROP INDEX IF EXISTS idx_recordings_user_id;
DROP INDEX IF EXISTS idx_recordings_note_id;
DROP INDEX IF EXISTS idx_ai_content_note_id;
DROP INDEX IF EXISTS idx_usage_logs_user_id;
DROP INDEX IF EXISTS idx_usage_logs_created_at;

-- Create indexes for better query performance
CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);
CREATE INDEX idx_recordings_user_id ON recordings(user_id);
CREATE INDEX idx_recordings_note_id ON recordings(note_id);
CREATE INDEX idx_ai_content_note_id ON ai_content(note_id);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
DROP TRIGGER IF EXISTS update_notes_updated_at ON notes;
CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_recordings_updated_at ON recordings;
CREATE TRIGGER update_recordings_updated_at
    BEFORE UPDATE ON recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert their own notes" ON notes;
DROP POLICY IF EXISTS "Users can update their own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete their own notes" ON notes;

DROP POLICY IF EXISTS "Users can view their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can insert their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can update their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;

DROP POLICY IF EXISTS "Users can view AI content for their notes" ON ai_content;
DROP POLICY IF EXISTS "Users can insert AI content for their notes" ON ai_content;
DROP POLICY IF EXISTS "Users can delete AI content for their notes" ON ai_content;

DROP POLICY IF EXISTS "Users can view their own usage logs" ON usage_logs;
DROP POLICY IF EXISTS "Users can insert their own usage logs" ON usage_logs;

-- RLS Policies for notes table
CREATE POLICY "Users can view their own notes"
    ON notes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notes"
    ON notes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
    ON notes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
    ON notes FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for recordings table
CREATE POLICY "Users can view their own recordings"
    ON recordings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recordings"
    ON recordings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recordings"
    ON recordings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recordings"
    ON recordings FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for ai_content table
CREATE POLICY "Users can view AI content for their notes"
    ON ai_content FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM notes
            WHERE notes.id = ai_content.note_id
            AND notes.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert AI content for their notes"
    ON ai_content FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM notes
            WHERE notes.id = ai_content.note_id
            AND notes.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete AI content for their notes"
    ON ai_content FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM notes
            WHERE notes.id = ai_content.note_id
            AND notes.user_id = auth.uid()
        )
    );

-- RLS Policies for usage_logs table
CREATE POLICY "Users can view their own usage logs"
    ON usage_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own usage logs"
    ON usage_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Drop and recreate view for user statistics
DROP VIEW IF EXISTS user_stats;

CREATE VIEW user_stats AS
SELECT
    u.id as user_id,
    u.email,
    COUNT(DISTINCT n.id) as total_notes,
    COUNT(DISTINCT r.id) as total_recordings,
    COUNT(DISTINCT ac.id) as total_ai_content,
    SUM(ul.tokens_used) as total_tokens_used,
    SUM(ul.cost_usd) as total_cost_usd
FROM auth.users u
LEFT JOIN notes n ON u.id = n.user_id
LEFT JOIN recordings r ON u.id = r.user_id
LEFT JOIN ai_content ac ON n.id = ac.note_id
LEFT JOIN usage_logs ul ON u.id = ul.user_id
GROUP BY u.id, u.email;

-- Grant access to the view
GRANT SELECT ON user_stats TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Database schema setup completed successfully!';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Create storage bucket "notetaker-files" in Supabase Dashboard';
    RAISE NOTICE '2. Configure storage policies';
    RAISE NOTICE '3. Update your .env file with Supabase credentials';
END $$;
