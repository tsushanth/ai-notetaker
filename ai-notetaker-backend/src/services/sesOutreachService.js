/**
 * SES Outreach Service
 * Handles email sending via Amazon SES with warmup tracking
 */

const { SESv2Client, SendEmailCommand, GetAccountCommand } = require('@aws-sdk/client-sesv2');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const Bottleneck = require('bottleneck');

class SESOutreachService {
  constructor() {
    this.client = null;
    this.limiter = null;
    this.initialized = false;
    this.fromDomain = 'scribeai.online';
    this.fromEmail = 'outreach@scribeai.online';
    this.fromName = 'Sushanth from Scribe AI';
  }

  /**
   * Initialize the SES client
   */
  initialize() {
    if (this.initialized) return;

    this.client = new SESv2Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    // Rate limiter: 14 emails/second (SES default limit)
    this.limiter = new Bottleneck({
      maxConcurrent: 5,
      minTime: 100, // 10 per second max
    });

    this.initialized = true;
    logger.info('SES Outreach Service initialized', { region: process.env.AWS_REGION || 'us-east-1' });
  }

  /**
   * Check SES account status
   */
  async getAccountStatus() {
    this.initialize();

    try {
      const command = new GetAccountCommand({});
      const response = await this.client.send(command);

      return {
        productionAccess: response.ProductionAccessEnabled,
        sendingEnabled: response.SendingEnabled,
        enforcementStatus: response.EnforcementStatus,
        sendQuota: response.SendQuota,
      };
    } catch (error) {
      logger.error('Error getting SES account status', { error: error.message });
      throw error;
    }
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

    const params = {
      FromEmailAddress: `${this.fromName} <${this.fromEmail}>`,
      Destination: {
        ToAddresses: [toName ? `${toName} <${to}>` : to],
      },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: bodyHtml, Charset: 'UTF-8' },
            Text: { Data: bodyText || this.stripHtml(bodyHtml), Charset: 'UTF-8' },
          },
        },
      },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
      EmailTags: [
        { Name: 'campaign_id', Value: campaignId || 'warmup' },
        { Name: 'contact_id', Value: contactId || 'unknown' },
      ],
    };

    try {
      const command = new SendEmailCommand(params);
      const response = await this.limiter.schedule(() => this.client.send(command));

      // Update daily count
      await this.incrementDailyCount();

      logger.info('Email sent successfully', {
        messageId: response.MessageId,
        to,
        campaignId,
      });

      return {
        success: true,
        messageId: response.MessageId,
      };
    } catch (error) {
      logger.error('Error sending email', {
        error: error.message,
        to,
        campaignId,
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
                ses_message_id: result.messageId,
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

      // Small delay between emails
      await new Promise(resolve => setTimeout(resolve, 50));
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
    await supabaseAdmin.rpc('increment_sent_today', { p_domain: this.fromDomain });

    // If RPC doesn't exist, do manual update
    await supabaseAdmin
      .from('email_domains')
      .update({
        sent_today: supabaseAdmin.raw('sent_today + 1'),
        sent_total: supabaseAdmin.raw('sent_total + 1'),
      })
      .eq('domain', this.fromDomain);
  }

  /**
   * Initialize domain in database
   */
  async initializeDomain() {
    const { error } = await supabaseAdmin
      .from('email_domains')
      .upsert({
        domain: this.fromDomain,
        status: 'pending',
        daily_limit: 50, // Start with warmup limit
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

    // Get target for next day
    const { data: schedule } = await supabaseAdmin
      .from('warmup_schedule')
      .select('daily_target')
      .eq('day', nextDay)
      .single();

    if (schedule) {
      await supabaseAdmin
        .from('email_domains')
        .update({
          warmup_day: nextDay,
          daily_limit: schedule.daily_target,
          sent_today: 0,
          warmup_started_at: domain.warmup_started_at || new Date().toISOString(),
          status: nextDay >= 7 ? 'active' : 'warming',
        })
        .eq('domain', this.fromDomain);

      logger.info('Warmup progress updated', {
        day: nextDay,
        newLimit: schedule.daily_target,
      });
    }
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
      };
    }

    const { data: schedule } = await supabaseAdmin
      .from('warmup_schedule')
      .select('*')
      .order('day');

    return {
      domain: domain.domain,
      status: domain.status,
      warmupDay: domain.warmup_day,
      dailyLimit: domain.daily_limit,
      sentToday: domain.sent_today,
      sentTotal: domain.sent_total,
      bounceRate: domain.bounce_rate,
      complaintRate: domain.complaint_rate,
      warmupStartedAt: domain.warmup_started_at,
      schedule: schedule || [],
    };
  }

  /**
   * Handle bounce notification (from SNS webhook)
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
        .eq('email', recipient.emailAddress);
    }

    // Update domain bounce rate
    await this.updateDomainStats();

    logger.warn('Bounce processed', { messageId, bounceType, recipients: bouncedRecipients.length });
  }

  /**
   * Handle complaint notification (from SNS webhook)
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
        .eq('email', recipient.emailAddress);
    }

    // Update domain complaint rate
    await this.updateDomainStats();

    logger.warn('Complaint processed', { messageId, recipients: complainedRecipients.length });
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

module.exports = new SESOutreachService();
