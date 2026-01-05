-- Meeting Bot Feature Database Schema
-- Creates tables for meeting bot functionality using Recall.ai

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Meetings table - stores user meeting requests
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  meeting_url TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('zoom', 'google_meet', 'teams', 'webex', 'other')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'bot_joining', 'in_progress', 'recording', 'processing', 'transcribing', 'completed', 'failed', 'cancelled')),
  scheduled_start TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  duration_seconds INTEGER,
  error_message TEXT,
  note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bot runs table - tracks individual bot deployments
CREATE TABLE IF NOT EXISTS bot_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE NOT NULL,
  recall_bot_id TEXT UNIQUE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'joining', 'in_call', 'recording', 'leaving', 'done', 'failed')),
  join_time TIMESTAMPTZ,
  leave_time TIMESTAMPTZ,
  recording_url TEXT,
  recording_path TEXT,
  transcript_raw TEXT,
  error_code TEXT,
  error_message TEXT,
  recall_status JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting recordings storage tracking
CREATE TABLE IF NOT EXISTS meeting_recordings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE NOT NULL,
  bot_run_id UUID REFERENCES bot_runs(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  storage_url TEXT,
  file_size_bytes BIGINT,
  duration_seconds INTEGER,
  format TEXT DEFAULT 'mp4',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'downloading', 'stored', 'transcribed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_note_id ON meetings(note_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_meeting_id ON bot_runs(meeting_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_recall_bot_id ON bot_runs(recall_bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_status ON bot_runs(status);
CREATE INDEX IF NOT EXISTS idx_meeting_recordings_meeting_id ON meeting_recordings(meeting_id);

-- Enable Row Level Security
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_recordings ENABLE ROW LEVEL SECURITY;

-- Meetings policies - users can only access their own meetings
CREATE POLICY "Users can view their own meetings"
    ON meetings FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own meetings"
    ON meetings FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meetings"
    ON meetings FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own meetings"
    ON meetings FOR DELETE USING (auth.uid() = user_id);

-- Service role can access all meetings (for webhooks)
CREATE POLICY "Service role can access all meetings"
    ON meetings FOR ALL USING (auth.role() = 'service_role');

-- Bot runs policies (accessible through meetings ownership)
CREATE POLICY "Users can view bot runs for their meetings"
    ON bot_runs FOR SELECT USING (
        EXISTS (SELECT 1 FROM meetings WHERE meetings.id = bot_runs.meeting_id AND meetings.user_id = auth.uid())
    );

CREATE POLICY "Service role can access all bot runs"
    ON bot_runs FOR ALL USING (auth.role() = 'service_role');

-- Meeting recordings policies
CREATE POLICY "Users can view recordings for their meetings"
    ON meeting_recordings FOR SELECT USING (
        EXISTS (SELECT 1 FROM meetings WHERE meetings.id = meeting_recordings.meeting_id AND meetings.user_id = auth.uid())
    );

CREATE POLICY "Service role can access all recordings"
    ON meeting_recordings FOR ALL USING (auth.role() = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_meeting_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_meetings_updated_at
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_meeting_updated_at();

CREATE TRIGGER update_bot_runs_updated_at
    BEFORE UPDATE ON bot_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_meeting_updated_at();

-- Verify tables were created
SELECT 'meetings' as table_name, COUNT(*) as row_count FROM meetings
UNION ALL
SELECT 'bot_runs' as table_name, COUNT(*) as row_count FROM bot_runs
UNION ALL
SELECT 'meeting_recordings' as table_name, COUNT(*) as row_count FROM meeting_recordings;
