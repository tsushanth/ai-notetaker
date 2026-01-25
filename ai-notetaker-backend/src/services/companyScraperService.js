/**
 * Company Website Scraper Service
 * Scrapes company websites for professional contacts (B2B outreach for Meeting Mind)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const Bottleneck = require('bottleneck');

class CompanyScraperService {
  constructor() {
    // Rate limiter: 1 request per 2 seconds
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 2000,
    });

    // Pages to look for contacts
    this.contactPages = [
      '/about',
      '/about-us',
      '/about/team',
      '/about/leadership',
      '/team',
      '/our-team',
      '/leadership',
      '/people',
      '/company',
      '/company/team',
      '/company/about',
      '/company/leadership',
      '/who-we-are',
      '/meet-the-team',
      '/contact',
      '/contact-us',
    ];

    // Job titles that indicate good B2B targets
    this.targetTitles = [
      // Sales
      'sales', 'account executive', 'account manager', 'business development',
      'sales manager', 'sales director', 'vp sales', 'head of sales',
      // Leadership
      'ceo', 'coo', 'cfo', 'cto', 'cmo', 'chief', 'president', 'founder',
      'managing director', 'partner', 'principal',
      // Operations
      'operations', 'ops', 'general manager',
      // Consulting
      'consultant', 'senior consultant', 'managing consultant', 'director',
      // Real estate
      'broker', 'agent', 'realtor',
      // Recruiting
      'recruiter', 'talent', 'hr manager', 'hr director',
      // Legal
      'attorney', 'lawyer', 'paralegal', 'partner',
      // Finance
      'advisor', 'analyst', 'portfolio manager',
    ];

    // Seniority keywords
    this.seniorityMap = {
      executive: ['ceo', 'coo', 'cfo', 'cto', 'cmo', 'chief', 'president', 'founder', 'co-founder', 'owner'],
      director: ['director', 'vp', 'vice president', 'head of', 'managing director', 'partner', 'principal'],
      senior: ['senior', 'sr', 'lead', 'manager'],
      mid: ['associate', 'specialist', 'coordinator'],
      entry: ['junior', 'jr', 'assistant', 'intern'],
    };

    // Department keywords
    this.departmentMap = {
      sales: ['sales', 'account', 'business development', 'revenue'],
      marketing: ['marketing', 'brand', 'content', 'social media', 'growth'],
      operations: ['operations', 'ops', 'logistics', 'supply chain'],
      hr: ['hr', 'human resources', 'talent', 'recruiting', 'people'],
      finance: ['finance', 'accounting', 'controller', 'treasury'],
      legal: ['legal', 'attorney', 'lawyer', 'counsel', 'paralegal'],
      engineering: ['engineer', 'developer', 'tech', 'software', 'it'],
      executive: ['ceo', 'coo', 'cfo', 'cto', 'chief', 'president', 'founder'],
    };

    // Common email patterns
    this.emailPatterns = [
      '{first}.{last}@{domain}',
      '{first}{last}@{domain}',
      '{f}{last}@{domain}',
      '{first}_{last}@{domain}',
      '{last}.{first}@{domain}',
      '{first}@{domain}',
      '{f}.{last}@{domain}',
    ];

    // Headers to mimic browser
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };
  }

  /**
   * Scrape a single company
   */
  async scrapeCompany(companyId) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (!company) {
      throw new Error('Company not found');
    }

    logger.info('Starting scrape for company', { name: company.name, domain: company.domain });

    // Update status to in-progress
    await supabaseAdmin
      .from('companies')
      .update({ scrape_status: 'in_progress' })
      .eq('id', companyId);

    const results = {
      company: company.name,
      contactsFound: 0,
      emailsFound: 0,
      pagesScraped: 0,
      errors: [],
    };

    try {
      // Find contact pages
      const contactPages = await this.findContactPages(company.domain);
      results.pagesScraped = contactPages.length;

      // Scrape each contact page
      for (const pageUrl of contactPages) {
        try {
          const contacts = await this.scrapeContactPage(pageUrl, company);

          for (const contact of contacts) {
            const saved = await this.saveContact(contact, companyId);
            if (saved) {
              results.contactsFound++;
              if (contact.email) results.emailsFound++;
            }
          }
        } catch (error) {
          results.errors.push({ url: pageUrl, error: error.message });
        }
      }

      // Update status to completed
      await supabaseAdmin
        .from('companies')
        .update({
          scrape_status: 'completed',
          scraped_at: new Date().toISOString(),
          pages_found: contactPages.length,
        })
        .eq('id', companyId);

    } catch (error) {
      logger.error('Error scraping company', { company: company.name, error: error.message });

      await supabaseAdmin
        .from('companies')
        .update({ scrape_status: 'failed' })
        .eq('id', companyId);

      results.errors.push({ error: error.message });
    }

    logger.info('Scrape completed', results);
    return results;
  }

  /**
   * Find contact/team pages for a company domain
   */
  async findContactPages(domain) {
    const pages = [];
    const baseUrls = [
      `https://www.${domain}`,
      `https://${domain}`,
    ];

    for (const baseUrl of baseUrls) {
      for (const path of this.contactPages) {
        const url = `${baseUrl}${path}`;
        const exists = await this.checkPageExists(url);
        if (exists) {
          pages.push(url);
          if (pages.length >= 10) break; // Limit pages per company
        }
      }
      if (pages.length >= 10) break;
    }

    logger.info('Found contact pages', { domain, count: pages.length });
    return pages;
  }

  /**
   * Check if a page exists
   */
  async checkPageExists(url) {
    try {
      const response = await this.limiter.schedule(() =>
        axios.head(url, {
          headers: this.headers,
          timeout: 5000,
          maxRedirects: 3,
          validateStatus: (status) => status < 400,
        })
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Scrape a contact/team page
   */
  async scrapeContactPage(url, company) {
    const contacts = [];

    try {
      const response = await this.limiter.schedule(() =>
        axios.get(url, {
          headers: this.headers,
          timeout: 15000,
          maxRedirects: 5,
        })
      );

      const $ = cheerio.load(response.data);

      // Try multiple selectors for team/contact listings
      const selectors = [
        '.team-member',
        '.staff-member',
        '.team-card',
        '.person',
        '.profile',
        '.bio',
        '.leadership-member',
        '.employee',
        '.team-item',
        '.member',
        '.people-item',
        'article.team',
        '.about-team li',
        '.team-grid > div',
        '.team-list > div',
        '.leadership-grid > div',
        '[class*="team"] [class*="card"]',
        '[class*="team"] [class*="member"]',
      ];

      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const contact = this.extractContactFromElement($, element, company.domain);
          if (contact && contact.name) {
            contact.source_url = url;
            contacts.push(contact);
          }
        });

        if (contacts.length > 0) break; // Found contacts, stop trying selectors
      }

      // If no structured data found, try to extract from text
      if (contacts.length === 0) {
        const pageContacts = this.extractContactsFromText(response.data, company.domain);
        contacts.push(...pageContacts);
      }

      logger.info('Scraped contact page', { url, contactsFound: contacts.length });

    } catch (error) {
      logger.warn('Error scraping contact page', { url, error: error.message });
    }

    return contacts;
  }

  /**
   * Extract contact info from a DOM element
   */
  extractContactFromElement($, element, domain) {
    const $el = $(element);

    // Try to find name
    let name = null;
    const nameSelectors = ['h2', 'h3', 'h4', '.name', '.person-name', '.member-name', 'strong', 'a.name'];
    for (const sel of nameSelectors) {
      const found = $el.find(sel).first().text().trim();
      if (found && found.length > 2 && found.length < 100 && !found.includes('@')) {
        name = this.cleanName(found);
        break;
      }
    }

    if (!name) {
      // Try the element itself
      const text = $el.text().trim().split('\n')[0];
      if (text && text.length > 2 && text.length < 100) {
        name = this.cleanName(text);
      }
    }

    // Try to find email
    let email = null;
    const emailMatch = $el.html()?.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      email = emailMatch[0].toLowerCase();
    }

    // Try mailto links
    if (!email) {
      const mailto = $el.find('a[href^="mailto:"]').attr('href');
      if (mailto) {
        email = mailto.replace('mailto:', '').split('?')[0].toLowerCase();
      }
    }

    // Try to find title/position
    let title = null;
    const titleSelectors = ['.title', '.position', '.job-title', '.role', '.member-title', '.person-title'];
    for (const sel of titleSelectors) {
      const found = $el.find(sel).text().trim();
      if (found && found.length > 2 && found.length < 200) {
        title = found;
        break;
      }
    }

    // Try to find LinkedIn
    let linkedinUrl = null;
    const linkedinLink = $el.find('a[href*="linkedin.com"]').attr('href');
    if (linkedinLink) {
      linkedinUrl = linkedinLink;
    }

    // Try to find profile URL
    let profileUrl = $el.find('a').first().attr('href');
    if (profileUrl && !profileUrl.startsWith('http') && !profileUrl.startsWith('mailto')) {
      profileUrl = profileUrl.startsWith('/')
        ? `https://${domain}${profileUrl}`
        : `https://${domain}/${profileUrl}`;
    }

    // Validate - must have name
    if (!name || name.length < 3) return null;

    // Filter out non-person names
    if (this.isNotPersonName(name)) return null;

    // Determine seniority and department from title
    const seniority = title ? this.determineSeniority(title) : null;
    const department = title ? this.determineDepartment(title) : null;

    // Check if this is a target title
    const isTargetTitle = title ? this.isTargetTitle(title) : false;

    // If no email found, generate candidates
    const emailCandidates = !email ? this.generateEmailCandidates(name, domain) : [];

    return {
      name,
      email,
      email_candidates: emailCandidates,
      title: this.cleanTitle(title),
      seniority,
      department,
      linkedin_url: linkedinUrl,
      profile_url: profileUrl,
      is_target: isTargetTitle,
    };
  }

  /**
   * Extract contacts from raw page text (fallback)
   */
  extractContactsFromText(html, domain) {
    const contacts = [];
    const $ = cheerio.load(html);

    // Find all emails on the page
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const text = $('body').text();
    const emails = [...new Set(text.match(emailRegex) || [])];

    // Filter to only company domain emails
    const validEmails = emails.filter(email =>
      email.toLowerCase().endsWith(domain) ||
      email.toLowerCase().endsWith(domain.replace('www.', ''))
    );

    for (const email of validEmails.slice(0, 20)) { // Limit
      // Skip generic emails
      if (this.isGenericEmail(email)) continue;

      // Try to find name near email
      const name = this.findNameNearEmail(html, email);

      contacts.push({
        name: name || this.emailToName(email),
        email: email.toLowerCase(),
        email_candidates: [],
        title: null,
        seniority: null,
        department: null,
        linkedin_url: null,
        profile_url: null,
        is_target: true, // Unknown, assume target
      });
    }

    return contacts;
  }

  /**
   * Check if email is generic (info@, support@, etc.)
   */
  isGenericEmail(email) {
    const genericPrefixes = [
      'info', 'support', 'contact', 'hello', 'help', 'sales', 'admin',
      'office', 'team', 'hr', 'jobs', 'careers', 'press', 'media',
      'marketing', 'legal', 'billing', 'finance', 'noreply', 'no-reply',
    ];
    const prefix = email.split('@')[0].toLowerCase();
    return genericPrefixes.includes(prefix);
  }

  /**
   * Check if name is likely not a person
   */
  isNotPersonName(name) {
    const nonPersonIndicators = [
      'team', 'company', 'office', 'department', 'support', 'contact',
      'inc', 'llc', 'corp', 'consulting', 'services', 'group', 'partners',
    ];
    const lowerName = name.toLowerCase();
    return nonPersonIndicators.some(indicator => lowerName.includes(indicator));
  }

  /**
   * Find name near an email in HTML
   */
  findNameNearEmail(html, email) {
    const emailIndex = html.indexOf(email);
    if (emailIndex === -1) return null;

    // Get surrounding context
    const start = Math.max(0, emailIndex - 200);
    const end = Math.min(html.length, emailIndex + 50);
    const context = html.substring(start, end);

    // Try to find a name (capitalized words)
    const nameMatch = context.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
    if (nameMatch) {
      return nameMatch[1];
    }

    return null;
  }

  /**
   * Convert email to probable name
   */
  emailToName(email) {
    const localPart = email.split('@')[0];

    let name = localPart
      .replace(/[._]/g, ' ')
      .replace(/(\d+)/g, '')
      .trim();

    // Capitalize
    name = name.split(' ')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

    return name;
  }

  /**
   * Generate email candidates from name
   */
  generateEmailCandidates(name, domain) {
    const parts = name.toLowerCase().split(' ').filter(p => p.length > 0);
    if (parts.length < 2) return [];

    const first = parts[0].replace(/[^a-z]/g, '');
    const last = parts[parts.length - 1].replace(/[^a-z]/g, '');
    const f = first[0];

    // Remove www. from domain if present
    const cleanDomain = domain.replace(/^www\./, '');

    return [
      `${first}.${last}@${cleanDomain}`,
      `${first}${last}@${cleanDomain}`,
      `${f}${last}@${cleanDomain}`,
      `${first}_${last}@${cleanDomain}`,
      `${first}@${cleanDomain}`,
      `${f}.${last}@${cleanDomain}`,
    ];
  }

  /**
   * Determine seniority from title
   */
  determineSeniority(title) {
    const lowerTitle = title.toLowerCase();

    for (const [level, keywords] of Object.entries(this.seniorityMap)) {
      if (keywords.some(kw => lowerTitle.includes(kw))) {
        return level;
      }
    }

    return 'mid'; // Default
  }

  /**
   * Determine department from title
   */
  determineDepartment(title) {
    const lowerTitle = title.toLowerCase();

    for (const [dept, keywords] of Object.entries(this.departmentMap)) {
      if (keywords.some(kw => lowerTitle.includes(kw))) {
        return dept;
      }
    }

    return null;
  }

  /**
   * Check if title is a target title
   */
  isTargetTitle(title) {
    const lowerTitle = title.toLowerCase();
    return this.targetTitles.some(target => lowerTitle.includes(target));
  }

  /**
   * Clean up name string
   */
  cleanName(name) {
    if (!name) return null;

    return name
      .replace(/\s+/g, ' ')
      .replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s*/i, '')
      .replace(/,.*$/, '') // Remove everything after comma
      .replace(/\(.*\)/, '') // Remove parenthetical
      .trim()
      .substring(0, 100);
  }

  /**
   * Clean up title string
   */
  cleanTitle(title) {
    if (!title) return null;

    return title
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }

  /**
   * Save contact to database
   */
  async saveContact(contact, companyId) {
    if (!contact.name) return false;

    // If no email and no candidates, skip
    if (!contact.email && (!contact.email_candidates || contact.email_candidates.length === 0)) {
      return false;
    }

    const email = contact.email || contact.email_candidates[0];

    try {
      await supabaseAdmin
        .from('professional_contacts')
        .upsert({
          company_id: companyId,
          name: contact.name,
          email: email,
          email_verified: !!contact.email,
          title: contact.title,
          seniority: contact.seniority,
          department: contact.department,
          linkedin_url: contact.linkedin_url,
          profile_url: contact.profile_url,
          source_url: contact.source_url,
          source: 'website',
          target_app: 'meetingmind',
          scraped_at: new Date().toISOString(),
        }, { onConflict: 'email' });

      return true;

    } catch (error) {
      if (!error.message.includes('duplicate')) {
        logger.error('Error saving contact', { email, error: error.message });
      }
      return false;
    }
  }

  /**
   * Scrape all pending companies
   */
  async scrapeAllPending(limit = 10) {
    const { data: companies } = await supabaseAdmin
      .from('companies')
      .select('id, name, domain')
      .eq('scrape_status', 'pending')
      .limit(limit);

    if (!companies || companies.length === 0) {
      logger.info('No pending companies to scrape');
      return { scraped: 0 };
    }

    const results = {
      scraped: 0,
      totalContacts: 0,
      errors: [],
    };

    if (!companies || companies.length === 0) {
      logger.info('No pending companies to scrape');
      return results;
    }

    for (const company of companies) {
      console.log(`\n[${ results.scraped + 1}/${companies.length}] Scraping: ${company.name} (${company.domain})`);

      try {
        const result = await this.scrapeCompany(company.id);
        results.scraped++;
        results.totalContacts += result.contactsFound;

        console.log(`  Found ${result.contactsFound} contacts, ${result.emailsFound} emails`);
      } catch (error) {
        results.errors.push({ company: company.name, error: error.message });
        console.log(`  Error: ${error.message}`);
      }

      // Pause between companies
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    logger.info('Batch scrape completed', results);
    return results;
  }

  /**
   * Add company manually
   */
  async addCompany({ name, domain, industry, companySize, source = 'manual' }) {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');

    const { data: company, error } = await supabaseAdmin
      .from('companies')
      .insert({
        name,
        domain: cleanDomain,
        website: `https://${cleanDomain}`,
        industry,
        company_size: companySize,
        source,
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return company;
  }

  /**
   * Get scraping stats
   */
  async getStats() {
    const { data: companies } = await supabaseAdmin
      .from('companies')
      .select('scrape_status');

    const { count: contactCount } = await supabaseAdmin
      .from('professional_contacts')
      .select('id', { count: 'exact' });

    const { count: verifiedCount } = await supabaseAdmin
      .from('professional_contacts')
      .select('id', { count: 'exact' })
      .eq('email_verified', true);

    const statusCounts = {
      pending: 0,
      completed: 0,
      failed: 0,
      in_progress: 0,
    };

    for (const c of companies || []) {
      statusCounts[c.scrape_status] = (statusCounts[c.scrape_status] || 0) + 1;
    }

    return {
      companies: {
        total: companies?.length || 0,
        ...statusCounts,
      },
      contacts: {
        total: contactCount || 0,
        verified: verifiedCount || 0,
      },
    };
  }
}

module.exports = new CompanyScraperService();
