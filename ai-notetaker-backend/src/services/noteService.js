const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

class NoteService {
  /**
   * Create a new note
   * @param {string} userId - User ID
   * @param {object} noteData - Note data
   * @param {object} options - Options
   * @param {boolean} options.skipFormatting - Skip async formatting (default: false)
   */
  async createNote(userId, noteData, options = {}) {
    const { skipFormatting = false } = options;

    try {
      const { data, error } = await supabaseAdmin
        .from('notes')
        .insert({
          user_id: userId,
          ...noteData
        })
        .select()
        .single();

      if (error) throw error;

      logger.info('Note created', { userId, noteId: data.id });

      // Trigger async formatting unless skipped
      if (!skipFormatting && noteData.content && noteData.content.length >= 200) {
        this.triggerFormatting(data.id).catch(err => {
          logger.error('Background formatting failed', { noteId: data.id, error: err.message });
        });
      }

      return data;
    } catch (error) {
      logger.error('Error creating note', { error: error.message, userId });
      throw new AppError('Failed to create note', 500);
    }
  }

  /**
   * Trigger async formatting for a note
   */
  async triggerFormatting(noteId) {
    // Lazy import to avoid circular dependencies
    const formattingService = require('./formattingService');
    return formattingService.formatNoteById(noteId);
  }

  /**
   * Get all notes for a user with pagination and filtering
   */
  async getNotes(userId, options = {}) {
    const { page = 1, limit = 20, sort = 'created_at', source_type } = options;
    const offset = (page - 1) * limit;

    try {
      let query = supabaseAdmin
        .from('notes')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);

      // Filter by source type if provided
      if (source_type) {
        query = query.eq('source_type', source_type);
      }

      // Sort
      const sortOrder = sort.startsWith('-') ? 'asc' : 'desc';
      const sortField = sort.replace('-', '');
      query = query.order(sortField, { ascending: sortOrder === 'asc' });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        notes: data,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('Error fetching notes', { error: error.message, userId });
      throw new AppError('Failed to fetch notes', 500);
    }
  }

  /**
   * Get a specific note by ID
   */
  async getNoteById(userId, noteId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('notes')
        .select(`
          *,
          recordings (*),
          ai_content (*)
        `)
        .eq('id', noteId)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.error('Error fetching note', { error: error.message, userId, noteId });
      throw new AppError('Failed to fetch note', 500);
    }
  }

  /**
   * Update a note
   */
  async updateNote(userId, noteId, updates) {
    try {
      const { data, error } = await supabaseAdmin
        .from('notes')
        .update(updates)
        .eq('id', noteId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        throw error;
      }

      logger.info('Note updated', { userId, noteId });
      return data;
    } catch (error) {
      logger.error('Error updating note', { error: error.message, userId, noteId });
      throw new AppError('Failed to update note', 500);
    }
  }

  /**
   * Delete a note
   */
  async deleteNote(userId, noteId) {
    try {
      const { error } = await supabaseAdmin
        .from('notes')
        .delete()
        .eq('id', noteId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info('Note deleted', { userId, noteId });
      return true;
    } catch (error) {
      logger.error('Error deleting note', { error: error.message, userId, noteId });
      throw new AppError('Failed to delete note', 500);
    }
  }

  /**
   * Search notes by content
   */
  async searchNotes(userId, searchQuery) {
    try {
      const { data, error } = await supabaseAdmin
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .or(`title.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return data;
    } catch (error) {
      logger.error('Error searching notes', { error: error.message, userId });
      throw new AppError('Failed to search notes', 500);
    }
  }
}

module.exports = new NoteService();
