const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { hasStandardAccess } = require('../middleware/subscription');
const { sendBlock, capBlock } = require('../middleware/freeTierLimits');
const { getFreeTierConfig, DAY_MS } = require('../utils/freeTierPolicy');
const { rejectLocalOnlyNote } = require('../middleware/localOnlyNote');
const shareService = require('../services/shareService');
const { logger } = require('../utils/logger');

// FREE_EXCEPT_COSTLY=false: free tier gets 3 shares/month, premium unlimited (today's rule).
// Always: a daily abuse cap on new share links for everybody (FREE_TIER_SHARES_PER_DAY, default 20).
const FREE_SHARES_PER_MONTH = 3;

/**
 * Share limits. Returns null when the user may create a link, a 429 block descriptor over the daily cap;
 * throws the existing 403 when a non-subscriber is over the monthly limit (only while FREE_EXCEPT_COSTLY=false).
 */
async function checkShareLimit(userId) {
  const paid = await hasStandardAccess(userId);

  let shares;
  try {
    shares = await shareService.getUserShares(userId);
  } catch (e) {
    // The daily cap is a backstop: a failed lookup never blocks someone who is not under the monthly rule anyway.
    if (paid) { logger.warn('share cap lookup failed; allowing', { userId, error: e.message }); return null; }
    throw e;
  }

  // Daily abuse cap, for everyone.
  const dayAgo = Date.now() - DAY_MS;
  const limit = getFreeTierConfig().sharesPerDay;
  const today = shares.filter(s => new Date(s.created_at).getTime() >= dayAgo).length;
  if (today >= limit) {
    return capBlock('shares', `You have reached today's limit of ${limit} new share links. It resets on a rolling 24-hour basis, so please try again later.`, limit, today, 3600);
  }
  if (paid) return null;

  // Count shares this month
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);

  const monthlyShares = shares.filter(s => new Date(s.created_at) >= thisMonth);
  if (monthlyShares.length >= FREE_SHARES_PER_MONTH) {
    throw new AppError(`Free plan allows ${FREE_SHARES_PER_MONTH} share links per month. Upgrade for unlimited sharing.`, 403);
  }
  return null;
}

// ============================================
// Create a share link for a note
// ============================================
router.post('/:noteId/share', authenticate, rejectLocalOnlyNote('noteId'), asyncHandler(async (req, res) => {
  const userId = req.userId;
  const noteId = req.params.noteId;
  const { expiresInDays, allowComments } = req.body;

  const block = await checkShareLimit(userId);
  if (block) return sendBlock(res, block);

  const result = await shareService.createShareLink(userId, noteId, {
    expiresInDays,
    allowComments
  });

  res.json({ success: true, data: result });
}));

// ============================================
// Get a shared note (PUBLIC — no auth required)
// ============================================
router.get('/shared/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;
  const result = await shareService.getSharedNote(token);
  res.json({ success: true, data: result });
}));

// ============================================
// Revoke a share link
// ============================================
router.delete('/share/:shareId', authenticate, asyncHandler(async (req, res) => {
  await shareService.revokeShareLink(req.userId, req.params.shareId);
  res.json({ success: true });
}));

// ============================================
// Get user's active share links
// ============================================
router.get('/shares', authenticate, asyncHandler(async (req, res) => {
  const shares = await shareService.getUserShares(req.userId);
  res.json({ success: true, data: shares });
}));

module.exports = router;
