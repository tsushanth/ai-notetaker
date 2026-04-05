const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const crypto = require('crypto');

class ShareService {
  /**
   * Create a shareable link for a note
   * @param {string} userId - Owner's user ID
   * @param {string} noteId - Note to share
   * @param {object} options - Share options
   * @returns {{ shareId: string, shareUrl: string, expiresAt: string|null }}
   */
  async createShareLink(userId, noteId, options = {}) {
    const { expiresInDays = null, allowComments = false } = options;

    // Verify note ownership
    const { data: note, error: noteErr } = await supabaseAdmin
      .from('notes')
      .select('id, title, user_id')
      .eq('id', noteId)
      .eq('user_id', userId)
      .single();

    if (noteErr || !note) {
      throw new AppError('Note not found', 404);
    }

    // Check for existing active share
    const { data: existing } = await supabaseAdmin
      .from('shared_notes')
      .select('id, share_token')
      .eq('note_id', noteId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .single();

    if (existing) {
      const shareUrl = `${process.env.WEB_APP_URL || 'https://scribeai.app'}/shared/${existing.share_token}`;
      return { shareId: existing.id, shareToken: existing.share_token, shareUrl };
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data: share, error } = await supabaseAdmin
      .from('shared_notes')
      .insert({
        note_id: noteId,
        user_id: userId,
        share_token: shareToken,
        is_active: true,
        allow_comments: allowComments,
        expires_at: expiresAt,
        view_count: 0
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create share link', { error: error.message, noteId, userId });
      throw new AppError('Failed to create share link', 500);
    }

    const shareUrl = `${process.env.WEB_APP_URL || 'https://scribeai.app'}/shared/${shareToken}`;

    logger.info('Share link created', { noteId, shareToken, userId });

    return { shareId: share.id, shareToken, shareUrl, expiresAt };
  }

  /**
   * Get a shared note by its token (public — no auth required)
   */
  async getSharedNote(shareToken) {
    const { data: share, error } = await supabaseAdmin
      .from('shared_notes')
      .select(`
        id, note_id, is_active, expires_at, view_count, allow_comments, created_at
      `)
      .eq('share_token', shareToken)
      .eq('is_active', true)
      .single();

    if (error || !share) {
      throw new AppError('Shared note not found or link has expired', 404);
    }

    // Check expiry
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      throw new AppError('This share link has expired', 410);
    }

    // Fetch the note content
    const { data: note, error: noteErr } = await supabaseAdmin
      .from('notes')
      .select('id, title, content, formatted_content, formatting_status, source_type, created_at')
      .eq('id', share.note_id)
      .single();

    if (noteErr || !note) {
      throw new AppError('Note no longer exists', 404);
    }

    // Increment view count
    await supabaseAdmin
      .from('shared_notes')
      .update({ view_count: (share.view_count || 0) + 1 })
      .eq('id', share.id);

    return {
      note: {
        title: note.title,
        content: note.formatting_status === 'completed' && note.formatted_content
          ? note.formatted_content
          : note.content,
        sourceType: note.source_type,
        createdAt: note.created_at
      },
      share: {
        viewCount: (share.view_count || 0) + 1,
        createdAt: share.created_at,
        allowComments: share.allow_comments
      }
    };
  }

  /**
   * Revoke a share link
   */
  async revokeShareLink(userId, shareId) {
    const { error } = await supabaseAdmin
      .from('shared_notes')
      .update({ is_active: false })
      .eq('id', shareId)
      .eq('user_id', userId);

    if (error) {
      throw new AppError('Failed to revoke share link', 500);
    }

    logger.info('Share link revoked', { shareId, userId });
  }

  /**
   * Get all shares for a user
   */
  async getUserShares(userId) {
    const { data, error } = await supabaseAdmin
      .from('shared_notes')
      .select(`
        id, note_id, share_token, is_active, view_count, created_at, expires_at
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError('Failed to fetch shares', 500);
    }

    return (data || []).map(s => ({
      ...s,
      shareUrl: `${process.env.WEB_APP_URL || 'https://scribeai.app'}/shared/${s.share_token}`
    }));
  }
}

module.exports = new ShareService();
