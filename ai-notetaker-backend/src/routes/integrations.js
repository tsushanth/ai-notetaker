const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const integrationService = require('../services/integrationService');
const { logger } = require('../utils/logger');
const { OAuth2Client } = require('google-auth-library');

/**
 * Require premium for integration actions
 */
const requirePremiumForIntegration = async (req, res, next) => {
  const status = await getSubscriptionStatus(req.userId);
  if (status.isSubscribed || status.isInTrial) return next();
  return res.status(403).json({
    success: false,
    error: 'Premium subscription required for integrations',
    code: 'PREMIUM_REQUIRED'
  });
};

// ============================================
// Get connected integrations
// ============================================
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const integrations = await integrationService.getConnectedIntegrations(req.userId);
  res.json({ success: true, data: integrations });
}));

// ============================================
// Disconnect an integration
// ============================================
router.delete('/:provider', authenticate, asyncHandler(async (req, res) => {
  await integrationService.disconnectIntegration(req.userId, req.params.provider);
  res.json({ success: true });
}));

// ============================================
// Google Drive OAuth
// ============================================
router.get('/google-drive/auth-url', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/integrations/google-drive/callback`
  );

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state: req.userId,
    prompt: 'consent'
  });

  res.json({ success: true, data: { authUrl: authorizeUrl } });
}));

router.get('/google-drive/callback', asyncHandler(async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.status(400).send('Missing authorization code');
  }

  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/integrations/google-drive/callback`
  );

  const { tokens } = await oauth2Client.getToken(code);
  await integrationService.saveGoogleDriveTokens(userId, tokens);

  // Redirect to web app settings or show success
  const webAppUrl = process.env.WEB_APP_URL || 'https://scribeai.app';
  res.redirect(`${webAppUrl}/settings?integration=google_drive&status=connected`);
}));

// Export to Google Drive
router.post('/google-drive/export/:noteId', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const result = await integrationService.exportToGoogleDrive(req.userId, req.params.noteId);
  res.json({ success: true, data: result });
}));

// ============================================
// Notion OAuth
// ============================================
router.get('/notion/auth-url', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    throw new AppError('Notion integration not configured', 500);
  }

  const redirectUri = process.env.NOTION_REDIRECT_URI
    || `${req.protocol}://${req.get('host')}/api/integrations/notion/callback`;

  const authorizeUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}&state=${req.userId}`;

  res.json({ success: true, data: { authUrl: authorizeUrl } });
}));

router.get('/notion/callback', asyncHandler(async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.status(400).send('Missing authorization code');
  }

  const redirectUri = process.env.NOTION_REDIRECT_URI
    || `${req.protocol}://${req.get('host')}/api/integrations/notion/callback`;

  // Exchange code for token
  const axios = require('axios');
  const tokenRes = await axios.post('https://api.notion.com/v1/oauth/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  }, {
    auth: {
      username: process.env.NOTION_CLIENT_ID,
      password: process.env.NOTION_CLIENT_SECRET
    },
    headers: { 'Content-Type': 'application/json' }
  });

  await integrationService.saveNotionTokens(userId, tokenRes.data);

  const webAppUrl = process.env.WEB_APP_URL || 'https://scribeai.app';
  res.redirect(`${webAppUrl}/settings?integration=notion&status=connected`);
}));

// Export to Notion
router.post('/notion/export/:noteId', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const { parentPageId } = req.body;
  const result = await integrationService.exportToNotion(req.userId, req.params.noteId, parentPageId);
  res.json({ success: true, data: result });
}));

// ============================================
// Slack OAuth
// ============================================
router.get('/slack/auth-url', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new AppError('Slack integration not configured', 500);
  }

  const redirectUri = process.env.SLACK_REDIRECT_URI
    || `${req.protocol}://${req.get('host')}/api/integrations/slack/callback`;

  const scopes = 'incoming-webhook,chat:write';
  const authorizeUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${req.userId}`;

  res.json({ success: true, data: { authUrl: authorizeUrl } });
}));

router.get('/slack/callback', asyncHandler(async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) {
    return res.status(400).send('Missing authorization code');
  }

  const redirectUri = process.env.SLACK_REDIRECT_URI
    || `${req.protocol}://${req.get('host')}/api/integrations/slack/callback`;

  const axios = require('axios');
  const tokenRes = await axios.post('https://slack.com/api/oauth.v2.access', null, {
    params: {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri
    }
  });

  if (!tokenRes.data.ok) {
    throw new AppError(`Slack auth failed: ${tokenRes.data.error}`, 400);
  }

  await integrationService.saveSlackTokens(userId, tokenRes.data);

  const webAppUrl = process.env.WEB_APP_URL || 'https://scribeai.app';
  res.redirect(`${webAppUrl}/settings?integration=slack&status=connected`);
}));

// Share to Slack
router.post('/slack/share/:noteId', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const result = await integrationService.shareToSlack(req.userId, req.params.noteId);
  res.json({ success: true, data: result });
}));

// ============================================
// Zapier Webhooks
// ============================================
router.post('/webhooks', authenticate, requirePremiumForIntegration, asyncHandler(async (req, res) => {
  const { webhookUrl, events } = req.body;
  if (!webhookUrl) throw new AppError('webhookUrl is required', 400);

  const webhook = await integrationService.registerWebhook(
    req.userId,
    webhookUrl,
    events || ['note.created']
  );
  res.json({ success: true, data: webhook });
}));

router.delete('/webhooks/:webhookId', authenticate, asyncHandler(async (req, res) => {
  await integrationService.deleteWebhook(req.userId, req.params.webhookId);
  res.json({ success: true });
}));

module.exports = router;
