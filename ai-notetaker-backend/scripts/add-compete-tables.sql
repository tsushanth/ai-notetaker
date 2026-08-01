-- ============================================
-- Challenges: generated quiz/game from notes
-- ============================================
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_user_id UUID NOT NULL,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  challenge_type VARCHAR(50) NOT NULL, -- quiz, speed_round, memory_game, word_scramble, true_false
  content_html TEXT NOT NULL,
  share_token VARCHAR(32) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  total_questions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_token ON challenges(share_token) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_challenges_creator ON challenges(creator_user_id);

-- ============================================
-- Challenge participants + scores
-- ============================================
CREATE TABLE IF NOT EXISTS challenge_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID, -- null for anonymous participants
  display_name VARCHAR(100) NOT NULL,
  score REAL NOT NULL DEFAULT 0, -- 0.0 to 1.0
  correct_answers INTEGER DEFAULT 0,
  total_questions INTEGER DEFAULT 0,
  time_spent_seconds INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX IF NOT EXISTS idx_participants_score ON challenge_participants(challenge_id, score DESC);

-- RLS
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage own challenges" ON challenges FOR ALL USING (auth.uid() = creator_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Participants are public (anyone with share link can submit)
DO $$ BEGIN
  CREATE POLICY "Anyone can view participants" ON challenge_participants FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can insert participants" ON challenge_participants FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
