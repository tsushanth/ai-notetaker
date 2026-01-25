-- Cloned Voices Migration for ScribeAI TTS
-- Run this in Supabase SQL Editor

-- =====================================================
-- CLONED VOICES TABLE
-- Stores user-created voice clones for TTS
-- =====================================================
CREATE TABLE IF NOT EXISTS cloned_voices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Voice info
    name TEXT NOT NULL,
    description TEXT,

    -- Audio sample storage
    audio_url TEXT NOT NULL, -- URL to the original voice sample in Supabase Storage
    audio_bucket TEXT DEFAULT 'voice-samples',
    audio_path TEXT, -- Path within the bucket

    -- Voice metadata
    duration_seconds INTEGER, -- Duration of the voice sample
    sample_rate INTEGER DEFAULT 44100,

    -- Processing status
    status TEXT DEFAULT 'ready', -- ready, processing, failed
    error_message TEXT,

    -- Usage tracking
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_cloned_voices_user_id ON cloned_voices(user_id);
CREATE INDEX IF NOT EXISTS idx_cloned_voices_status ON cloned_voices(status);
CREATE INDEX IF NOT EXISTS idx_cloned_voices_created_at ON cloned_voices(created_at DESC);

-- =====================================================
-- RLS POLICIES
-- Users can only access their own cloned voices
-- =====================================================

-- Enable RLS
ALTER TABLE cloned_voices ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own voices
CREATE POLICY "Users can view own cloned voices"
    ON cloned_voices
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can create their own voices
CREATE POLICY "Users can create own cloned voices"
    ON cloned_voices
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own voices
CREATE POLICY "Users can update own cloned voices"
    ON cloned_voices
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own voices
CREATE POLICY "Users can delete own cloned voices"
    ON cloned_voices
    FOR DELETE
    USING (auth.uid() = user_id);

-- =====================================================
-- SERVICE ROLE ACCESS
-- Allow backend service to manage voices
-- =====================================================
CREATE POLICY "Service role full access to cloned voices"
    ON cloned_voices
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- FUNCTION: Update usage tracking
-- =====================================================
CREATE OR REPLACE FUNCTION update_cloned_voice_usage(voice_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE cloned_voices
    SET
        usage_count = usage_count + 1,
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = voice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STORAGE BUCKET FOR VOICE SAMPLES
-- Run these commands separately if needed
-- =====================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('voice-samples', 'voice-samples', false)
-- ON CONFLICT (id) DO NOTHING;

-- Storage policy for voice samples bucket
-- Users can upload their own voice samples
-- CREATE POLICY "Users can upload voice samples"
--     ON storage.objects
--     FOR INSERT
--     WITH CHECK (
--         bucket_id = 'voice-samples'
--         AND auth.uid()::text = (storage.foldername(name))[1]
--     );

-- Users can view their own voice samples
-- CREATE POLICY "Users can view own voice samples"
--     ON storage.objects
--     FOR SELECT
--     USING (
--         bucket_id = 'voice-samples'
--         AND auth.uid()::text = (storage.foldername(name))[1]
--     );

-- Users can delete their own voice samples
-- CREATE POLICY "Users can delete own voice samples"
--     ON storage.objects
--     FOR DELETE
--     USING (
--         bucket_id = 'voice-samples'
--         AND auth.uid()::text = (storage.foldername(name))[1]
--     );

-- =====================================================
-- TTS USAGE LOG (Optional - for analytics)
-- =====================================================
CREATE TABLE IF NOT EXISTS tts_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Request details
    voice_type TEXT NOT NULL, -- 'builtin' or 'cloned'
    voice_id TEXT, -- Voice identifier
    provider TEXT, -- 'listenai', 'openai'

    -- Text info
    text_length INTEGER NOT NULL,
    text_hash TEXT, -- SHA256 hash for deduplication

    -- Response info
    audio_duration_seconds NUMERIC(10, 2),
    audio_size_bytes INTEGER,

    -- Performance
    processing_time_ms INTEGER,

    -- Status
    success BOOLEAN DEFAULT true,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tts_usage_user ON tts_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_tts_usage_created ON tts_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tts_usage_provider ON tts_usage_log(provider);

-- Enable RLS on usage log
ALTER TABLE tts_usage_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view own TTS usage"
    ON tts_usage_log
    FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert usage logs
CREATE POLICY "Service role can insert TTS usage"
    ON tts_usage_log
    FOR INSERT
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');
