const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const { marked } = require('marked');
const noteService = require('./noteService');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');

class ExportService {
  /**
   * Generate a branded PDF from a note
   * @param {string} userId - User ID (for ownership check)
   * @param {string} noteId - Note ID
   * @returns {{ buffer: Buffer, filename: string }}
   */
  async generatePDF(userId, noteId) {
    const note = await this._fetchNote(userId, noteId);
    const content = note.formatted_content || note.content || '';
    const tokens = marked.lexer(content);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 50, right: 50 },
        info: {
          Title: note.title || 'Scribe AI Note',
          Author: 'Scribe AI',
          Creator: 'Scribe AI Export'
        }
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const safeTitle = (note.title || 'note').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 50).trim();
        resolve({ buffer, filename: `${safeTitle} - Scribe AI.pdf` });
      });
      doc.on('error', reject);

      // --- Header ---
      doc.fontSize(8).fillColor('#888888')
        .text('SCRIBE AI', 50, 25, { align: 'left' })
        .text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), { align: 'right' });

      doc.moveTo(50, 45).lineTo(545, 45).strokeColor('#E0E0E0').stroke();

      // --- Title ---
      doc.moveDown(1);
      doc.y = 60;
      doc.fontSize(22).fillColor('#1A1A1A').font('Helvetica-Bold')
        .text(note.title || 'Untitled Note', 50, doc.y, { align: 'left' });

      // --- Metadata line ---
      const metaParts = [];
      if (note.source_type) metaParts.push(this._formatSourceType(note.source_type));
      if (note.created_at) metaParts.push(new Date(note.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      metaParts.push(`${wordCount.toLocaleString()} words`);

      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#999999').font('Helvetica')
        .text(metaParts.join('  •  '));

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E8E8E8').stroke();
      doc.moveDown(1);

      // --- Body: render markdown tokens ---
      this._renderTokensToPDF(doc, tokens);

      // --- Footer ---
      const footerY = doc.page.height - 40;
      doc.fontSize(7).fillColor('#BBBBBB').font('Helvetica')
        .text('Created with Scribe AI — scribeai.app', 50, footerY, { align: 'center', width: 495 });

      doc.end();
    });
  }

  /**
   * Generate a branded DOCX from a note
   * @param {string} userId - User ID
   * @param {string} noteId - Note ID
   * @returns {{ buffer: Buffer, filename: string }}
   */
  async generateDOCX(userId, noteId) {
    const note = await this._fetchNote(userId, noteId);
    const content = note.formatted_content || note.content || '';
    const tokens = marked.lexer(content);

    const children = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: note.title || 'Untitled Note', bold: true, size: 44, font: 'Calibri' })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 }
    }));

    // Metadata
    const metaParts = [];
    if (note.source_type) metaParts.push(this._formatSourceType(note.source_type));
    if (note.created_at) metaParts.push(new Date(note.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    metaParts.push(`${wordCount.toLocaleString()} words`);

    children.push(new Paragraph({
      children: [new TextRun({ text: metaParts.join('  •  '), color: '999999', size: 18, font: 'Calibri' })],
      spacing: { after: 200 }
    }));

    // Separator
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } },
      spacing: { after: 200 }
    }));

    // Body from markdown tokens
    this._renderTokensToDOCX(children, tokens);

    // Footer branding
    children.push(new Paragraph({ spacing: { before: 400 } }));
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Created with Scribe AI', color: 'BBBBBB', size: 16, italics: true, font: 'Calibri' })],
      alignment: AlignmentType.CENTER
    }));

    const doc = new Document({
      sections: [{ children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeTitle = (note.title || 'note').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 50).trim();
    return { buffer, filename: `${safeTitle} - Scribe AI.docx` };
  }

  // ---- Private helpers ----

  async _fetchNote(userId, noteId) {
    const note = await noteService.getNoteById(userId, noteId);
    if (!note) {
      throw new AppError('Note not found', 404);
    }
    return note;
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
    return map[type] || type;
  }

  /**
   * Render marked tokens into a PDFKit document
   */
  _renderTokensToPDF(doc, tokens) {
    for (const token of tokens) {
      // Check page space before rendering
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }

      switch (token.type) {
        case 'heading': {
          const sizes = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 11, 6: 10 };
          doc.moveDown(0.8);
          doc.fontSize(sizes[token.depth] || 12).fillColor('#1A1A1A').font('Helvetica-Bold')
            .text(this._stripInlineMarkdown(token.text));
          doc.moveDown(0.3);
          break;
        }

        case 'paragraph': {
          doc.fontSize(10.5).fillColor('#333333').font('Helvetica')
            .text(this._stripInlineMarkdown(token.text), { lineGap: 3, align: 'left' });
          doc.moveDown(0.6);
          break;
        }

        case 'list': {
          this._renderListToPDF(doc, token);
          doc.moveDown(0.4);
          break;
        }

        case 'blockquote': {
          const quoteText = token.tokens
            ? token.tokens.map(t => this._stripInlineMarkdown(t.text || t.raw || '')).join('\n')
            : token.text || '';
          const savedX = doc.x;
          doc.rect(50, doc.y, 3, 14).fill('#4A90D9');
          doc.fontSize(10.5).fillColor('#555555').font('Helvetica-Oblique')
            .text(quoteText, 62, doc.y - 14, { width: 480, lineGap: 3 });
          doc.x = savedX;
          doc.moveDown(0.6);
          break;
        }

        case 'code': {
          doc.moveDown(0.3);
          const codeY = doc.y;
          doc.rect(50, codeY - 4, 495, 16 + (token.text.split('\n').length - 1) * 13)
            .fill('#F5F5F5');
          doc.fontSize(9).fillColor('#D63384').font('Courier')
            .text(token.text, 58, codeY, { width: 480 });
          doc.moveDown(0.6);
          break;
        }

        case 'hr': {
          doc.moveDown(0.4);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E0E0E0').stroke();
          doc.moveDown(0.6);
          break;
        }

        case 'space': {
          doc.moveDown(0.4);
          break;
        }

        default: {
          // Fallback: render raw text
          if (token.text || token.raw) {
            doc.fontSize(10.5).fillColor('#333333').font('Helvetica')
              .text(this._stripInlineMarkdown(token.text || token.raw), { lineGap: 3 });
            doc.moveDown(0.6);
          }
          break;
        }
      }
    }
  }

  /**
   * Render a list token to PDF (supports nesting)
   */
  _renderListToPDF(doc, listToken, depth = 0) {
    const indent = 50 + (depth * 20);
    const items = listToken.items || [];

    items.forEach((item, idx) => {
      if (doc.y > doc.page.height - 80) doc.addPage();

      const bullet = listToken.ordered ? `${idx + 1}.` : '•';
      const text = this._stripInlineMarkdown(item.text || '');

      doc.fontSize(10.5).fillColor('#333333').font('Helvetica')
        .text(`${bullet}  ${text}`, indent, doc.y, { width: 545 - indent, lineGap: 2 });
      doc.moveDown(0.2);

      // Nested lists
      if (item.tokens) {
        for (const subToken of item.tokens) {
          if (subToken.type === 'list') {
            this._renderListToPDF(doc, subToken, depth + 1);
          }
        }
      }
    });
  }

  /**
   * Render marked tokens into docx Paragraph array
   */
  _renderTokensToDOCX(children, tokens) {
    for (const token of tokens) {
      switch (token.type) {
        case 'heading': {
          const levelMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6 };
          children.push(new Paragraph({
            children: [new TextRun({ text: this._stripInlineMarkdown(token.text), bold: true, font: 'Calibri' })],
            heading: levelMap[token.depth] || HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 }
          }));
          break;
        }

        case 'paragraph': {
          children.push(new Paragraph({
            children: this._inlineTokensToDOCX(token.tokens || [{ type: 'text', text: token.text }]),
            spacing: { after: 160 }
          }));
          break;
        }

        case 'list': {
          this._renderListToDOCX(children, token);
          break;
        }

        case 'blockquote': {
          const quoteText = token.tokens
            ? token.tokens.map(t => this._stripInlineMarkdown(t.text || t.raw || '')).join('\n')
            : token.text || '';
          children.push(new Paragraph({
            children: [new TextRun({ text: quoteText, italics: true, color: '555555', font: 'Calibri' })],
            indent: { left: 720 },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: '4A90D9', space: 8 } },
            spacing: { after: 160 }
          }));
          break;
        }

        case 'code': {
          const lines = token.text.split('\n');
          for (const line of lines) {
            children.push(new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New', size: 18, color: 'D63384' })],
              shading: { type: 'clear', fill: 'F5F5F5' },
              spacing: { after: 40 }
            }));
          }
          break;
        }

        case 'hr': {
          children.push(new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' } },
            spacing: { before: 200, after: 200 }
          }));
          break;
        }

        case 'space': {
          children.push(new Paragraph({ spacing: { after: 120 } }));
          break;
        }

        default: {
          if (token.text || token.raw) {
            children.push(new Paragraph({
              children: [new TextRun({ text: this._stripInlineMarkdown(token.text || token.raw), font: 'Calibri', size: 22 })],
              spacing: { after: 160 }
            }));
          }
          break;
        }
      }
    }
  }

  /**
   * Convert inline markdown tokens to DOCX TextRun array
   */
  _inlineTokensToDOCX(tokens) {
    const runs = [];
    for (const t of tokens) {
      switch (t.type) {
        case 'strong':
          runs.push(new TextRun({ text: this._stripInlineMarkdown(t.text), bold: true, font: 'Calibri', size: 22 }));
          break;
        case 'em':
          runs.push(new TextRun({ text: this._stripInlineMarkdown(t.text), italics: true, font: 'Calibri', size: 22 }));
          break;
        case 'codespan':
          runs.push(new TextRun({ text: t.text, font: 'Courier New', size: 20, color: 'D63384' }));
          break;
        case 'link':
          runs.push(new TextRun({ text: t.text || t.href, font: 'Calibri', size: 22, color: '4A90D9', underline: {} }));
          break;
        default:
          runs.push(new TextRun({ text: t.text || t.raw || '', font: 'Calibri', size: 22 }));
          break;
      }
    }
    return runs.length > 0 ? runs : [new TextRun({ text: '', font: 'Calibri', size: 22 })];
  }

  /**
   * Render list items to DOCX
   */
  _renderListToDOCX(children, listToken, depth = 0) {
    const items = listToken.items || [];
    items.forEach((item, idx) => {
      const bullet = listToken.ordered ? `${idx + 1}.  ` : '•  ';
      const text = this._stripInlineMarkdown(item.text || '');

      children.push(new Paragraph({
        children: [new TextRun({ text: `${bullet}${text}`, font: 'Calibri', size: 22 })],
        indent: { left: 360 + (depth * 360) },
        spacing: { after: 80 }
      }));

      // Nested lists
      if (item.tokens) {
        for (const subToken of item.tokens) {
          if (subToken.type === 'list') {
            this._renderListToDOCX(children, subToken, depth + 1);
          }
        }
      }
    });
  }

  /**
   * Strip inline markdown syntax (bold, italic, links, code) to plain text
   */
  _stripInlineMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
      .replace(/__(.+?)__/g, '$1')           // bold alt
      .replace(/\*(.+?)\*/g, '$1')           // italic
      .replace(/_(.+?)_/g, '$1')             // italic alt
      .replace(/`(.+?)`/g, '$1')             // inline code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')   // links
      .replace(/~~(.+?)~~/g, '$1')           // strikethrough
      .trim();
  }
}

module.exports = new ExportService();
