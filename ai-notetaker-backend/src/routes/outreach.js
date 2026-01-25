/**
 * Outreach Routes
 * API for university outreach campaigns
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { supabaseAdmin } = require('../config/supabase');
const emailOutreachService = require('../services/sendgridOutreachService');
const universityScraperService = require('../services/universityScraperService');

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Admin middleware (simplified - implement proper RBAC in production)
const requireAdmin = async (req, res, next) => {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (!user || user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
  }

  next();
};

// =====================================================
// WARMUP & EMAIL STATUS
// =====================================================

/**
 * GET /api/outreach/warmup-status
 * Get warmup status for the outreach domain
 */
router.get('/warmup-status', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const status = await emailOutreachService.getWarmupStatus();

  res.json({
    success: true,
    data: status,
  });
}));

/**
 * POST /api/outreach/warmup/advance
 * Advance warmup to next day (call daily)
 */
router.post('/warmup/advance', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  await emailOutreachService.updateWarmupProgress();
  const status = await emailOutreachService.getWarmupStatus();

  res.json({
    success: true,
    data: status,
    message: `Advanced to day ${status.warmupDay}. New daily limit: ${status.dailyLimit}`,
  });
}));

/**
 * GET /api/outreach/ses-status
 * Get SES account status
 */
router.get('/ses-status', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  try {
    const status = await emailOutreachService.getAccountStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Make sure AWS credentials are configured',
    });
  }
}));

// =====================================================
// UNIVERSITIES
// =====================================================

/**
 * GET /api/outreach/universities
 * List universities
 */
router.get('/universities', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  let query = supabaseAdmin
    .from('universities')
    .select('*', { count: 'exact' })
    .order('name')
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (status) {
    query = query.eq('scrape_status', status);
  }

  const { data: universities, count, error } = await query;

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    data: universities,
    pagination: { total: count, limit: parseInt(limit), offset: parseInt(offset) },
  });
}));

/**
 * POST /api/outreach/universities
 * Add a university
 */
router.post('/universities', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { name, domain, city, state, type, enrollment_size } = req.body;

  if (!name || !domain) {
    return res.status(400).json({
      success: false,
      error: 'Name and domain are required',
    });
  }

  const { data: university, error } = await supabaseAdmin
    .from('universities')
    .insert({
      name,
      domain: domain.toLowerCase().replace(/^www\./, ''),
      city,
      state,
      type,
      enrollment_size,
    })
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.status(201).json({
    success: true,
    data: university,
  });
}));

// =====================================================
// SCRAPING
// =====================================================

/**
 * GET /api/outreach/scraper/stats
 * Get scraping statistics
 */
router.get('/scraper/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const stats = await universityScraperService.getStats();

  res.json({
    success: true,
    data: stats,
  });
}));

/**
 * POST /api/outreach/scraper/run
 * Run scraper on pending universities
 */
router.post('/scraper/run', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { limit = 5 } = req.body;

  // Start scraping in background
  res.json({
    success: true,
    message: `Starting scrape for up to ${limit} universities. Check /scraper/stats for progress.`,
  });

  // Run async
  universityScraperService.scrapeAllPending(limit).catch(error => {
    logger.error('Background scrape failed', { error: error.message });
  });
}));

/**
 * POST /api/outreach/scraper/university/:id
 * Scrape a specific university
 */
router.post('/scraper/university/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await universityScraperService.scrapeUniversity(id);

  res.json({
    success: true,
    data: result,
  });
}));

// =====================================================
// CONTACTS
// =====================================================

/**
 * GET /api/outreach/contacts
 * List faculty contacts
 */
router.get('/contacts', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    university_id,
    department,
    status,
    verified,
    limit = 50,
    offset = 0,
    search,
  } = req.query;

  let query = supabaseAdmin
    .from('faculty_contacts')
    .select(`
      *,
      universities (name, domain)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (university_id) {
    query = query.eq('university_id', university_id);
  }
  if (department) {
    query = query.ilike('department', `%${department}%`);
  }
  if (status) {
    query = query.eq('outreach_status', status);
  }
  if (verified === 'true') {
    query = query.eq('email_verified', true);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data: contacts, count, error } = await query;

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    data: contacts,
    pagination: { total: count, limit: parseInt(limit), offset: parseInt(offset) },
  });
}));

/**
 * GET /api/outreach/contacts/stats
 * Get contact statistics
 */
router.get('/contacts/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { data: statusCounts } = await supabaseAdmin
    .from('faculty_contacts')
    .select('outreach_status');

  const stats = {
    total: statusCounts?.length || 0,
    byStatus: {},
  };

  for (const contact of statusCounts || []) {
    const status = contact.outreach_status || 'pending';
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
  }

  const { count: verifiedCount } = await supabaseAdmin
    .from('faculty_contacts')
    .select('id', { count: 'exact' })
    .eq('email_verified', true);

  stats.verified = verifiedCount || 0;

  res.json({
    success: true,
    data: stats,
  });
}));

// =====================================================
// CAMPAIGNS
// =====================================================

/**
 * GET /api/outreach/campaigns
 * List campaigns
 */
router.get('/campaigns', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { data: campaigns, error } = await supabaseAdmin
    .from('outreach_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    data: campaigns,
  });
}));

/**
 * POST /api/outreach/campaigns
 * Create a campaign
 */
router.post('/campaigns', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    name,
    description,
    subject_template,
    body_template,
    target_departments,
    target_titles,
    daily_limit = 500,
  } = req.body;

  if (!name || !subject_template || !body_template) {
    return res.status(400).json({
      success: false,
      error: 'Name, subject_template, and body_template are required',
    });
  }

  const { data: campaign, error } = await supabaseAdmin
    .from('outreach_campaigns')
    .insert({
      name,
      description,
      subject_template,
      body_template,
      target_departments,
      target_titles,
      daily_limit,
      status: 'draft',
    })
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.status(201).json({
    success: true,
    data: campaign,
  });
}));

/**
 * GET /api/outreach/campaigns/:id
 * Get campaign details
 */
router.get('/campaigns/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: campaign, error } = await supabaseAdmin
    .from('outreach_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !campaign) {
    return res.status(404).json({ success: false, error: 'Campaign not found' });
  }

  // Get email stats
  const { data: emails } = await supabaseAdmin
    .from('outreach_emails')
    .select('status')
    .eq('campaign_id', id);

  const emailStats = {
    total: emails?.length || 0,
    byStatus: {},
  };

  for (const email of emails || []) {
    emailStats.byStatus[email.status] = (emailStats.byStatus[email.status] || 0) + 1;
  }

  res.json({
    success: true,
    data: {
      ...campaign,
      emailStats,
    },
  });
}));

/**
 * PUT /api/outreach/campaigns/:id
 * Update a campaign
 */
router.put('/campaigns/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Don't allow updating certain fields
  delete updates.id;
  delete updates.created_at;
  delete updates.sent_count;
  delete updates.opened_count;
  delete updates.replied_count;
  delete updates.bounced_count;

  const { data: campaign, error } = await supabaseAdmin
    .from('outreach_campaigns')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    data: campaign,
  });
}));

/**
 * POST /api/outreach/campaigns/:id/queue
 * Queue contacts for a campaign
 */
router.post('/campaigns/:id/queue', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit = 100 } = req.body;

  // Get campaign
  const { data: campaign } = await supabaseAdmin
    .from('outreach_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (!campaign) {
    return res.status(404).json({ success: false, error: 'Campaign not found' });
  }

  // Get contacts not yet in this campaign
  let query = supabaseAdmin
    .from('faculty_contacts')
    .select('id, name, email, title, department, university_id')
    .eq('outreach_status', 'pending')
    .eq('email_verified', true)
    .limit(parseInt(limit));

  // Apply targeting
  if (campaign.target_departments?.length > 0) {
    query = query.in('department', campaign.target_departments);
  }

  const { data: contacts, error: contactsError } = await query;

  if (contactsError) {
    return res.status(500).json({ success: false, error: contactsError.message });
  }

  if (!contacts || contacts.length === 0) {
    return res.json({
      success: true,
      message: 'No contacts available to queue',
      queued: 0,
    });
  }

  // Get universities for personalization
  const universityIds = [...new Set(contacts.map(c => c.university_id))];
  const { data: universities } = await supabaseAdmin
    .from('universities')
    .select('id, name')
    .in('id', universityIds);

  const universityMap = {};
  for (const u of universities || []) {
    universityMap[u.id] = u;
  }

  // Create email records
  const emailRecords = contacts.map(contact => {
    const university = universityMap[contact.university_id];

    return {
      campaign_id: id,
      contact_id: contact.id,
      to_email: contact.email,
      to_name: contact.name,
      subject: emailOutreachService.personalizeTemplate(
        campaign.subject_template,
        contact,
        university
      ),
      body_html: emailOutreachService.personalizeTemplate(
        campaign.body_template,
        contact,
        university
      ),
      status: 'queued',
      sequence_number: 1,
    };
  });

  const { error: insertError } = await supabaseAdmin
    .from('outreach_emails')
    .insert(emailRecords);

  if (insertError) {
    return res.status(500).json({ success: false, error: insertError.message });
  }

  // Update campaign total
  await supabaseAdmin
    .from('outreach_campaigns')
    .update({
      total_contacts: campaign.total_contacts + contacts.length,
    })
    .eq('id', id);

  res.json({
    success: true,
    message: `Queued ${contacts.length} contacts for campaign`,
    queued: contacts.length,
  });
}));

/**
 * POST /api/outreach/campaigns/:id/send
 * Send queued emails for a campaign
 */
router.post('/campaigns/:id/send', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { limit = 50 } = req.body;

  // Get campaign
  const { data: campaign } = await supabaseAdmin
    .from('outreach_campaigns')
    .select('*')
    .eq('id', id)
    .single();

  if (!campaign) {
    return res.status(404).json({ success: false, error: 'Campaign not found' });
  }

  // Get queued emails
  const { data: emails, error: emailsError } = await supabaseAdmin
    .from('outreach_emails')
    .select('*')
    .eq('campaign_id', id)
    .eq('status', 'queued')
    .limit(parseInt(limit));

  if (emailsError) {
    return res.status(500).json({ success: false, error: emailsError.message });
  }

  if (!emails || emails.length === 0) {
    return res.json({
      success: true,
      message: 'No emails queued to send',
      sent: 0,
    });
  }

  // Update campaign status
  if (campaign.status === 'draft') {
    await supabaseAdmin
      .from('outreach_campaigns')
      .update({
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  // Send emails
  const emailsToSend = emails.map(e => ({
    emailId: e.id,
    to: e.to_email,
    toName: e.to_name,
    subject: e.subject,
    bodyHtml: e.body_html,
    contactId: e.contact_id,
  }));

  const result = await emailOutreachService.sendBatch(emailsToSend, id);

  // Update contact statuses
  for (const email of emails) {
    await supabaseAdmin
      .from('faculty_contacts')
      .update({
        outreach_status: 'contacted',
        last_contacted_at: new Date().toISOString(),
      })
      .eq('id', email.contact_id);
  }

  // Update campaign stats
  await supabaseAdmin.rpc('update_campaign_stats', { p_campaign_id: id });

  res.json({
    success: true,
    data: result,
  });
}));

// =====================================================
// SEND TEST EMAIL
// =====================================================

/**
 * POST /api/outreach/send-test
 * Send a test email (for warmup)
 */
router.post('/send-test', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { to, subject, body } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({
      success: false,
      error: 'to, subject, and body are required',
    });
  }

  const result = await emailOutreachService.sendEmail({
    to,
    subject,
    bodyHtml: body,
    campaignId: 'test',
  });

  res.json({
    success: result.success,
    data: result,
  });
}));

// =====================================================
// WEBHOOKS (for SES notifications)
// =====================================================

/**
 * POST /api/outreach/webhook/ses
 * Handle SES bounce/complaint/delivery notifications
 */
router.post('/webhook/ses', asyncHandler(async (req, res) => {
  const message = req.body;

  // Handle SNS subscription confirmation
  if (message.Type === 'SubscriptionConfirmation') {
    logger.info('SNS subscription confirmation', { subscribeUrl: message.SubscribeURL });
    // Auto-confirm by visiting the URL
    try {
      await require('axios').get(message.SubscribeURL);
      logger.info('SNS subscription confirmed');
    } catch (error) {
      logger.error('Failed to confirm SNS subscription', { error: error.message });
    }
    return res.status(200).send('OK');
  }

  // Handle notification
  if (message.Type === 'Notification') {
    try {
      const notification = JSON.parse(message.Message);

      if (notification.notificationType === 'Bounce') {
        await emailOutreachService.handleBounce({
          messageId: notification.mail.messageId,
          bounceType: notification.bounce.bounceType,
          bouncedRecipients: notification.bounce.bouncedRecipients,
        });
      } else if (notification.notificationType === 'Complaint') {
        await emailOutreachService.handleComplaint({
          messageId: notification.mail.messageId,
          complainedRecipients: notification.complaint.complainedRecipients,
        });
      } else if (notification.notificationType === 'Delivery') {
        await emailOutreachService.handleDelivery({
          messageId: notification.mail.messageId,
        });
      }
    } catch (error) {
      logger.error('Error processing SES notification', { error: error.message });
    }
  }

  res.status(200).send('OK');
}));

// =====================================================
// EMAIL TEMPLATES
// =====================================================

/**
 * GET /api/outreach/templates
 * Get sample email templates
 */
router.get('/templates', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const templates = [
    {
      name: 'Educator Introduction',
      subject: 'Free study tools for your {{department}} students at {{university}}',
      body: `
<p>Hi {{first_name}},</p>

<p>I'm reaching out because I built <strong>Scribe AI</strong> - a study tool that helps students turn their lecture notes, textbooks, and videos into flashcards, quizzes, and summaries using AI.</p>

<p>I'd love to offer you and your students at {{university}} <strong>free premium access</strong> to try it out this semester.</p>

<p>Here's what students use it for:</p>
<ul>
  <li>Convert lecture recordings into organized notes</li>
  <li>Generate practice quizzes from any material</li>
  <li>Create flashcards from textbook chapters</li>
  <li>Summarize long readings quickly</li>
  <li>Turn any content into a podcast to learn on the go</li>
  <li>Explore similar topics to deepen understanding</li>
  <li>Create mind maps to visualize concepts</li>
</ul>
<p><em>...and more features coming soon!</em></p>

<p>Would you be open to sharing it with your class? I can set up free access for everyone.</p>

<p><a href="https://scribeai.online/screenshots/screenshot-1.jpg">See what it looks like →</a></p>

<p>Students can download it here:</p>
<ul>
  <li><a href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602">iPhone/iPad App Store</a></li>
  <li><a href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai">Android Play Store</a></li>
  <li><a href="https://scribeai.online">Web App</a></li>
</ul>

<p>Best,<br>
Sushanth<br>
Founder, <a href="https://scribeai.online">Scribe AI</a></p>
      `.trim(),
    },
    {
      name: 'Follow-up #1',
      subject: 'Re: Free study tools for your students',
      body: `
<p>Hi {{first_name}},</p>

<p>Just following up on my note about Scribe AI - the free study tool for your students.</p>

<p>A few {{department}} professors at other universities have found it especially useful for:</p>
<ul>
  <li>Reducing repetitive questions during office hours</li>
  <li>Helping students prepare more effectively for exams</li>
  <li>Making dense course material more accessible</li>
</ul>

<p>Happy to give you a personal walkthrough if you're interested, or just set up free access for your class directly.</p>

<p>Here are the download links to share:</p>
<ul>
  <li><a href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602">iOS</a> | <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai">Android</a> | <a href="https://scribeai.online">Web</a></li>
</ul>

<p>Let me know!</p>

<p>Best,<br>
Sushanth</p>
      `.trim(),
    },
    {
      name: 'Follow-up #2 (Final)',
      subject: 'Last note: Scribe AI for {{university}}',
      body: `
<p>Hi {{first_name}},</p>

<p>Wanted to send one last note - I know how busy the semester gets.</p>

<p>If Scribe AI could help your students this term, I'm happy to set up free access anytime. Just reply "interested" and I'll send the details.</p>

<p>Quick links: <a href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602">iOS</a> | <a href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai">Android</a> | <a href="https://scribeai.online">Web</a></p>

<p>If not, no worries at all - I appreciate your time!</p>

<p>Best,<br>
Sushanth</p>
      `.trim(),
    },
  ];

  res.json({
    success: true,
    data: templates,
  });
}));

module.exports = router;
