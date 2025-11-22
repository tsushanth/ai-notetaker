const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { openai, MODELS } = require('../config/openai');
const noteService = require('./noteService');
const { supabaseAdmin } = require('../config/supabase');


class ScanService {
  /**
   * Process a scanned document (PDF with extracted text)
   * @param {string} userId - User ID
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {string} filename - Original filename
   * @param {string} extractedText - OCR extracted text from client
   * @param {string} customTitle - Optional custom title
   */
  async processScannedDocument(userId, pdfBuffer, filename, extractedText, customTitle) {
    let tempPdfPath = null;

    try {
      // Validate inputs
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new AppError('No PDF file provided', 400);
      }

      if (!extractedText || extractedText.trim().length === 0) {
        throw new AppError('No extracted text provided', 400);
      }

      // Check file size (25MB limit for reasonable storage)
      const fileSizeMB = pdfBuffer.length / (1024 * 1024);
      if (fileSizeMB > 25) {
        throw new AppError('PDF file too large (max 25MB)', 400);
      }

      logger.info('Processing scanned document', { 
        userId, 
        filename,
        fileSizeMB: fileSizeMB.toFixed(2),
        textLength: extractedText.length
      });

      // Generate unique filename for supabaseAdmin storage
      const timestamp = Date.now();
      const sanitizedFilename = this.sanitizeFilename(filename);
      const storagePath = `scans/${userId}/${timestamp}_${sanitizedFilename}`;

      // Upload PDF to supabaseAdmin Storage
      logger.info('Uploading PDF to supabaseAdmin', { storagePath });
      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('documents') // Your supabaseAdmin bucket name
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        logger.error('supabaseAdmin upload error', { error: uploadError });
        throw new AppError('Failed to upload PDF to storage', 500);
      }

      // Get public URL for the uploaded file
      const { data: urlData } = supabaseAdmin.storage
        .from('documents')
        .getPublicUrl(storagePath);

      const pdfUrl = urlData.publicUrl;
      logger.info('PDF uploaded successfully', { pdfUrl });

      // Optional: Enhance extracted text with AI (if you want to improve OCR results)
      let finalText = extractedText;
      if (process.env.ENHANCE_OCR_WITH_AI === 'true') {
        try {
          logger.info('Enhancing OCR text with AI');
          finalText = await this.enhanceOCRText(extractedText);
        } catch (error) {
          logger.warn('Failed to enhance OCR text, using original', { error: error.message });
          // Continue with original text if enhancement fails
        }
      }

      // Generate title if not provided
      const documentTitle = customTitle || this.generateTitle(finalText, filename);

      // Optional: Extract metadata from text (dates, amounts, etc.)
      const metadata = await this.extractMetadata(finalText);

      // Create note with scanned document
      const note = await noteService.createNote(userId, {
        title: documentTitle,
        content: finalText,
        source_type: 'scan',
        source_url: pdfUrl,
        metadata: {
          original_filename: filename,
          file_size_mb: fileSizeMB,
          page_count: this.estimatePageCount(extractedText),
          scan_date: new Date().toISOString(),
          storage_path: storagePath,
          word_count: this.countWords(finalText),
          character_count: finalText.length,
          ...metadata
        }
      });

      logger.info('Scanned document processed successfully', { 
        userId, 
        noteId: note.id,
        pdfUrl,
        textLength: finalText.length
      });

      return {
        note,
        stats: {
          fileSize: fileSizeMB,
          wordCount: this.countWords(finalText),
          characterCount: finalText.length,
          pageCount: this.estimatePageCount(extractedText)
        },
        pdfUrl
      };

    } catch (error) {
      // Clean up temp file if exists
      if (tempPdfPath) {
        await fs.unlink(tempPdfPath).catch(() => {});
      }

      logger.error('Error processing scanned document', { 
        error: error.message, 
        stack: error.stack,
        userId 
      });

      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process scanned document', 500);
    }
  }

  /**
   * Optional: Enhance OCR text using AI to fix common OCR errors
   */
  async enhanceOCRText(text) {
    try {
      const response = await openai.chat.completions.create({
        model: MODELS.GPT_4O_MINI,
        messages: [
          {
            role: 'system',
            content: 'You are an OCR text correction assistant. Fix spelling errors, formatting issues, and improve readability while preserving the original meaning and structure. Do not add any content that was not in the original text.'
          },
          {
            role: 'user',
            content: `Please correct any OCR errors in this text while preserving its structure:\n\n${text}`
          }
        ],
        max_tokens: 4000,
        temperature: 0.3
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Error enhancing OCR text', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract metadata from scanned text (dates, amounts, categories)
   */
  async extractMetadata(text) {
    const metadata = {};

    try {
      // Extract dates
      const datePattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi;
      const dates = text.match(datePattern);
      if (dates && dates.length > 0) {
        metadata.dates = dates.slice(0, 5); // Limit to first 5 dates
      }

      // Extract money amounts
      const moneyPattern = /\$\s*\d+(?:,\d{3})*(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|dollars?)/gi;
      const amounts = text.match(moneyPattern);
      if (amounts && amounts.length > 0) {
        metadata.amounts = amounts.slice(0, 5);
      }

      // Extract email addresses
      const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = text.match(emailPattern);
      if (emails && emails.length > 0) {
        metadata.emails = emails.slice(0, 3);
      }

      // Extract phone numbers
      const phonePattern = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
      const phones = text.match(phonePattern);
      if (phones && phones.length > 0) {
        metadata.phones = phones.slice(0, 3);
      }

      // Detect document type based on keywords
      metadata.document_type = this.detectDocumentType(text);

    } catch (error) {
      logger.warn('Error extracting metadata', { error: error.message });
    }

    return metadata;
  }

  /**
   * Detect document type based on content
   */
  detectDocumentType(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('invoice') || lowerText.includes('bill to')) {
      return 'invoice';
    } else if (lowerText.includes('receipt') || lowerText.includes('total due')) {
      return 'receipt';
    } else if (lowerText.includes('contract') || lowerText.includes('agreement')) {
      return 'contract';
    } else if (lowerText.includes('resume') || lowerText.includes('curriculum vitae')) {
      return 'resume';
    } else if (lowerText.includes('prescription') || lowerText.includes('medication')) {
      return 'prescription';
    } else if (lowerText.includes('letter') || lowerText.includes('dear')) {
      return 'letter';
    }

    return 'document';
  }

  /**
   * Generate a title from the text content
   */
  generateTitle(text, filename) {
    // Try to use first meaningful line as title
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      // If first line is reasonable length, use it
      if (firstLine.length >= 10 && firstLine.length <= 100) {
        return firstLine.substring(0, 100);
      }
    }

    // Fallback to filename or date-based title
    const date = new Date().toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    
    if (filename && filename !== 'scan.pdf') {
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
      return `${nameWithoutExt} - ${date}`;
    }

    return `Scanned Document - ${date}`;
  }

  /**
   * Sanitize filename for storage
   */
  sanitizeFilename(filename) {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_{2,}/g, '_')
      .toLowerCase();
  }

  /**
   * Estimate page count based on text length
   * Assumes ~500 words per page
   */
  estimatePageCount(text) {
    const wordCount = this.countWords(text);
    return Math.max(1, Math.ceil(wordCount / 500));
  }

  /**
   * Count words in text
   */
  countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Delete scanned document and associated PDF from storage
   */
  async deleteScannedDocument(userId, noteId) {
    try {
      // Get note to find storage path
      const note = await noteService.getNote(userId, noteId);
      
      if (note.source_type !== 'scan') {
        throw new AppError('Note is not a scanned document', 400);
      }

      const storagePath = note.metadata?.storage_path;
      
      if (storagePath) {
        // Delete from supabaseAdmin storage
        const { error } = await supabaseAdmin.storage
          .from('documents')
          .remove([storagePath]);

        if (error) {
          logger.warn('Failed to delete PDF from storage', { 
            error: error.message,
            storagePath 
          });
        } else {
          logger.info('PDF deleted from storage', { storagePath });
        }
      }

      // Delete note from database
      await noteService.deleteNote(userId, noteId);

      logger.info('Scanned document deleted', { userId, noteId });

      return { success: true };

    } catch (error) {
      logger.error('Error deleting scanned document', { 
        error: error.message,
        userId,
        noteId 
      });

      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to delete scanned document', 500);
    }
  }

  /**
   * Get scanned document PDF URL
   */
  async getDocumentUrl(userId, noteId) {
    try {
      const note = await noteService.getNote(userId, noteId);
      
      if (note.source_type !== 'scan') {
        throw new AppError('Note is not a scanned document', 400);
      }

      return {
        url: note.source_url,
        metadata: note.metadata
      };

    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to get document URL', 500);
    }
  }

  /**
   * Batch process multiple scanned pages (if client sends pages separately)
   */
  async processBatchScannedPages(userId, pages, customTitle) {
    try {
      if (!pages || pages.length === 0) {
        throw new AppError('No pages provided', 400);
      }

      logger.info('Processing batch of scanned pages', { 
        userId,
        pageCount: pages.length 
      });

      // Combine all extracted text
      const combinedText = pages
        .map((page, index) => `--- Page ${index + 1} ---\n\n${page.extractedText}`)
        .join('\n\n');

      // Merge all PDFs if multiple pages
      // Note: You might want to use a PDF library like pdf-lib for this
      // For now, we'll just use the first page's PDF
      const firstPageBuffer = pages[0].pdfBuffer;

      // Process as single document
      return await this.processScannedDocument(
        userId,
        firstPageBuffer,
        `scanned_document_${pages.length}_pages.pdf`,
        combinedText,
        customTitle
      );

    } catch (error) {
      logger.error('Error processing batch scanned pages', { 
        error: error.message,
        userId 
      });

      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process batch scanned pages', 500);
    }
  }
}

module.exports = new ScanService();