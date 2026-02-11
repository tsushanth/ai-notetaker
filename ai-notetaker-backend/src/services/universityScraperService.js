/**
 * University Faculty Scraper Service
 * Scrapes faculty directories from US universities
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const Bottleneck = require('bottleneck');

class UniversityScraperService {
  constructor() {
    // Rate limiter: 1 request per second per domain
    this.limiter = new Bottleneck({
      maxConcurrent: 2,
      minTime: 1000,
    });

    // Common faculty page URL patterns
    this.facultyPatterns = [
      '/people',
      '/faculty',
      '/directory',
      '/about/faculty',
      '/about/people',
      '/faculty-staff',
      '/our-faculty',
      '/team',
    ];

    // Common department paths
    this.departmentPaths = [
      'cs', 'computerscience', 'computer-science',
      'engineering', 'cse', 'ece', 'eecs',
      'math', 'mathematics',
      'physics',
      'biology', 'bio',
      'chemistry', 'chem',
      'economics', 'econ',
      'psychology', 'psych',
      'business', 'mba',
      'law',
      'medicine', 'med',
      'education',
      'english',
      'history',
      'political-science', 'polisci',
      'sociology',
      'philosophy',
    ];

    // Email patterns for generation
    this.emailPatterns = [
      '{first}.{last}@{domain}',
      '{first}{last}@{domain}',
      '{f}{last}@{domain}',
      '{last}.{first}@{domain}',
      '{first}_{last}@{domain}',
      '{last}{f}@{domain}',
    ];

    // Headers to mimic browser
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };
  }

  /**
   * Scrape a single university
   */
  async scrapeUniversity(universityId) {
    const { data: university } = await supabaseAdmin
      .from('universities')
      .select('*')
      .eq('id', universityId)
      .single();

    if (!university) {
      throw new Error('University not found');
    }

    logger.info('Starting scrape for university', { name: university.name, domain: university.domain });

    // Update status to in-progress
    await supabaseAdmin
      .from('universities')
      .update({ scrape_status: 'in_progress' })
      .eq('id', universityId);

    const results = {
      university: university.name,
      facultyFound: 0,
      emailsFound: 0,
      pagesScraped: 0,
      errors: [],
    };

    try {
      // Try to find faculty directory pages
      const facultyPages = await this.findFacultyPages(university.domain);
      results.pagesScraped = facultyPages.length;

      // Scrape each faculty page
      for (const pageUrl of facultyPages) {
        try {
          const contacts = await this.scrapeFacultyPage(pageUrl, university);

          for (const contact of contacts) {
            await this.saveContact(contact, universityId);
            results.facultyFound++;
            if (contact.email) results.emailsFound++;
          }
        } catch (error) {
          results.errors.push({ url: pageUrl, error: error.message });
        }
      }

      // Update status to completed
      await supabaseAdmin
        .from('universities')
        .update({
          scrape_status: 'completed',
          scraped_at: new Date().toISOString(),
        })
        .eq('id', universityId);

    } catch (error) {
      logger.error('Error scraping university', { university: university.name, error: error.message });

      await supabaseAdmin
        .from('universities')
        .update({ scrape_status: 'failed' })
        .eq('id', universityId);

      results.errors.push({ error: error.message });
    }

    logger.info('Scrape completed', results);
    return results;
  }

  /**
   * Find faculty directory pages for a domain
   */
  async findFacultyPages(domain) {
    const pages = [];
    const baseUrl = `https://www.${domain}`;
    const altUrl = `https://${domain}`;

    // Detect if international university by domain suffix
    const isUK = domain.endsWith('.ac.uk');
    const isAustralia = domain.endsWith('.edu.au');
    const isCanada = domain.endsWith('.ca');
    const isInternational = isUK || isAustralia || isCanada ||
      domain.endsWith('.ac.nz') || domain.endsWith('.ie') ||
      domain.endsWith('.edu.sg') || domain.endsWith('.edu.hk') || domain.endsWith('.hk');

    // Try common department + faculty patterns
    for (const dept of this.departmentPaths.slice(0, 10)) { // Limit to first 10 depts
      for (const pattern of this.facultyPatterns.slice(0, 5)) { // Limit patterns
        const urls = [
          `${baseUrl}/${dept}${pattern}`,
          `https://${dept}.${domain}${pattern}`,
          `${baseUrl}/departments/${dept}${pattern}`,
        ];

        // Add international patterns
        if (isInternational) {
          urls.push(
            `${baseUrl}/schools/${dept}/people`,
            `${baseUrl}/schools/${dept}/staff`,
            `${baseUrl}/schools/${dept}/academic-staff`,
            `${baseUrl}/${dept}/about/people`,
            `${baseUrl}/${dept}/about-us/people`,
            `${baseUrl}/${dept}/our-people`,
            `${baseUrl}/${dept}/staff`,
            `${baseUrl}/${dept}/academic-staff`,
            `${baseUrl}/faculties/${dept}/people`,
            `${altUrl}/${dept}${pattern}`,
            `${altUrl}/schools/${dept}/people`,
          );
        }

        for (const url of urls) {
          const exists = await this.checkPageExists(url);
          if (exists) {
            pages.push(url);
            if (pages.length >= 20) break; // Limit pages per university
          }
        }
        if (pages.length >= 20) break;
      }
      if (pages.length >= 20) break;
    }

    // Also try main directory page
    const mainDirUrls = [
      `${baseUrl}/directory`,
      `${baseUrl}/faculty`,
      `${baseUrl}/people`,
      `${altUrl}/directory`,
    ];

    // Add international-specific main directory URLs
    if (isInternational) {
      mainDirUrls.push(
        `${baseUrl}/staff`,
        `${baseUrl}/academic-staff`,
        `${baseUrl}/our-people`,
        `${baseUrl}/about/people`,
        `${baseUrl}/about-us/people`,
        `${baseUrl}/research/people`,
        `${baseUrl}/research/researchers`,
        `${altUrl}/people`,
        `${altUrl}/staff`,
        `${altUrl}/about/people`,
        `https://research.${domain}/en/persons`,
        `https://profiles.${domain}`,
        `https://researchers.${domain}`,
      );
    }

    for (const url of mainDirUrls) {
      const exists = await this.checkPageExists(url);
      if (exists && !pages.includes(url)) {
        pages.push(url);
      }
    }

    logger.info('Found faculty pages', { domain, count: pages.length });
    return pages;
  }

  /**
   * Check if a page exists and returns HTML
   */
  async checkPageExists(url) {
    try {
      const response = await this.limiter.schedule(() =>
        axios.head(url, {
          headers: this.headers,
          timeout: 5000,
          maxRedirects: 3,
        })
      );
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Scrape a faculty directory page
   */
  async scrapeFacultyPage(url, university) {
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

      // Try multiple selectors for faculty listings
      const selectors = [
        '.faculty-member',
        '.person',
        '.staff-member',
        '.profile',
        '.team-member',
        '.directory-item',
        'article.faculty',
        '.faculty-card',
        '.people-list li',
        '.faculty-listing .item',
        'table.directory tr',
        '.views-row', // Drupal
      ];

      for (const selector of selectors) {
        $(selector).each((_, element) => {
          const contact = this.extractContactFromElement($, element, university.domain);
          if (contact && contact.name) {
            contact.source_url = url;
            contacts.push(contact);
          }
        });

        if (contacts.length > 0) break; // Found contacts, stop trying selectors
      }

      // If no structured data found, try to extract emails from page
      if (contacts.length === 0) {
        const pageContacts = this.extractContactsFromText(response.data, university.domain);
        contacts.push(...pageContacts);
      }

      logger.info('Scraped faculty page', { url, contactsFound: contacts.length });

    } catch (error) {
      logger.warn('Error scraping faculty page', { url, error: error.message });
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
    const nameSelectors = ['h2', 'h3', 'h4', '.name', '.title', 'a.name', '.person-name', 'strong'];
    for (const sel of nameSelectors) {
      const found = $el.find(sel).first().text().trim();
      if (found && found.length > 2 && found.length < 100 && !found.includes('@')) {
        name = this.cleanName(found);
        break;
      }
    }

    if (!name) {
      // Try the element itself or first link
      name = this.cleanName($el.find('a').first().text().trim() || $el.text().trim().split('\n')[0]);
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

    // Try to find title
    let title = null;
    const titleSelectors = ['.title', '.position', '.job-title', '.role', '.rank'];
    for (const sel of titleSelectors) {
      const found = $el.find(sel).text().trim();
      if (found && found.length > 2 && found.length < 200) {
        title = found;
        break;
      }
    }

    // Try to find department
    let department = null;
    const deptSelectors = ['.department', '.dept', '.unit', '.affiliation'];
    for (const sel of deptSelectors) {
      const found = $el.find(sel).text().trim();
      if (found && found.length > 2 && found.length < 200) {
        department = found;
        break;
      }
    }

    // Try to find profile URL
    let profileUrl = $el.find('a').first().attr('href');
    if (profileUrl && !profileUrl.startsWith('http')) {
      profileUrl = profileUrl.startsWith('/')
        ? `https://${domain}${profileUrl}`
        : `https://${domain}/${profileUrl}`;
    }

    // Validate - must have name
    if (!name || name.length < 3) return null;

    // If no email found, try to generate candidates
    const emailCandidates = !email ? this.generateEmailCandidates(name, domain) : [];

    return {
      name,
      email,
      email_candidates: emailCandidates,
      title: this.cleanTitle(title),
      department,
      profile_url: profileUrl,
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

    // Filter to only .edu emails from this domain
    const validEmails = emails.filter(email =>
      email.toLowerCase().endsWith(domain) ||
      email.toLowerCase().includes('.edu')
    );

    for (const email of validEmails.slice(0, 50)) { // Limit
      // Try to find name near email in the HTML
      const name = this.findNameNearEmail(html, email);

      contacts.push({
        name: name || this.emailToName(email),
        email: email.toLowerCase(),
        email_candidates: [],
        title: null,
        department: null,
        profile_url: null,
      });
    }

    return contacts;
  }

  /**
   * Find name near an email in HTML
   */
  findNameNearEmail(html, email) {
    // Look for name patterns near the email
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

    // Handle patterns like john.smith, jsmith, john_smith
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

    return [
      `${first}.${last}@${domain}`,
      `${first}${last}@${domain}`,
      `${f}${last}@${domain}`,
      `${last}.${first}@${domain}`,
      `${first}_${last}@${domain}`,
    ];
  }

  /**
   * Clean up name string
   */
  cleanName(name) {
    if (!name) return null;

    return name
      .replace(/\s+/g, ' ')
      .replace(/^(Dr\.|Prof\.|Professor|Mr\.|Mrs\.|Ms\.)\s*/i, '')
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
  async saveContact(contact, universityId) {
    if (!contact.name) return;

    // If no email, skip for now (could verify candidates later)
    if (!contact.email && (!contact.email_candidates || contact.email_candidates.length === 0)) {
      return;
    }

    const email = contact.email || contact.email_candidates[0];

    try {
      await supabaseAdmin
        .from('faculty_contacts')
        .upsert({
          university_id: universityId,
          name: contact.name,
          email: email,
          email_verified: !!contact.email, // Only mark verified if found on page
          title: contact.title,
          department: contact.department,
          profile_url: contact.profile_url,
          source_url: contact.source_url,
          scraped_at: new Date().toISOString(),
        }, { onConflict: 'email' });

    } catch (error) {
      if (!error.message.includes('duplicate')) {
        logger.error('Error saving contact', { email, error: error.message });
      }
    }
  }

  /**
   * Scrape all pending universities
   */
  async scrapeAllPending(limit = 10) {
    const { data: universities } = await supabaseAdmin
      .from('universities')
      .select('id, name, domain')
      .eq('scrape_status', 'pending')
      .limit(limit);

    if (!universities || universities.length === 0) {
      logger.info('No pending universities to scrape');
      return { scraped: 0 };
    }

    const results = {
      scraped: 0,
      totalFaculty: 0,
      errors: [],
    };

    for (const university of universities) {
      try {
        const result = await this.scrapeUniversity(university.id);
        results.scraped++;
        results.totalFaculty += result.facultyFound;
      } catch (error) {
        results.errors.push({ university: university.name, error: error.message });
      }

      // Pause between universities
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info('Batch scrape completed', results);
    return results;
  }

  /**
   * Get scraping stats
   */
  async getStats() {
    const { data: universities } = await supabaseAdmin
      .from('universities')
      .select('scrape_status');

    const { count: contactCount } = await supabaseAdmin
      .from('faculty_contacts')
      .select('id', { count: 'exact' });

    const { count: verifiedCount } = await supabaseAdmin
      .from('faculty_contacts')
      .select('id', { count: 'exact' })
      .eq('email_verified', true);

    const statusCounts = {
      pending: 0,
      completed: 0,
      failed: 0,
      in_progress: 0,
    };

    for (const u of universities || []) {
      statusCounts[u.scrape_status] = (statusCounts[u.scrape_status] || 0) + 1;
    }

    return {
      universities: {
        total: universities?.length || 0,
        ...statusCounts,
      },
      contacts: {
        total: contactCount || 0,
        verified: verifiedCount || 0,
      },
    };
  }
}

module.exports = new UniversityScraperService();
