-- Company Outreach System Migration (Meeting Mind B2B)
-- Run this in Supabase SQL Editor

-- =====================================================
-- COMPANIES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    website TEXT,

    -- Company info
    industry TEXT,
    company_size TEXT, -- small (1-50), medium (51-200), large (201-1000), enterprise (1000+)
    description TEXT,
    location TEXT,
    linkedin_url TEXT,

    -- Scrape tracking
    scraped_at TIMESTAMPTZ,
    scrape_status TEXT DEFAULT 'pending', -- pending, in_progress, completed, failed
    pages_found INTEGER DEFAULT 0,

    -- Source info
    source TEXT, -- manual, linkedin, crunchbase, google, etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);
CREATE INDEX IF NOT EXISTS idx_companies_scrape_status ON companies(scrape_status);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

-- =====================================================
-- PROFESSIONAL CONTACTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS professional_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,

    -- Contact info
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at TIMESTAMPTZ,

    -- Role info
    title TEXT, -- CEO, Sales Manager, Consultant, etc.
    department TEXT, -- Sales, Marketing, Operations, HR, etc.
    seniority TEXT, -- entry, mid, senior, director, executive
    linkedin_url TEXT,
    profile_url TEXT,

    -- Metadata
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    source_url TEXT,
    source TEXT, -- website, linkedin, hunter, etc.

    -- Outreach status
    outreach_status TEXT DEFAULT 'pending', -- pending, contacted, replied, converted, unsubscribed, bounced
    last_contacted_at TIMESTAMPTZ,

    -- App targeting
    target_app TEXT DEFAULT 'meetingmind', -- meetingmind, securevox, readaloud

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_professional_email ON professional_contacts(email);
CREATE INDEX IF NOT EXISTS idx_professional_company ON professional_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_professional_outreach_status ON professional_contacts(outreach_status);
CREATE INDEX IF NOT EXISTS idx_professional_department ON professional_contacts(department);
CREATE INDEX IF NOT EXISTS idx_professional_seniority ON professional_contacts(seniority);
CREATE INDEX IF NOT EXISTS idx_professional_target_app ON professional_contacts(target_app);

-- =====================================================
-- COMPANY OUTREACH CAMPAIGNS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS company_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,

    -- Target app
    target_app TEXT NOT NULL, -- meetingmind, securevox, readaloud

    -- Email content
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL, -- HTML with {{placeholders}}

    -- Targeting
    target_industries TEXT[], -- NULL = all industries
    target_titles TEXT[], -- NULL = all titles
    target_departments TEXT[], -- NULL = all departments
    target_seniority TEXT[], -- NULL = all levels
    target_company_sizes TEXT[], -- NULL = all sizes

    -- Status
    status TEXT DEFAULT 'draft', -- draft, active, paused, completed

    -- Stats
    total_contacts INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,

    -- Scheduling
    daily_limit INTEGER DEFAULT 100,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COMPANY OUTREACH EMAILS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS company_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES company_campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES professional_contacts(id) ON DELETE CASCADE,

    -- Email details
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    body_html TEXT,

    -- Tracking
    message_id TEXT, -- SendGrid/SES message ID

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

CREATE INDEX IF NOT EXISTS idx_company_emails_campaign ON company_emails(campaign_id);
CREATE INDEX IF NOT EXISTS idx_company_emails_contact ON company_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_company_emails_status ON company_emails(status);
CREATE INDEX IF NOT EXISTS idx_company_emails_message_id ON company_emails(message_id);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update company campaign stats
CREATE OR REPLACE FUNCTION update_company_campaign_stats(p_campaign_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE company_campaigns SET
        sent_count = (SELECT COUNT(*) FROM company_emails WHERE campaign_id = p_campaign_id AND status != 'queued'),
        opened_count = (SELECT COUNT(*) FROM company_emails WHERE campaign_id = p_campaign_id AND opened_at IS NOT NULL),
        replied_count = (SELECT COUNT(*) FROM company_emails WHERE campaign_id = p_campaign_id AND replied_at IS NOT NULL),
        bounced_count = (SELECT COUNT(*) FROM company_emails WHERE campaign_id = p_campaign_id AND status = 'bounced'),
        updated_at = NOW()
    WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SEED SAMPLE COMPANIES (B2B targets for Meeting Mind)
-- =====================================================
-- These are types of companies that would benefit from meeting transcription

INSERT INTO companies (name, domain, industry, company_size, source) VALUES
    -- Consulting firms
    ('McKinsey & Company', 'mckinsey.com', 'consulting', 'enterprise', 'manual'),
    ('Boston Consulting Group', 'bcg.com', 'consulting', 'enterprise', 'manual'),
    ('Bain & Company', 'bain.com', 'consulting', 'enterprise', 'manual'),
    ('Deloitte', 'deloitte.com', 'consulting', 'enterprise', 'manual'),
    ('Accenture', 'accenture.com', 'consulting', 'enterprise', 'manual'),
    ('KPMG', 'kpmg.com', 'consulting', 'enterprise', 'manual'),
    ('PwC', 'pwc.com', 'consulting', 'enterprise', 'manual'),
    ('EY', 'ey.com', 'consulting', 'enterprise', 'manual'),

    -- Sales teams / SaaS companies
    ('Salesforce', 'salesforce.com', 'technology', 'enterprise', 'manual'),
    ('HubSpot', 'hubspot.com', 'technology', 'large', 'manual'),
    ('Zendesk', 'zendesk.com', 'technology', 'large', 'manual'),
    ('Intercom', 'intercom.com', 'technology', 'medium', 'manual'),
    ('Drift', 'drift.com', 'technology', 'medium', 'manual'),
    ('Gong', 'gong.io', 'technology', 'medium', 'manual'),
    ('Chorus', 'chorus.ai', 'technology', 'medium', 'manual'),

    -- Law firms
    ('Kirkland & Ellis', 'kirkland.com', 'legal', 'enterprise', 'manual'),
    ('Latham & Watkins', 'lw.com', 'legal', 'enterprise', 'manual'),
    ('DLA Piper', 'dlapiper.com', 'legal', 'enterprise', 'manual'),
    ('Baker McKenzie', 'bakermckenzie.com', 'legal', 'enterprise', 'manual'),
    ('Skadden', 'skadden.com', 'legal', 'enterprise', 'manual'),

    -- Real estate companies
    ('CBRE', 'cbre.com', 'real_estate', 'enterprise', 'manual'),
    ('JLL', 'jll.com', 'real_estate', 'enterprise', 'manual'),
    ('Cushman & Wakefield', 'cushmanwakefield.com', 'real_estate', 'enterprise', 'manual'),
    ('Keller Williams', 'kw.com', 'real_estate', 'enterprise', 'manual'),
    ('RE/MAX', 'remax.com', 'real_estate', 'enterprise', 'manual'),

    -- Recruiting / HR firms
    ('Robert Half', 'roberthalf.com', 'recruiting', 'enterprise', 'manual'),
    ('Kforce', 'kforce.com', 'recruiting', 'large', 'manual'),
    ('TEKsystems', 'teksystems.com', 'recruiting', 'large', 'manual'),
    ('ManpowerGroup', 'manpowergroup.com', 'recruiting', 'enterprise', 'manual'),
    ('Randstad', 'randstad.com', 'recruiting', 'enterprise', 'manual'),

    -- Insurance companies
    ('State Farm', 'statefarm.com', 'insurance', 'enterprise', 'manual'),
    ('Allstate', 'allstate.com', 'insurance', 'enterprise', 'manual'),
    ('Progressive', 'progressive.com', 'insurance', 'enterprise', 'manual'),
    ('Liberty Mutual', 'libertymutual.com', 'insurance', 'enterprise', 'manual'),
    ('Farmers Insurance', 'farmers.com', 'insurance', 'enterprise', 'manual'),

    -- Financial services
    ('Morgan Stanley', 'morganstanley.com', 'finance', 'enterprise', 'manual'),
    ('Goldman Sachs', 'goldmansachs.com', 'finance', 'enterprise', 'manual'),
    ('JP Morgan', 'jpmorgan.com', 'finance', 'enterprise', 'manual'),
    ('BlackRock', 'blackrock.com', 'finance', 'enterprise', 'manual'),
    ('Fidelity', 'fidelity.com', 'finance', 'enterprise', 'manual'),

    -- Marketing agencies
    ('WPP', 'wpp.com', 'marketing', 'enterprise', 'manual'),
    ('Omnicom', 'omnicomgroup.com', 'marketing', 'enterprise', 'manual'),
    ('Publicis', 'publicisgroupe.com', 'marketing', 'enterprise', 'manual'),
    ('Dentsu', 'dentsu.com', 'marketing', 'enterprise', 'manual'),
    ('IPG', 'interpublic.com', 'marketing', 'enterprise', 'manual'),

    -- Startups (YC companies, etc.)
    ('Stripe', 'stripe.com', 'technology', 'large', 'manual'),
    ('Notion', 'notion.so', 'technology', 'medium', 'manual'),
    ('Figma', 'figma.com', 'technology', 'medium', 'manual'),
    ('Airtable', 'airtable.com', 'technology', 'medium', 'manual'),
    ('Linear', 'linear.app', 'technology', 'small', 'manual')
ON CONFLICT (domain) DO NOTHING;
