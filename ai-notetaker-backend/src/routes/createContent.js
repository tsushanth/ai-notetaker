const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const noteService = require('../services/noteService');
const { logger } = require('../utils/logger');
const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ============================================
// Create custom content from a note (Premium)
// ============================================
router.post('/:noteId', authenticate, asyncHandler(async (req, res) => {
  // Premium gate
  const status = await getSubscriptionStatus(req.userId);
  if (!status.isSubscribed && !status.isInTrial) {
    return res.status(403).json({ success: false, error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' });
  }
  const { prompt } = req.body;
  const noteId = req.params.noteId;

  if (!prompt || prompt.trim().length < 3) {
    throw new AppError('Please describe what you want to create', 400);
  }

  const note = await noteService.getNoteById(req.userId, noteId);
  if (!note) throw new AppError('Note not found', 404);

  const content = note.formatted_content || note.content || '';

  logger.info('Creating custom content', { userId: req.userId, noteId, prompt: prompt.substring(0, 100) });

  try {
    const systemPrompt = `You are a creative educational content creator. The user will give you a note's content and ask you to create something from it.

CRITICAL OUTPUT RULES:
- Your ENTIRE response must be ONLY the HTML page
- Start with <!DOCTYPE html> and end with </html>
- Do NOT include any text before <!DOCTYPE html>
- Do NOT include any text after </html>
- Do NOT wrap in markdown code fences

DESIGN RULES:
- Dark theme: background #0a0a0b, text #ffffff, accent #9333ea, cards #111111
- Mobile-first, max-width 600px, centered
- Clean, polished, minimal UI with rounded cards
- Inline CSS and JS only (no external dependencies)`;

    const userMessage = `Here is the note content:

Title: ${note.title || 'Note'}

${content.substring(0, 15000)}

---

User request: ${prompt}

Create a complete, self-contained HTML page based on this request. Make it visually beautiful with the dark purple theme.`;

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 120000
    });

    const rawOutput = response.data?.content?.[0]?.text || '';
    if (!rawOutput) {
      throw new AppError('Content generation returned empty result', 500);
    }

    // Extract clean HTML
    let html = rawOutput.trim();
    html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const doctypeIdx = html.indexOf('<!DOCTYPE');
    const htmlTagIdx = html.indexOf('<html');
    const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlTagIdx;
    if (startIdx > 0) html = html.substring(startIdx);
    const endIdx = html.lastIndexOf('</html>');
    if (endIdx > 0) html = html.substring(0, endIdx + 7);

    if (!html) {
      throw new AppError('Content generation returned empty result', 500);
    }

    res.json({
      success: true,
      data: { html, prompt }
    });

  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error('Content creation failed', { error: error.message, noteId });
    throw new AppError('Failed to create content. Please try again.', 500);
  }
}));

module.exports = router;
