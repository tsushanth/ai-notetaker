const pdfParse = require('pdf-parse');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');

class PDFService {
  /**
   * Process a PDF file and create a note
   * @param {string} userId - User ID
   * @param {Object} file - File object with buffer
   * @param {string} title - Optional title
   * @param {string} sourceType - Source type (default: 'pdf')
   * @param {string} userToken - User's JWT token (REQUIRED for storage)
   */
  async processPDF(userId, file, title, sourceType = 'pdf', userToken) {
    try {
      if (!userToken) {
        throw new AppError('User token required for PDF processing', 401);
      }

      // Extract text from PDF
      const pdfData = await pdfParse(file.buffer);
      const extractedText = pdfData.text;

      if (!extractedText || extractedText.trim().length === 0) {
        throw new AppError('Could not extract text from PDF', 400);
      }

      // Upload PDF to storage - PASS USER TOKEN HERE
      const uploadResult = await storageService.uploadFile(
        userId, 
        file, 
        'pdfs',
        userToken  // ← This is the critical fix!
      );

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
}

module.exports = new PDFService();