'use strict';
const express = require('express');
const router = express.Router();
const { snapshot } = require('../config/featureFlags');

/**
 * GET /api/config/features
 * Public (no sign-in: the app asks before anyone has signed in). Returns which optional features the server has
 * switched on. A client that cannot reach this endpoint must treat every flag as off.
 */
router.get('/features', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: snapshot() });
});

module.exports = router;
