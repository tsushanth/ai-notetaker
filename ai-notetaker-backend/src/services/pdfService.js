const pdfParse = require('pdf-parse');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');

class PDFService {
  /**
   * Process a PDF file and create a note
   */
  async processPDF(userId, file, title, sourceType = 'pdf') {
    try {
      // Extract text from PDF
      const pdfData = await pdfParse(file.buffer);
      const extractedText = pdfData.text;

      if (!extractedText || extractedText.trim().length === 0) {
        throw new AppError('Could not extract text from PDF', 400);
      }

      // Upload PDF to storage
      const uploadResult = await storageService.uploadFile(userId, file, 'pdfs');

      // Create note with extracted content
      const note = await noteService.createNote(userId, {
        title: title || file.originalname || 'PDF Document',
        content: extractedText,
        source_type: sourceType,
        source_url: uploadResult.url,
        metadata: {
          file_path: uploadResult.path,
          page_count: pdfData.numpages,
          file_size: file.size,
          original_filename: file.originalname
        }
      });

      logger.info('PDF processed', { 
        userId, 
        noteId: note.id, 
        pageCount: pdfData.numpages,
        textLength: extractedText.length 
      });

      return {
        note,
        stats: {
          pages: pdfData.numpages,
          characters: extractedText.length,
          words: extractedText.split(/\s+/).length
        }
      };

    } catch (error) {
      logger.error('Error processing PDF', { error: error.message, userId });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process PDF', 500);
    }
  }

  /**
   * Extract images from PDF (advanced feature - requires additional libraries)
   */
  async extractImagesFromPDF(userId, file) {
    // This would require additional libraries like pdf2pic or pdf-lib
    // Implementation left for future enhancement
    throw new AppError('Image extraction not yet implemented', 501);
  }

  /**
   * Process multiple PDFs in batch
   */
  async processPDFBatch(userId, files) {
    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        const result = await this.processPDF(userId, file);
        results.push(result);
      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      summary: {
        total: files.length,
        successful: results.length,
        failed: errors.length
      }
    };
  }
}

module.exports = new PDFService();
