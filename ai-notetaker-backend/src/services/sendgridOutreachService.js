/**
 * SendGrid Outreach Service
 * Handles email sending via SendGrid with warmup tracking
 */

const sgMail = require('@sendgrid/mail');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const Bottleneck = require('bottleneck');

class SendGridOutreachService {
  constructor() {
    this.limiter = null;
    this.initialized = false;
    this.fromDomain = 'scribeai.online';
    this.fromEmail = 'outreach@scribeai.online';
    this.fromName = 'Sushanth from Scribe AI';
  }

  /**
   * Initialize the SendGrid client
   */
  initialize() {
    if (this.initialized) return;

    if (!process.env.SENDGRID_API_KEY) {
      logger.warn('SendGrid API key not configured');
      return;
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    // Rate limiter: SendGrid free tier is 100/day, so be conservative
    this.limiter = new Bottleneck({
      maxConcurrent: 2,
      minTime: 500, // 2 per second max
    });

    this.initialized = true;
    logger.info('SendGrid Outreach Service initialized');
  }

  /**
   * Check SendGrid account status
   */
  async getAccountStatus() {
    this.initialize();

    return {
      provider: 'sendgrid',
      productionAccess: true, // SendGrid doesn't have sandbox mode like SES
      sendingEnabled: !!process.env.SENDGRID_API_KEY,
      tier: 'free', // 100 emails/day
      dailyLimit: 100,
    };
  }

  /**
   * Send a single email
   */
  async sendEmail({ to, toName, subject, bodyHtml, bodyText, campaignId, contactId }) {
    this.initialize();

    // Check daily limit
    const canSend = await this.checkDailyLimit();
    if (!canSend) {
      throw new Error('Daily sending limit reached');
    }

    const msg = {
      to: toName ? { email: to, name: toName } : to,
      from: {
        email: this.fromEmail,
        name: this.fromName,
      },
      subject: subject,
      text: bodyText || this.stripHtml(bodyHtml),
      html: bodyHtml,
      customArgs: {
        campaign_id: campaignId || 'warmup',
        contact_id: contactId || 'unknown',
      },
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
    };

    try {
      const response = await this.limiter.schedule(() => sgMail.send(msg));

      // SendGrid returns message ID in headers
      const messageId = response[0]?.headers?.['x-message-id'] || `sg_${Date.now()}`;

      // Update daily count
      await this.incrementDailyCount();

      logger.info('Email sent successfully via SendGrid', {
        messageId,
        to,
        campaignId,
      });

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      logger.error('Error sending email via SendGrid', {
        error: error.message,
        to,
        campaignId,
        response: error.response?.body,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send batch of emails (respecting rate limits)
   */
  async sendBatch(emails, campaignId) {
    this.initialize();

    const results = {
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const email of emails) {
      // Check daily limit before each send
      const canSend = await this.checkDailyLimit();
      if (!canSend) {
        logger.warn('Daily limit reached, stopping batch', { sent: results.sent });
        break;
      }

      try {
        const result = await this.sendEmail({
          to: email.to,
          toName: email.toName,
          subject: email.subject,
          bodyHtml: email.bodyHtml,
          bodyText: email.bodyText,
          campaignId,
          contactId: email.contactId,
        });

        if (result.success) {
          results.sent++;

          // Update email record in database
          if (email.emailId) {
            await supabaseAdmin
              .from('outreach_emails')
              .update({
                status: 'sent',
                ses_message_id: result.messageId, // reusing field name for compatibility
                sent_at: new Date().toISOString(),
              })
              .eq('id', email.emailId);
          }
        } else {
          results.failed++;
          results.errors.push({ email: email.to, error: result.error });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ email: email.to, error: error.message });
      }

      // Delay between emails for SendGrid
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    logger.info('Batch send completed', {
      campaignId,
      sent: results.sent,
      failed: results.failed,
    });

    return results;
  }

  /**
   * Check if we can send more emails today
   */
  async checkDailyLimit() {
    const { data: domain } = await supabaseAdmin
      .from('email_domains')
      .select('daily_limit, sent_today')
      .eq('domain', this.fromDomain)
      .single();

    if (!domain) {
      // Domain not in DB yet, create it
      await this.initializeDomain();
      return true;
    }

    return domain.sent_today < domain.daily_limit;
  }

  /**
   * Increment daily send count
   */
  async incrementDailyCount() {
    // Manual increment since RPC may not exist
    const { data: domain } = await supabaseAdmin
      .from('email_domains')
      .select('sent_today, sent_total')
      .eq('domain', this.fromDomain)
      .single();

    if (domain) {
      await supabaseAdmin
        .from('email_domains')
        .update({
          sent_today: (domain.sent_today || 0) + 1,
          sent_total: (domain.sent_total || 0) + 1,
        })
        .eq('domain', this.fromDomain);
    }
  }

  /**
   * Initialize domain in database
   */
  async initializeDomain() {
    const { error } = await supabaseAdmin
      .from('email_domains')
      .upsert({
        domain: this.fromDomain,
        status: 'active', // SendGrid doesn't need warmup approval
        daily_limit: 100, // SendGrid free tier limit
        sent_today: 0,
        sent_total: 0,
        warmup_day: 0,
      }, { onConflict: 'domain' });

    if (error) {
      logger.error('Error initializing domain', { error: error.message });
    }
  }

  /**
   * Update warmup progress and daily limit
   * For SendGrid free tier, we're limited to 100/day so warmup is less relevant
   */
  async updateWarmupProgress() {
    // Get current warmup day
    const { data: domain } = await supabaseAdmin
      .from('email_domains')
      .select('warmup_day, warmup_started_at')
      .eq('domain', this.fromDomain)
      .single();

    if (!domain) return;

    const nextDay = (domain.warmup_day || 0) + 1;

    // For SendGrid, cap at 100/day for free tier
    const dailyLimit = Math.min(100, nextDay * 20);

    await supabaseAdmin
      .from('email_domains')
      .update({
        warmup_day: nextDay,
        daily_limit: dailyLimit,
        sent_today: 0,
        warmup_started_at: domain.warmup_started_at || new Date().toISOString(),
        status: 'active',
      })
      .eq('domain', this.fromDomain);

    logger.info('Warmup progress updated', {
      day: nextDay,
      newLimit: dailyLimit,
    });
  }

  /**
   * Get warmup status
   */
  async getWarmupStatus() {
    const { data: domain } = await supabaseAdmin
      .from('email_domains')
      .select('*')
      .eq('domain', this.fromDomain)
      .single();

    if (!domain) {
      return {
        status: 'not_initialized',
        domain: this.fromDomain,
        provider: 'sendgrid',
      };
    }

    return {
      domain: domain.domain,
      status: domain.status,
      provider: 'sendgrid',
      warmupDay: domain.warmup_day,
      dailyLimit: Math.min(domain.daily_limit, 100), // Cap at SendGrid free tier
      sentToday: domain.sent_today,
      sentTotal: domain.sent_total,
      bounceRate: domain.bounce_rate,
      complaintRate: domain.complaint_rate,
      warmupStartedAt: domain.warmup_started_at,
      note: 'SendGrid free tier: 100 emails/day',
    };
  }

  /**
   * Handle bounce notification (from SendGrid webhook)
   */
  async handleBounce({ messageId, bounceType, bouncedRecipients }) {
    // Update email record
    await supabaseAdmin
      .from('outreach_emails')
      .update({
        status: 'bounced',
        bounced_at: new Date().toISOString(),
        bounce_type: bounceType,
      })
      .eq('ses_message_id', messageId);

    // Update contact status
    for (const recipient of bouncedRecipients) {
      await supabaseAdmin
        .from('faculty_contacts')
        .update({
          outreach_status: 'bounced',
          email_verified: false,
        })
        .eq('email', recipient.email || recipient.emailAddress);
    }

    // Update domain stats
    await this.updateDomainStats();

    logger.warn('Bounce processed', { messageId, bounceType });
  }

  /**
   * Handle complaint notification (from SendGrid webhook)
   */
  async handleComplaint({ messageId, complainedRecipients }) {
    // Update email record
    await supabaseAdmin
      .from('outreach_emails')
      .update({
        status: 'complained',
      })
      .eq('ses_message_id', messageId);

    // Update contact - mark as unsubscribed
    for (const recipient of complainedRecipients) {
      await supabaseAdmin
        .from('faculty_contacts')
        .update({
          outreach_status: 'unsubscribed',
        })
        .eq('email', recipient.email || recipient.emailAddress);
    }

    // Update domain stats
    await this.updateDomainStats();

    logger.warn('Complaint processed', { messageId });
  }

  /**
   * Handle delivery notification
   */
  async handleDelivery({ messageId }) {
    await supabaseAdmin
      .from('outreach_emails')
      .update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
      })
      .eq('ses_message_id', messageId);
  }

  /**
   * Update domain statistics
   */
  async updateDomainStats() {
    const today = new Date().toISOString().split('T')[0];

    // Get today's stats
    const { data: emails } = await supabaseAdmin
      .from('outreach_emails')
      .select('status')
      .gte('sent_at', `${today}T00:00:00`)
      .lt('sent_at', `${today}T23:59:59`);

    if (!emails || emails.length === 0) return;

    const sent = emails.length;
    const bounced = emails.filter(e => e.status === 'bounced').length;
    const complained = emails.filter(e => e.status === 'complained').length;

    const bounceRate = sent > 0 ? (bounced / sent * 100).toFixed(2) : 0;
    const complaintRate = sent > 0 ? (complained / sent * 100).toFixed(2) : 0;

    // Update domain
    await supabaseAdmin
      .from('email_domains')
      .update({
        bounce_rate: bounceRate,
        complaint_rate: complaintRate,
      })
      .eq('domain', this.fromDomain);

    // Record daily stats
    await supabaseAdmin
      .from('outreach_daily_stats')
      .upsert({
        domain: this.fromDomain,
        date: today,
        sent_count: sent,
        bounced_count: bounced,
        complained_count: complained,
        bounce_rate: bounceRate,
        complaint_rate: complaintRate,
      }, { onConflict: 'domain,date' });
  }

  /**
   * Personalize email template
   */
  personalizeTemplate(template, contact, university) {
    let result = template;

    const replacements = {
      '{{name}}': contact.name || 'Professor',
      '{{first_name}}': contact.name?.split(' ')[0] || 'Professor',
      '{{last_name}}': contact.name?.split(' ').slice(1).join(' ') || '',
      '{{title}}': contact.title || 'Professor',
      '{{department}}': contact.department || 'your department',
      '{{university}}': university?.name || 'your university',
      '{{email}}': contact.email,
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }

    return result;
  }

  /**
   * Strip HTML tags for plain text version
   */
  stripHtml(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = new SendGridOutreachService();
