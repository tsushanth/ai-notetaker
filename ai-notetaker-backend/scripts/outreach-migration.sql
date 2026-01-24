-- University Outreach System Migration
-- Run this in Supabase SQL Editor

-- =====================================================
-- UNIVERSITIES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS universities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    website TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'US',
    type TEXT, -- public, private, community
    enrollment_size TEXT, -- small, medium, large
    ipeds_id TEXT, -- US Department of Education ID
    scraped_at TIMESTAMPTZ,
    scrape_status TEXT DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universities_domain ON universities(domain);
CREATE INDEX IF NOT EXISTS idx_universities_scrape_status ON universities(scrape_status);

-- =====================================================
-- FACULTY CONTACTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS faculty_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    university_id UUID REFERENCES universities(id) ON DELETE CASCADE,

    -- Contact info
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,

    -- Role info
    title TEXT, -- Professor, Associate Professor, Lecturer, TA, etc.
    department TEXT,
    profile_url TEXT,

    -- Metadata
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    source_url TEXT,

    -- Outreach status
    outreach_status TEXT DEFAULT 'pending', -- pending, contacted, replied, converted, unsubscribed, bounced
    last_contacted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_faculty_email ON faculty_contacts(email);
CREATE INDEX IF NOT EXISTS idx_faculty_university ON faculty_contacts(university_id);
CREATE INDEX IF NOT EXISTS idx_faculty_outreach_status ON faculty_contacts(outreach_status);
CREATE INDEX IF NOT EXISTS idx_faculty_department ON faculty_contacts(department);

-- =====================================================
-- OUTREACH CAMPAIGNS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS outreach_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,

    -- Email content
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL, -- HTML with {{placeholders}}

    -- Targeting
    target_departments TEXT[], -- NULL = all departments
    target_titles TEXT[], -- NULL = all titles
    target_universities UUID[], -- NULL = all universities

    -- Status
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    -- Stats
    total_contacts INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,

    -- Scheduling
    daily_limit INTEGER DEFAULT 500,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- OUTREACH EMAILS TABLE (individual sends)
-- =====================================================
CREATE TABLE IF NOT EXISTS outreach_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES faculty_contacts(id) ON DELETE CASCADE,

    -- Email details
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    body_html TEXT,

    -- SES tracking
    ses_message_id TEXT,

    -- Sequence (1 = initial, 2 = follow-up 1, etc.)
    sequence_number INTEGER DEFAULT 1,

    -- Status tracking
    status TEXT DEFAULT 'queued', -- queued, sent, delivered, opened, clicked, replied, bounced, complained
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    bounced_at TIMESTAMPTZ,
    bounce_type TEXT,

    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_emails_campaign ON outreach_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_outreach_emails_contact ON outreach_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_emails_status ON outreach_emails(status);
CREATE INDEX IF NOT EXISTS idx_outreach_emails_ses_id ON outreach_emails(ses_message_id);
CREATE INDEX IF NOT EXISTS idx_outreach_emails_sent_at ON outreach_emails(sent_at);

-- =====================================================
-- EMAIL DOMAINS TABLE (for warmup tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL UNIQUE,

    -- SES verification
    ses_verified BOOLEAN DEFAULT FALSE,
    ses_verified_at TIMESTAMPTZ,

    -- DNS status
    spf_configured BOOLEAN DEFAULT FALSE,
    dkim_configured BOOLEAN DEFAULT FALSE,
    dmarc_configured BOOLEAN DEFAULT FALSE,

    -- Warmup tracking
    warmup_started_at TIMESTAMPTZ,
    warmup_completed_at TIMESTAMPTZ,
    warmup_day INTEGER DEFAULT 0,

    -- Limits and reputation
    daily_limit INTEGER DEFAULT 50,
    sent_today INTEGER DEFAULT 0,
    sent_total INTEGER DEFAULT 0,
    bounce_rate DECIMAL(5,2) DEFAULT 0,
    complaint_rate DECIMAL(5,2) DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'pending', -- pending, warming, active, suspended

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WARMUP SCHEDULE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS warmup_schedule (
    day INTEGER PRIMARY KEY,
    daily_target INTEGER NOT NULL,
    description TEXT
);

-- Insert default warmup schedule (1 week aggressive)
INSERT INTO warmup_schedule (day, daily_target, description) VALUES
    (1, 50, 'Day 1: Start slow'),
    (2, 100, 'Day 2: Double'),
    (3, 150, 'Day 3: Increase'),
    (4, 250, 'Day 4: Ramp up'),
    (5, 400, 'Day 5: Building momentum'),
    (6, 600, 'Day 6: Nearing capacity'),
    (7, 800, 'Day 7: Full warmup complete')
ON CONFLICT (day) DO NOTHING;

-- =====================================================
-- DAILY STATS TABLE (for monitoring)
-- =====================================================
CREATE TABLE IF NOT EXISTS outreach_daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain TEXT NOT NULL,
    date DATE NOT NULL,

    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,
    complained_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,

    bounce_rate DECIMAL(5,2),
    complaint_rate DECIMAL(5,2),
    open_rate DECIMAL(5,2),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(domain, date)
);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to reset daily send counts at midnight
CREATE OR REPLACE FUNCTION reset_daily_send_counts()
RETURNS void AS $$
BEGIN
    UPDATE email_domains SET sent_today = 0;
END;
$$ LANGUAGE plpgsql;

-- Function to update campaign stats
CREATE OR REPLACE FUNCTION update_campaign_stats(p_campaign_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE outreach_campaigns SET
        sent_count = (SELECT COUNT(*) FROM outreach_emails WHERE campaign_id = p_campaign_id AND status != 'queued'),
        opened_count = (SELECT COUNT(*) FROM outreach_emails WHERE campaign_id = p_campaign_id AND opened_at IS NOT NULL),
        replied_count = (SELECT COUNT(*) FROM outreach_emails WHERE campaign_id = p_campaign_id AND replied_at IS NOT NULL),
        bounced_count = (SELECT COUNT(*) FROM outreach_emails WHERE campaign_id = p_campaign_id AND status = 'bounced'),
        updated_at = NOW()
    WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ENABLE RLS (if needed)
-- =====================================================
-- ALTER TABLE universities ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE faculty_contacts ENABLE ROW LEVEL SECURITY;
-- etc.

-- =====================================================
-- SEED TOP 100 US UNIVERSITIES
-- =====================================================
INSERT INTO universities (name, domain, city, state, type, enrollment_size) VALUES
    ('Harvard University', 'harvard.edu', 'Cambridge', 'MA', 'private', 'large'),
    ('Stanford University', 'stanford.edu', 'Stanford', 'CA', 'private', 'large'),
    ('Massachusetts Institute of Technology', 'mit.edu', 'Cambridge', 'MA', 'private', 'large'),
    ('University of California, Berkeley', 'berkeley.edu', 'Berkeley', 'CA', 'public', 'large'),
    ('Yale University', 'yale.edu', 'New Haven', 'CT', 'private', 'large'),
    ('Princeton University', 'princeton.edu', 'Princeton', 'NJ', 'private', 'medium'),
    ('Columbia University', 'columbia.edu', 'New York', 'NY', 'private', 'large'),
    ('University of Chicago', 'uchicago.edu', 'Chicago', 'IL', 'private', 'large'),
    ('University of Pennsylvania', 'upenn.edu', 'Philadelphia', 'PA', 'private', 'large'),
    ('California Institute of Technology', 'caltech.edu', 'Pasadena', 'CA', 'private', 'small'),
    ('Duke University', 'duke.edu', 'Durham', 'NC', 'private', 'large'),
    ('Northwestern University', 'northwestern.edu', 'Evanston', 'IL', 'private', 'large'),
    ('Johns Hopkins University', 'jhu.edu', 'Baltimore', 'MD', 'private', 'large'),
    ('Cornell University', 'cornell.edu', 'Ithaca', 'NY', 'private', 'large'),
    ('University of Michigan', 'umich.edu', 'Ann Arbor', 'MI', 'public', 'large'),
    ('University of California, Los Angeles', 'ucla.edu', 'Los Angeles', 'CA', 'public', 'large'),
    ('Carnegie Mellon University', 'cmu.edu', 'Pittsburgh', 'PA', 'private', 'large'),
    ('New York University', 'nyu.edu', 'New York', 'NY', 'private', 'large'),
    ('University of Southern California', 'usc.edu', 'Los Angeles', 'CA', 'private', 'large'),
    ('Brown University', 'brown.edu', 'Providence', 'RI', 'private', 'medium'),
    ('Rice University', 'rice.edu', 'Houston', 'TX', 'private', 'medium'),
    ('Vanderbilt University', 'vanderbilt.edu', 'Nashville', 'TN', 'private', 'large'),
    ('University of Notre Dame', 'nd.edu', 'Notre Dame', 'IN', 'private', 'large'),
    ('Washington University in St. Louis', 'wustl.edu', 'St. Louis', 'MO', 'private', 'large'),
    ('Georgetown University', 'georgetown.edu', 'Washington', 'DC', 'private', 'large'),
    ('University of Virginia', 'virginia.edu', 'Charlottesville', 'VA', 'public', 'large'),
    ('University of North Carolina at Chapel Hill', 'unc.edu', 'Chapel Hill', 'NC', 'public', 'large'),
    ('University of Texas at Austin', 'utexas.edu', 'Austin', 'TX', 'public', 'large'),
    ('University of Wisconsin-Madison', 'wisc.edu', 'Madison', 'WI', 'public', 'large'),
    ('University of Illinois Urbana-Champaign', 'illinois.edu', 'Urbana', 'IL', 'public', 'large'),
    ('Georgia Institute of Technology', 'gatech.edu', 'Atlanta', 'GA', 'public', 'large'),
    ('University of Washington', 'uw.edu', 'Seattle', 'WA', 'public', 'large'),
    ('Boston University', 'bu.edu', 'Boston', 'MA', 'private', 'large'),
    ('University of Florida', 'ufl.edu', 'Gainesville', 'FL', 'public', 'large'),
    ('Ohio State University', 'osu.edu', 'Columbus', 'OH', 'public', 'large'),
    ('Penn State University', 'psu.edu', 'University Park', 'PA', 'public', 'large'),
    ('University of Maryland', 'umd.edu', 'College Park', 'MD', 'public', 'large'),
    ('Purdue University', 'purdue.edu', 'West Lafayette', 'IN', 'public', 'large'),
    ('University of Minnesota', 'umn.edu', 'Minneapolis', 'MN', 'public', 'large'),
    ('University of Colorado Boulder', 'colorado.edu', 'Boulder', 'CO', 'public', 'large'),
    ('Indiana University', 'indiana.edu', 'Bloomington', 'IN', 'public', 'large'),
    ('University of Arizona', 'arizona.edu', 'Tucson', 'AZ', 'public', 'large'),
    ('Arizona State University', 'asu.edu', 'Tempe', 'AZ', 'public', 'large'),
    ('Michigan State University', 'msu.edu', 'East Lansing', 'MI', 'public', 'large'),
    ('University of Pittsburgh', 'pitt.edu', 'Pittsburgh', 'PA', 'public', 'large'),
    ('Rutgers University', 'rutgers.edu', 'New Brunswick', 'NJ', 'public', 'large'),
    ('University of Iowa', 'uiowa.edu', 'Iowa City', 'IA', 'public', 'large'),
    ('Boston College', 'bc.edu', 'Chestnut Hill', 'MA', 'private', 'large'),
    ('Northeastern University', 'northeastern.edu', 'Boston', 'MA', 'private', 'large'),
    ('Tufts University', 'tufts.edu', 'Medford', 'MA', 'private', 'medium')
ON CONFLICT (domain) DO NOTHING;

-- Grant permissions if using service role
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
