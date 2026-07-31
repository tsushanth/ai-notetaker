const { anthropic, MODELS } = require('../config/openai');
const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');

/**
 * Maximum characters to format at once
 */
const MAX_FORMAT_CHARS = 100000;

/**
 * Formatting Service - Transforms raw notes into well-structured markdown
 */
class FormattingService {

  /**
   * Format raw note content into structured markdown
   * @param {string} rawContent - The raw note content
   * @param {string} sourceType - The source type (pdf, video, recording, etc.)
   * @param {string} title - The note title for context
   * @returns {Promise<string>} - Formatted markdown content
   */
  async formatNoteContent(rawContent, sourceType = 'manual', title = '') {
    if (!rawContent || rawContent.trim().length === 0) {
      return rawContent;
    }

    // For very short content, minimal formatting
    if (rawContent.length < 200) {
      return this.basicFormat(rawContent);
    }

    try {
      // Truncate if too long
      const contentToFormat = rawContent.length > MAX_FORMAT_CHARS
        ? rawContent.substring(0, MAX_FORMAT_CHARS) + '\n\n[Content truncated for formatting...]'
        : rawContent;

      const prompt = this.buildFormattingPrompt(contentToFormat, sourceType, title);

      const systemPrompt = `You are an expert note formatter. Transform raw notes into beautifully organized, highly readable content with rich formatting.

FORMATTING RULES:

HEADERS & SECTIONS:
• Use ## for main sections with relevant emojis (e.g., "## 📚 Key Concepts", "## 🚀 Overview", "## 🔧 Tools", "## 🎯 Key Points", "## 💡 Insights")
• Use ### for subsections
• Choose emojis that match the section content (📝 for notes, 🎓 for education, 💼 for business, 🔬 for science, etc.)

LISTS & BULLET POINTS:
• Use bullet points (• ) for key points and lists
• Use numbered lists (1. 2. 3.) ONLY for sequential steps or ranked items
• Indent sub-points with two spaces for nested items
• Keep bullets concise - aim for 1-2 lines each

DEFINITIONS & KEY TERMS:
• Format definitions as: "Definition: *Term* – explanation of the term"
• Use **bold** for important terms and concepts - these will appear highlighted in purple
• Use *italics* for emphasized words, titles, or terms being defined

STRUCTURE & ORGANIZATION:
• Start with a "Brief Overview" or "Key Points" section summarizing the main takeaways
• Use --- horizontal dividers to separate major sections
• Group related information together under clear headers
• Create a logical flow: Overview → Main Content → Details → Summary

TABLES (when appropriate):
• Use markdown tables for comparisons, categorizations, or structured data:
  | Column 1 | Column 2 | Column 3 |
  |----------|----------|----------|
  | Data 1   | Data 2   | Data 3   |

BLOCKQUOTES:
• Use > for examples, quotes, or highlighted insights
• Keep blockquotes brief and impactful

IMPORTANT:
• Keep ALL original information - DO NOT add or remove facts
• Make content scannable and easy to read
• Use white space generously between sections
• The output will be displayed on mobile, so keep lines readable

OUTPUT: Return ONLY the formatted markdown content. No explanations or meta-commentary.`;

      const completion = await anthropic.messages.create({
        model: MODELS.GPT4_MINI,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 16000
      });

      const formattedContent = completion.content[0].text;

      logger.info('Note formatted successfully', {
        originalLength: rawContent.length,
        formattedLength: formattedContent.length,
        sourceType
      });

      return formattedContent;

    } catch (error) {
      logger.error('Error formatting note', { error: error.message });
      // Fall back to basic formatting on error
      return this.basicFormat(rawContent);
    }
  }

  /**
   * Build the formatting prompt based on source type
   */
  buildFormattingPrompt(content, sourceType, title) {
    let context = '';

    switch (sourceType) {
      case 'video':
        context = 'These are notes from a YouTube video transcript. Look for natural topic changes and format accordingly.';
        break;
      case 'recording':
        context = 'These are notes from an audio recording/lecture. Organize by topics discussed and highlight key points.';
        break;
      case 'pdf':
        context = 'These are notes extracted from a PDF document. Preserve any existing structure and enhance readability.';
        break;
      case 'scan':
        context = 'These are notes from a scanned document. Clean up any OCR artifacts and organize logically.';
        break;
      default:
        context = 'These are raw notes. Organize them into a clear, structured format.';
    }

    return `${context}

Title: ${title || 'Untitled Notes'}

Please format the following raw notes into well-organized markdown:

---
${content}
---`;
  }

  /**
   * Basic formatting for short content or fallback
   */
  basicFormat(content) {
    // Split into paragraphs and add proper spacing
    const paragraphs = content.split(/\n\s*\n/);

    return paragraphs
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .join('\n\n');
  }

  /**
   * Format a single note by ID
   */
  async formatNoteById(noteId) {
    try {
      // Get the note
      const { data: note, error: fetchError } = await supabaseAdmin
        .from('notes')
        .select('id, content, source_type, title')
        .eq('id', noteId)
        .single();

      if (fetchError || !note) {
        throw new Error(`Note not found: ${noteId}`);
      }

      // Update status to processing
      await supabaseAdmin
        .from('notes')
        .update({ formatting_status: 'processing' })
        .eq('id', noteId);

      // Format the content
      const formattedContent = await this.formatNoteContent(
        note.content,
        note.source_type,
        note.title
      );

      // Save the formatted content
      const { error: updateError } = await supabaseAdmin
        .from('notes')
        .update({
          formatted_content: formattedContent,
          formatting_status: 'completed'
        })
        .eq('id', noteId);

      if (updateError) {
        throw updateError;
      }

      logger.info('Note formatted and saved', { noteId });
      return { success: true, noteId, formattedContent };

    } catch (error) {
      // Update status to failed
      await supabaseAdmin
        .from('notes')
        .update({ formatting_status: 'failed' })
        .eq('id', noteId);

      logger.error('Failed to format note', { noteId, error: error.message });
      return { success: false, noteId, error: error.message };
    }
  }

  /**
   * Batch format unformatted notes
   * @param {number} limit - Maximum notes to format in this batch
   * @returns {Promise<Object>} - Results of the batch operation
   */
  async formatUnformattedNotes(limit = 10) {
    try {
      // Get unformatted notes
      const { data: notes, error: fetchError } = await supabaseAdmin
        .from('notes')
        .select('id, content, source_type, title')
        .or('formatted_content.is.null,formatting_status.eq.pending,formatting_status.eq.failed')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fetchError) {
        throw fetchError;
      }

      if (!notes || notes.length === 0) {
        return { success: true, formatted: 0, message: 'No notes to format' };
      }

      logger.info(`Formatting ${notes.length} notes`);

      const results = {
        success: true,
        total: notes.length,
        formatted: 0,
        failed: 0,
        errors: []
      };

      // Format notes sequentially to avoid rate limits
      for (const note of notes) {
        const result = await this.formatNoteById(note.id);
        if (result.success) {
          results.formatted++;
        } else {
          results.failed++;
          results.errors.push({ noteId: note.id, error: result.error });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info('Batch formatting complete', results);
      return results;

    } catch (error) {
      logger.error('Batch formatting failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get formatting statistics
   */
  async getFormattingStats() {
    try {
      const { data, error } = await supabaseAdmin
        .from('notes')
        .select('formatting_status', { count: 'exact' });

      if (error) throw error;

      const stats = {
        total: data.length,
        completed: data.filter(n => n.formatting_status === 'completed').length,
        pending: data.filter(n => n.formatting_status === 'pending' || !n.formatting_status).length,
        processing: data.filter(n => n.formatting_status === 'processing').length,
        failed: data.filter(n => n.formatting_status === 'failed').length
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get formatting stats', { error: error.message });
      throw error;
    }
  }
}

module.exports = new FormattingService();
