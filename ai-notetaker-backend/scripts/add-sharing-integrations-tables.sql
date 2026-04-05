-- ============================================
-- Share Links Table
-- ============================================
CREATE TABLE IF NOT EXISTS shared_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  share_token VARCHAR(64) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  allow_comments BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shared_notes_token ON shared_notes(share_token) WHERE is_active = true;
CREATE INDEX idx_shared_notes_user ON shared_notes(user_id) WHERE is_active = true;
CREATE INDEX idx_shared_notes_note ON shared_notes(note_id);

-- ============================================
-- User Integrations Table (Google Drive, Notion, Slack)
-- ============================================
CREATE TABLE IF NOT EXISTS user_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL, -- 'google_drive', 'notion', 'slack'
  access_token TEXT,
  refresh_token TEXT,
  workspace_id VARCHAR(255),
  metadata JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_user_integrations_user ON user_integrations(user_id) WHERE is_active = true;

-- ============================================
-- User Webhooks Table (Zapier, custom)
-- ============================================
CREATE TABLE IF NOT EXISTS user_webhooks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  webhook_url TEXT NOT NULL,
  events TEXT[] DEFAULT ARRAY['note.created'],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_webhooks_user ON user_webhooks(user_id) WHERE is_active = true;

-- ============================================
-- Row Level Security
-- ============================================

-- shared_notes: users can manage their own shares
ALTER TABLE shared_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shares" ON shared_notes
  FOR ALL USING (auth.uid() = user_id);

-- Public read for shared notes via share_token (handled by service role in backend)

-- user_integrations: users can manage their own integrations
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own integrations" ON user_integrations
  FOR ALL USING (auth.uid() = user_id);

-- user_webhooks: users can manage their own webhooks
ALTER TABLE user_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own webhooks" ON user_webhooks
  FOR ALL USING (auth.uid() = user_id);
