const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getSubscriptionStatus } = require('../middleware/subscription');
const shareService = require('../services/shareService');
const { logger } = require('../utils/logger');

// Free tier: 3 shares/month, premium: unlimited
const FREE_SHARES_PER_MONTH = 3;

/**
 * Check share limits for free users
 */
async function checkShareLimit(userId) {
  const status = await getSubscriptionStatus(userId);
  if (status.isSubscribed || status.isInTrial) return true;

  // Count shares this month
  const shares = await shareService.getUserShares(userId);
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);

  const monthlyShares = shares.filter(s => new Date(s.created_at) >= thisMonth);
  if (monthlyShares.length >= FREE_SHARES_PER_MONTH) {
    throw new AppError(`Free plan allows ${FREE_SHARES_PER_MONTH} share links per month. Upgrade for unlimited sharing.`, 403);
  }
  return true;
}

// ============================================
// Create a share link for a note
// ============================================
router.post('/:noteId/share', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const noteId = req.params.noteId;
  const { expiresInDays, allowComments } = req.body;

  await checkShareLimit(userId);

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
