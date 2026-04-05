-- ============================================
-- Learning Sessions: one per user per note
-- Tracks overall progress and current state
-- ============================================
CREATE TABLE IF NOT EXISTS learning_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,

  -- Current state
  status VARCHAR(20) DEFAULT 'active', -- active, paused, completed
  current_level INTEGER DEFAULT 1,     -- difficulty 1-10
  mastery_score REAL DEFAULT 0,        -- 0.0 to 1.0 overall mastery

  -- Concept tracking (JSON map of concept -> mastery score)
  concept_mastery JSONB DEFAULT '{}'::jsonb,

  -- Student profile (Claude's understanding of this learner)
  student_profile JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "learning_style": "visual", "strengths": [...], "struggles": [...], "engagement_notes": "..." }

  -- Progress stats
  total_lessons_completed INTEGER DEFAULT 0,
  total_correct INTEGER DEFAULT 0,
  total_attempted INTEGER DEFAULT 0,
  streak_count INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,

  -- Generation state
  generation_status VARCHAR(20) DEFAULT 'idle', -- idle, generating, ready, failed
  generation_started_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_learning_sessions_user ON learning_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_status ON learning_sessions(generation_status) WHERE generation_status = 'generating';

-- ============================================
-- Learning Lessons: each generated lesson/activity
-- ============================================
CREATE TABLE IF NOT EXISTS learning_lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- Lesson content
  lesson_number INTEGER NOT NULL,
  lesson_type VARCHAR(50) NOT NULL, -- quiz, game, visualization, mnemonic, song, story, recap, challenge
  title VARCHAR(500),

  -- The generated HTML/content to render
  content_html TEXT NOT NULL,

  -- Metadata about the lesson
  concepts_covered TEXT[] DEFAULT '{}',
  difficulty_level INTEGER DEFAULT 1,
  estimated_duration_seconds INTEGER DEFAULT 120,

  -- Instructions for the renderer (what inputs to expect)
  interaction_schema JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "type": "multiple_choice", "questions": 5 } or { "type": "drag_drop" } or { "type": "free_response" }

  -- User's performance on this lesson
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, skipped
  score REAL,           -- 0.0 to 1.0
  time_spent_seconds INTEGER,
  user_responses JSONB, -- raw responses from the user

  -- AI's assessment of performance
  ai_feedback TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_learning_lessons_session ON learning_lessons(session_id);
CREATE INDEX IF NOT EXISTS idx_learning_lessons_pending ON learning_lessons(session_id, status) WHERE status = 'pending';

-- ============================================
-- Learning Context: compressed context for Claude
-- Updated after each generation cycle
-- ============================================
CREATE TABLE IF NOT EXISTS learning_context (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,

  -- The note content (source material)
  source_content TEXT NOT NULL,

  -- Extracted curriculum (concepts to teach, generated on first session)
  curriculum JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "concepts": [...], "prerequisites": {...}, "teaching_order": [...] }

  -- Compressed history for Claude (updated after each cycle)
  -- This is what gets sent to the VM - a summary, not full history
  compressed_history TEXT,

  -- Last generation prompt used
  last_prompt TEXT,

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id)
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE learning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_context ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own learning sessions" ON learning_sessions FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can manage own learning lessons" ON learning_lessons FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can manage own learning context" ON learning_context FOR ALL USING (
    session_id IN (SELECT id FROM learning_sessions WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
