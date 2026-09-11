const router = require('express').Router();
const auth = require('../middleware/auth');
const safetyService = require('../services/safetyService');
const SafetyCase = require('../models/SafetyCase');
const BlockedUser = require('../models/BlockedUser');
const { createRateLimiter } = require('../middleware/rateLimiter');

router.use(auth);

// POST /api/safety/reports (create report)
router.post('/reports', createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many reports submitted. Please wait a moment.' }), async (req, res) => {
  try {
    const reporterId = req.user.id || req.user._id;
    const reporterRole = req.user.role || 'user';
    const { targetType, targetId, category, description } = req.body;

    const result = await safetyService.createReport({
      reporterId,
      reporterRole,
      targetType,
      targetId,
      category,
      description,
      req
    });

    res.json({
      success: true,
      caseNumber: result.safetyCase.caseNumber,
      caseId: result.safetyCase._id,
      isDuplicate: result.isDuplicate,
      message: result.isDuplicate ? 'An identical report is already under review.' : 'Report submitted successfully.'
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/safety/my-reports (get reporter's submitted cases)
router.get('/my-reports', async (req, res) => {
  try {
    const reporterId = req.user.id || req.user._id;
    const cases = await SafetyCase.find({ reporterId })
      .select('caseNumber category status priority createdAt resolvedAt description resolution')
      .sort({ createdAt: -1 });

    res.json({ cases });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/safety/block (block user)
router.post('/block', createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const blockerId = req.user.id || req.user._id;
    const { blockedUserId, reason } = req.body;

    const blocked = await safetyService.blockUser(blockerId, blockedUserId, reason);
    res.json({ success: true, blocked });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/safety/block/:userId (unblock user)
router.delete('/block/:userId', async (req, res) => {
  try {
    const blockerId = req.user.id || req.user._id;
    await safetyService.unblockUser(blockerId, req.params.userId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/safety/blocked (list blocked users)
router.get('/blocked', async (req, res) => {
  try {
    const blockerId = req.user.id || req.user._id;
    const blockedList = await BlockedUser.find({ blockerId })
      .populate('blockedUserId', 'username role bio')
      .sort({ createdAt: -1 });

    res.json({ blocked: blockedList });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
