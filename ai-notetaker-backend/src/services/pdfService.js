const pdfParse = require('pdf-parse');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const storageService = require('./storageService');

class PDFService {
  /**
   * Process a PDF file and create a note (original method - uses storageService upload)
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
      const extractedText = await this.extractText(file.buffer, file.mimetype);

      if (!extractedText || extractedText.trim().length === 0) {
        throw new AppError('Could not extract text from document', 400);
      }

      // Upload PDF to storage - PASS USER TOKEN HERE
      const uploadResult = await storageService.uploadFile(
        userId, 
        file, 
        'pdfs',
        userToken
      );

      // Get page count if PDF
      let pageCount = null;
      if (file.mimetype === 'application/pdf') {
        try {
          const pdfData = await pdfParse(file.buffer);
          pageCount = pdfData.numpages;
        } catch (e) {
          logger.warn('Could not get PDF page count', { error: e.message });
        }
      }

      // Create note with extracted content
      const note = await noteService.createNote(userId, {
        title: title || file.originalname || 'Document',
        content: extractedText,
        source_type: sourceType,
        source_url: uploadResult.url,
        metadata: {
          file_path: uploadResult.path,
          page_count: pageCount,
          file_size: file.size,
          original_filename: file.originalname
        }
      });

      logger.info('PDF processed', { 
        userId, 
        noteId: note.id, 
        pageCount,
        textLength: extractedText.length 
      });

      return {
        note,
        stats: {
          pages: pageCount,
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
   * Process a document from buffer (for signed URL flow - file already in storage)
   * @param {string} userId - User ID
   * @param {Object} file - File object with buffer, originalname, mimetype, size
   * @param {string} title - Document title
   * @param {string} sourceType - Source type (pdf, docx, pptx, txt)
   * @param {string} storagePath - Path where file is already stored in Supabase
   */
  async processFromBuffer(userId, file, title, sourceType = 'pdf', storagePath = null) {
    try {
      // Extract text based on file type
      const extractedText = await this.extractText(file.buffer, file.mimetype);

      if (!extractedText || extractedText.trim().length === 0) {
        throw new AppError('Could not extract text from document', 400);
      }

      // Get page count if PDF
      let pageCount = null;
      if (file.mimetype === 'application/pdf') {
        try {
          const pdfData = await pdfParse(file.buffer);
          pageCount = pdfData.numpages;
        } catch (e) {
          logger.warn('Could not get PDF page count', { error: e.message });
        }
      }

      // Build source URL if storage path provided
      let sourceUrl = null;
      if (storagePath) {
        // Construct Supabase storage URL
        const supabaseUrl = process.env.SUPABASE_URL;
        sourceUrl = `${supabaseUrl}/storage/v1/object/public/documents/${storagePath}`;
      }

      // Create note with extracted content
      const note = await noteService.createNote(userId, {
        title: title || file.originalname || 'Document',
        content: extractedText,
        source_type: sourceType,
        source_url: sourceUrl,
        metadata: {
          file_path: storagePath,
          page_count: pageCount,
          file_size: file.size,
          original_filename: file.originalname,
          mime_type: file.mimetype
        }
      });

      logger.info('Document processed from buffer', { 
        userId, 
        noteId: note.id, 
        sourceType,
        pageCount,
        textLength: extractedText.length 
      });

      return {
        note,
        stats: {
          pages: pageCount,
          characters: extractedText.length,
          words: extractedText.split(/\s+/).length
        }
      };

    } catch (error) {
      logger.error('Error processing document from buffer', { 
        error: error.message, 
        userId,
        sourceType
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
      throw new AppError('Failed to process document', 500);
    }
  }

  /**
   * Extract text from document buffer based on mime type
   * @param {Buffer} buffer - File buffer
   * @param {string} mimeType - File mime type
   * @returns {string} Extracted text
   */
  async extractText(buffer, mimeType) {
    try {
      // PDF
      if (mimeType === 'application/pdf') {
        const pdfData = await pdfParse(buffer);
        return pdfData.text;
      }

      // Plain text
      if (mimeType === 'text/plain') {
        return buffer.toString('utf-8');
      }

      // DOCX
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          return result.value;
        } catch (e) {
          logger.error('Mammoth not installed or failed', { error: e.message });
          throw new AppError('DOCX processing requires mammoth package. Run: npm install mammoth', 500);
        }
      }

      // PPTX - Try to extract text
      if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
          mimeType === 'application/vnd.ms-powerpoint') {
        try {
          // Try using pptx-parser or similar
          const extractedText = await this.extractPptxText(buffer);
          return extractedText;
        } catch (e) {
          logger.warn('PPTX text extraction failed, using fallback', { error: e.message });
          // Fallback: Try to parse as PDF if converted, or return placeholder
          return '[PowerPoint document - text extraction limited]';
        }
      }

      // ODP (OpenDocument Presentation)
      if (mimeType === 'application/vnd.oasis.opendocument.presentation') {
        return '[OpenDocument presentation - text extraction not yet supported]';
      }

      // Unknown type - try PDF parse as fallback
      logger.warn('Unknown mime type, attempting PDF parse', { mimeType });
      try {
        const pdfData = await pdfParse(buffer);
        return pdfData.text;
      } catch (e) {
        throw new AppError(`Unsupported file type: ${mimeType}`, 400);
      }

    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Text extraction failed', { error: error.message, mimeType });
      throw new AppError('Failed to extract text from document', 500);
    }
  }

  /**
   * Extract text from PPTX file
   * @param {Buffer} buffer - PPTX file buffer
   * @returns {string} Extracted text
   */
  async extractPptxText(buffer) {
    try {
      // Try using officegen or pptx libraries if available
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      
      let allText = [];
      
      // PPTX files contain XML slides in ppt/slides/
      const slideFiles = Object.keys(zip.files).filter(name => 
        name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
      );
      
      // Sort slides by number
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });
      
      for (const slidePath of slideFiles) {
        const content = await zip.file(slidePath).async('string');
        // Extract text from XML (simple regex approach)
        const textMatches = content.match(/<a:t>([^<]*)<\/a:t>/g);
        if (textMatches) {
          const slideText = textMatches
            .map(match => match.replace(/<\/?a:t>/g, ''))
            .join(' ');
          allText.push(slideText);
        }
      }
      
      const result = allText.join('\n\n');
      
      if (!result || result.trim().length === 0) {
        throw new Error('No text found in PPTX');
      }
      
      return result;
      
    } catch (error) {
      logger.warn('PPTX extraction with JSZip failed', { error: error.message });
      throw error;
    }
  }
}

module.exports = new PDFService();