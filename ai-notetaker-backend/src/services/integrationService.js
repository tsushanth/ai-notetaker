const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const axios = require('axios');

class IntegrationService {
  // ============================================
  // Google Drive
  // ============================================

  /**
   * Store OAuth tokens for a user's Google Drive connection
   */
  async saveGoogleDriveTokens(userId, tokens) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .upsert({
        user_id: userId,
        provider: 'google_drive',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' })
      .select()
      .single();

    if (error) {
      logger.error('Failed to save Google Drive tokens', { error: error.message, userId });
      throw new AppError('Failed to connect Google Drive', 500);
    }
    return data;
  }

  /**
   * Get a user's Google Drive access token, refreshing if needed
   */
  async getGoogleDriveToken(userId) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google_drive')
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new AppError('Google Drive not connected. Please connect in settings.', 400);
    }

    // Check if token is expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      if (!data.refresh_token) {
        throw new AppError('Google Drive session expired. Please reconnect.', 401);
      }
      // Refresh the token
      return this._refreshGoogleToken(userId, data.refresh_token);
    }

    return data.access_token;
  }

  async _refreshGoogleToken(userId, refreshToken) {
    try {
      const { OAuth2Client } = require('google-auth-library');
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await oauth2Client.refreshAccessToken();

      await this.saveGoogleDriveTokens(userId, credentials);
      return credentials.access_token;
    } catch (error) {
      logger.error('Failed to refresh Google token', { error: error.message, userId });
      throw new AppError('Failed to refresh Google Drive connection', 401);
    }
  }

  /**
   * Export a note to Google Drive as a document
   */
  async exportToGoogleDrive(userId, noteId) {
    const accessToken = await this.getGoogleDriveToken(userId);
    const note = await noteService.getNoteById(userId, noteId);
    if (!note) throw new AppError('Note not found', 404);

    const content = note.formatted_content || note.content || '';
    const title = note.title || 'Scribe AI Note';

    // Create a Google Doc via Drive API
    const metadata = {
      name: `${title} - Scribe AI`,
      mimeType: 'application/vnd.google-apps.document'
    };

    // Use multipart upload: metadata + content
    const boundary = 'scribeai_boundary';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      `${title}\n\n${content}\n\n---\nCreated with Scribe AI`,
      `--${boundary}--`
    ].join('\r\n');

    const response = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      body,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        }
      }
    );

    logger.info('Note exported to Google Drive', { userId, noteId, fileId: response.data.id });

    return {
      fileId: response.data.id,
      fileName: response.data.name,
      webViewLink: `https://docs.google.com/document/d/${response.data.id}/edit`
    };
  }

  // ============================================
  // Notion
  // ============================================

  /**
   * Store Notion OAuth tokens
   */
  async saveNotionTokens(userId, tokens) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .upsert({
        user_id: userId,
        provider: 'notion',
        access_token: tokens.access_token,
        workspace_id: tokens.workspace_id || null,
        metadata: {
          workspace_name: tokens.workspace_name,
          bot_id: tokens.bot_id
        },
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' })
      .select()
      .single();

    if (error) {
      logger.error('Failed to save Notion tokens', { error: error.message, userId });
      throw new AppError('Failed to connect Notion', 500);
    }
    return data;
  }

  /**
   * Get a user's Notion access token
   */
  async getNotionToken(userId) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'notion')
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new AppError('Notion not connected. Please connect in settings.', 400);
    }

    return data.access_token;
  }

  /**
   * Export a note to Notion as a page
   */
  async exportToNotion(userId, noteId, parentPageId = null) {
    const accessToken = await this.getNotionToken(userId);
    const note = await noteService.getNoteById(userId, noteId);
    if (!note) throw new AppError('Note not found', 404);

    const content = note.formatted_content || note.content || '';
    const title = note.title || 'Scribe AI Note';

    // Convert content to Notion blocks (simple paragraph splitting)
    const blocks = this._contentToNotionBlocks(content);

    const pageData = {
      parent: parentPageId
        ? { page_id: parentPageId }
        : { type: 'page_id', page_id: parentPageId }, // fallback handled below
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children: [
        // Source metadata callout
        {
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: [{ text: { content: `Source: ${this._formatSourceType(note.source_type)} • Created with Scribe AI` } }],
            icon: { emoji: '📝' }
          }
        },
        { object: 'block', type: 'divider', divider: {} },
        ...blocks
      ]
    };

    // If no parent page, try to find or create a "Scribe AI" page
    if (!parentPageId) {
      const targetPage = await this._getOrCreateNotionRoot(accessToken);
      pageData.parent = { page_id: targetPage };
    }

    const response = await axios.post('https://api.notion.com/v1/pages', pageData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    });

    logger.info('Note exported to Notion', { userId, noteId, pageId: response.data.id });

    return {
      pageId: response.data.id,
      url: response.data.url
    };
  }

  /**
   * Find or create a root "Scribe AI Notes" page in Notion
   */
  async _getOrCreateNotionRoot(accessToken) {
    // Search for existing Scribe AI root page
    const searchRes = await axios.post('https://api.notion.com/v1/search', {
      query: 'Scribe AI Notes',
      filter: { property: 'object', value: 'page' }
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    const existing = searchRes.data.results?.find(p =>
      p.properties?.title?.title?.[0]?.text?.content === 'Scribe AI Notes'
    );

    if (existing) return existing.id;

    // Create the root page (at workspace level — requires a parent)
    // Use the first accessible page as parent
    const pagesRes = await axios.post('https://api.notion.com/v1/search', {
      filter: { property: 'object', value: 'page' },
      page_size: 1
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    // If no pages found, we can't create — tell user to specify
    if (!pagesRes.data.results?.length) {
      throw new AppError('No accessible Notion pages found. Grant access to at least one page.', 400);
    }

    // Create under the first available parent
    const parentId = pagesRes.data.results[0].id;
    const newPage = await axios.post('https://api.notion.com/v1/pages', {
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ text: { content: 'Scribe AI Notes' } }] }
      },
      children: [{
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: 'Notes exported from Scribe AI appear here.' } }]
        }
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28'
      }
    });

    return newPage.data.id;
  }

  /**
   * Convert markdown-ish text to Notion blocks
   */
  _contentToNotionBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Heading detection
      if (trimmed.startsWith('### ')) {
        blocks.push({
          object: 'block', type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: trimmed.substring(4) } }] }
        });
      } else if (trimmed.startsWith('## ')) {
        blocks.push({
          object: 'block', type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: trimmed.substring(3) } }] }
        });
      } else if (trimmed.startsWith('# ')) {
        blocks.push({
          object: 'block', type: 'heading_1',
          heading_1: { rich_text: [{ text: { content: trimmed.substring(2) } }] }
        });
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        blocks.push({
          object: 'block', type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ text: { content: trimmed.substring(2) } }] }
        });
      } else if (/^\d+\.\s/.test(trimmed)) {
        blocks.push({
          object: 'block', type: 'numbered_list_item',
          numbered_list_item: { rich_text: [{ text: { content: trimmed.replace(/^\d+\.\s/, '') } }] }
        });
      } else if (trimmed.startsWith('> ')) {
        blocks.push({
          object: 'block', type: 'quote',
          quote: { rich_text: [{ text: { content: trimmed.substring(2) } }] }
        });
      } else if (trimmed === '---' || trimmed === '***') {
        blocks.push({ object: 'block', type: 'divider', divider: {} });
      } else {
        // Notion has a 2000 char limit per rich_text segment
        const chunks = trimmed.match(/.{1,2000}/gs) || [trimmed];
        blocks.push({
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: chunks.map(c => ({ text: { content: c } })) }
        });
      }

      // Notion API has a limit of 100 blocks per request
      if (blocks.length >= 98) break;
    }

    return blocks;
  }

  // ============================================
  // Slack
  // ============================================

  /**
   * Store Slack OAuth tokens
   */
  async saveSlackTokens(userId, tokens) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .upsert({
        user_id: userId,
        provider: 'slack',
        access_token: tokens.access_token,
        metadata: {
          team_id: tokens.team?.id,
          team_name: tokens.team?.name,
          channel: tokens.incoming_webhook?.channel,
          webhook_url: tokens.incoming_webhook?.url
        },
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' })
      .select()
      .single();

    if (error) {
      logger.error('Failed to save Slack tokens', { error: error.message, userId });
      throw new AppError('Failed to connect Slack', 500);
    }
    return data;
  }

  /**
   * Share a note summary to Slack
   */
  async shareToSlack(userId, noteId, channelOverride = null) {
    const { data: integration, error } = await supabaseAdmin
      .from('user_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'slack')
      .eq('is_active', true)
      .single();

    if (error || !integration) {
      throw new AppError('Slack not connected. Please connect in settings.', 400);
    }

    const note = await noteService.getNoteById(userId, noteId);
    if (!note) throw new AppError('Note not found', 404);

    const content = note.formatted_content || note.content || '';
    const preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');

    const webhookUrl = integration.metadata?.webhook_url;
    if (!webhookUrl) {
      throw new AppError('Slack webhook not configured. Please reconnect Slack.', 400);
    }

    const message = {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `📝 ${note.title}`, emoji: true }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: preview }
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Source: ${this._formatSourceType(note.source_type)} • Shared via *Scribe AI*` }
          ]
        }
      ]
    };

    await axios.post(webhookUrl, message);

    logger.info('Note shared to Slack', { userId, noteId });

    return { success: true };
  }

  // ============================================
  // Zapier / Webhooks
  // ============================================

  /**
   * Register a webhook URL for a user (Zapier catch hook)
   */
  async registerWebhook(userId, webhookUrl, events = ['note.created']) {
    const { data, error } = await supabaseAdmin
      .from('user_webhooks')
      .insert({
        user_id: userId,
        webhook_url: webhookUrl,
        events,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to register webhook', { error: error.message, userId });
      throw new AppError('Failed to register webhook', 500);
    }

    return data;
  }

  /**
   * Fire webhooks for an event
   */
  async fireWebhooks(userId, event, payload) {
    const { data: hooks } = await supabaseAdmin
      .from('user_webhooks')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .contains('events', [event]);

    if (!hooks || hooks.length === 0) return;

    const webhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data: payload
    };

    // Fire all webhooks in parallel, don't wait
    for (const hook of hooks) {
      axios.post(hook.webhook_url, webhookPayload, { timeout: 5000 })
        .then(() => {
          logger.debug('Webhook delivered', { webhookId: hook.id, event });
        })
        .catch(err => {
          logger.warn('Webhook delivery failed', { webhookId: hook.id, event, error: err.message });
        });
    }
  }

  /**
   * Remove a webhook
   */
  async deleteWebhook(userId, webhookId) {
    const { error } = await supabaseAdmin
      .from('user_webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('user_id', userId);

    if (error) {
      throw new AppError('Failed to delete webhook', 500);
    }
  }

  /**
   * Get user's connected integrations
   */
  async getConnectedIntegrations(userId) {
    const { data, error } = await supabaseAdmin
      .from('user_integrations')
      .select('provider, is_active, metadata, updated_at')
      .eq('user_id', userId)
      .eq('is_active', true);

    return (data || []).map(i => ({
      provider: i.provider,
      connected: true,
      metadata: {
        workspace: i.metadata?.workspace_name || i.metadata?.team_name || null,
        channel: i.metadata?.channel || null
      },
      connectedAt: i.updated_at
    }));
  }

  /**
   * Disconnect an integration
   */
  async disconnectIntegration(userId, provider) {
    const { error } = await supabaseAdmin
      .from('user_integrations')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('provider', provider);

    if (error) {
      throw new AppError(`Failed to disconnect ${provider}`, 500);
    }
    logger.info('Integration disconnected', { userId, provider });
  }

  _formatSourceType(type) {
    const map = {
      recording: 'Audio Recording',
      pdf: 'PDF Upload',
      video: 'YouTube Video',
      scan: 'Scanned Document',
      upload: 'File Upload',
      meeting: 'Meeting Transcription'
    };
    return map[type] || type || 'Note';
  }
}

module.exports = new IntegrationService();
