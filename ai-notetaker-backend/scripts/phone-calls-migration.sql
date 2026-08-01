-- Phone Calls + Verification Tables for ScribeAI
-- Ported from Meeting Mind's 007_phone_calls.sql.
-- Supabase project: shufmkocfnjnlwshqrue
--
-- Run this once via the Supabase SQL editor (or `psql` against the
-- direct connection string). It's idempotent — IF NOT EXISTS / IF EXISTS
-- guards make re-running safe.

-- ============================================================================
-- verified_phones — user-verified phone numbers
-- ============================================================================

CREATE TABLE IF NOT EXISTS verified_phones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    verification_code VARCHAR(6),
    verification_expires_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_verified_phones_user_id ON verified_phones(user_id);
CREATE INDEX IF NOT EXISTS idx_verified_phones_phone_number ON verified_phones(phone_number);

-- ============================================================================
-- phone_calls — call records + recording metadata
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE phone_call_status AS ENUM (
        'initiated', 'ringing', 'in_progress', 'recording',
        'completed', 'failed', 'busy', 'no_answer', 'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS phone_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    to_name VARCHAR(100),

    twilio_call_sid VARCHAR(50),
    conference_sid VARCHAR(50),
    conference_name VARCHAR(100),
    recording_sid VARCHAR(50),

    status phone_call_status DEFAULT 'initiated',
    is_recording BOOLEAN DEFAULT FALSE,

    recording_url TEXT,
    recording_duration INTEGER, -- seconds

    -- NOTE: MM ties recording_id to its `recordings` table. We omit that
    -- foreign key in ScribeAI's port to keep the migration self-contained;
    -- wire it back in when we integrate phone-call recordings into the
    -- existing transcription pipeline.
    recording_id UUID,

    started_at TIMESTAMPTZ,
    answered_at TIMESTAMPTZ,
    recording_started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_user_id ON phone_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_phone_calls_twilio_sid ON phone_calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_phone_calls_conference ON phone_calls(conference_name);
CREATE INDEX IF NOT EXISTS idx_phone_calls_status ON phone_calls(status)
    WHERE status IN ('initiated', 'ringing', 'in_progress', 'recording');

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE verified_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verified_phones_user_policy ON verified_phones;
CREATE POLICY verified_phones_user_policy ON verified_phones
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS phone_calls_user_policy ON phone_calls;
CREATE POLICY phone_calls_user_policy ON phone_calls
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Updated-at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_verified_phones_updated_at ON verified_phones;
CREATE TRIGGER update_verified_phones_updated_at
    BEFORE UPDATE ON verified_phones
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_phone_calls_updated_at ON phone_calls;
CREATE TRIGGER update_phone_calls_updated_at
    BEFORE UPDATE ON phone_calls
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
