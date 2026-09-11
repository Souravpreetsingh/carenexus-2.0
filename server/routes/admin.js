const router = require('express').Router();
const User = require('../models/User');
const Session = require('../models/Session');
const SafetyCase = require('../models/SafetyCase');
const BlockedUser = require('../models/BlockedUser');
const AuditLog = require('../models/AuditLog');
const SecurityEvent = require('../models/SecurityEvent');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const notificationService = require('../services/notificationService');
const { logAudit } = require('../services/auditService');
const { createRateLimiter } = require('../middleware/rateLimiter');

// All admin routes require auth + admin role
router.use(auth, admin);

// GET /api/admin/overview (real metrics)
router.get('/overview', async (req, res) => {
  try {
    const [
      totalUsers,
      totalMentors,
      activeSessions,
      totalSessions,
      openCases,
      criticalCases,
      totalBlocked,
      securityEventsCount
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'mentor' }),
      Session.countDocuments({ status: 'active' }),
      Session.countDocuments(),
      SafetyCase.countDocuments({ status: { $in: ['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED'] } }),
      SafetyCase.countDocuments({ priority: 'CRITICAL', status: { $in: ['OPEN', 'UNDER_REVIEW'] } }),
      BlockedUser.countDocuments(),
      SecurityEvent.countDocuments()
    ]);

    res.json({
      totalUsers,
      totalMentors,
      activeSessions,
      totalSessions,
      openCases,
      criticalCases,
      totalBlocked,
      securityEventsCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/stats (legacy support)
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, totalMentors, totalSessions, activeSessions] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'mentor' }),
      Session.countDocuments(),
      Session.countDocuments({ status: 'active' })
    ]);
    res.json({ totalUsers, totalMentors, totalSessions, activeSessions });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/admin/cases (paginated & filtered moderation queue)
router.get('/cases', async (req, res) => {
  try {
    const { status, priority, category, limit = 30, page = 1 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;

    const skip = (Number(page) - 1) * Number(limit);
    const [cases, total] = await Promise.all([
      SafetyCase.find(query)
        .populate('reporterId', 'username email role')
        .populate('reportedUserId', 'username email role accountStatus')
        .populate('assignedAdminId', 'username')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      SafetyCase.countDocuments(query)
    ]);

    res.json({ cases, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/cases/:id (single case detail)
router.get('/cases/:id', async (req, res) => {
  try {
    const caseItem = await SafetyCase.findById(req.params.id)
      .populate('reporterId', 'username email role')
      .populate('reportedUserId', 'username email role accountStatus statusReason')
      .populate('assignedAdminId', 'username')
      .populate('internalNotes.adminId', 'username');

    if (!caseItem) return res.status(404).json({ message: 'Safety case not found' });
    res.json({ case: caseItem });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/admin/cases/:id (update case status / priority / assignment)
router.patch('/cases/:id', createRateLimiter({ windowMs: 60000, max: 20 }), async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { status, priority, assignedAdminId, resolution } = req.body;

    const caseItem = await SafetyCase.findById(req.params.id);
    if (!caseItem) return res.status(404).json({ message: 'Safety case not found' });

    if (status) caseItem.status = status;
    if (priority) caseItem.priority = priority;
    if (assignedAdminId !== undefined) caseItem.assignedAdminId = assignedAdminId || null;
    if (resolution !== undefined) caseItem.resolution = resolution;
    if (status === 'RESOLVED' || status === 'DISMISSED') caseItem.resolvedAt = new Date();
    caseItem.updatedAt = new Date();

    await caseItem.save();

    await logAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: status === 'RESOLVED' ? 'CASE_RESOLVED' : (status === 'DISMISSED' ? 'CASE_DISMISSED' : 'CASE_UPDATED'),
      entityType: 'SafetyCase',
      entityId: caseItem._id.toString(),
      metadata: { caseNumber: caseItem.caseNumber, status, priority },
      req
    });

    // Notify Reporter of update
    await notificationService.createNotification({
      recipientId: caseItem.reporterId,
      recipientRole: caseItem.reporterRole,
      type: 'SAFETY_CASE_UPDATED',
      title: `Case #${caseItem.caseNumber} Updated`,
      body: `Status: ${caseItem.status}${resolution ? ` - ${resolution}` : ''}`,
      entityType: 'SafetyCase',
      entityId: caseItem._id.toString()
    });

    res.json({ success: true, case: caseItem });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/cases/:id/notes (add internal note)
router.post('/cases/:id/notes', async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ message: 'Note content is required' });

    const caseItem = await SafetyCase.findById(req.params.id);
    if (!caseItem) return res.status(404).json({ message: 'Safety case not found' });

    caseItem.internalNotes.push({
      adminId,
      note: note.trim(),
      createdAt: new Date()
    });
    caseItem.updatedAt = new Date();
    await caseItem.save();

    res.json({ success: true, case: caseItem });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/warn (send safety warning)
router.post('/users/:id/warn', createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { warningMessage } = req.body;
    if (!warningMessage) return res.status(400).json({ message: 'Warning message required' });

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    await notificationService.createNotification({
      recipientId: targetUser._id,
      recipientRole: targetUser.role,
      type: 'SAFETY_WARNING',
      title: 'Official Community Guidelines Warning',
      body: warningMessage,
      actorId: adminId,
      actorRole: 'admin'
    });

    await logAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'USER_WARNED',
      entityType: 'User',
      entityId: targetUser._id.toString(),
      metadata: { username: targetUser.username, warningMessage },
      req
    });

    res.json({ success: true, message: `Warning sent to ${targetUser.username}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/users/:id/restrict (restrict or suspend user)
router.post('/users/:id/restrict', createRateLimiter({ windowMs: 60000, max: 10 }), async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { status = 'RESTRICTED', reason = '', durationDays = null } = req.body;

    if (!['RESTRICTED', 'SUSPENDED', 'BANNED', 'ACTIVE'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status parameter' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    targetUser.accountStatus = status;
    targetUser.statusReason = reason;
    if (durationDays && Number(durationDays) > 0) {
      const expires = new Date();
      expires.setDate(expires.getDate() + Number(durationDays));
      targetUser.statusExpiresAt = expires;
    } else {
      targetUser.statusExpiresAt = null;
    }
    await targetUser.save();

    await logAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: `USER_${status}`,
      entityType: 'User',
      entityId: targetUser._id.toString(),
      metadata: { username: targetUser.username, status, reason, durationDays },
      req
    });

    await notificationService.createNotification({
      recipientId: targetUser._id,
      recipientRole: targetUser.role,
      type: 'SECURITY_ALERT',
      title: `Account Notice: Status Changed to ${status}`,
      body: `Your account status is now ${status}. Reason: ${reason || 'Violation of Safety Policy'}.`,
      actorId: adminId,
      actorRole: 'admin'
    });

    res.json({ success: true, user: { id: targetUser._id, username: targetUser.username, accountStatus: targetUser.accountStatus } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort('-createdAt');
    res.json({ users });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Toggle user approved status (for mentors)
router.patch('/users/:id/approve', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isApproved = !user.isApproved;
    await user.save();
    res.json({ user: { id: user._id, username: user.username, isApproved: user.isApproved } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get all sessions
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await Session.find()
      .populate('user', 'username')
      .populate('mentor', 'username')
      .sort('-createdAt');
    res.json({ sessions });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Delete a session
router.delete('/sessions/:id', async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ message: 'Session deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .populate('actorId', 'username role')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ logs });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/admin/security-events
router.get('/security-events', async (req, res) => {
  try {
    const events = await SecurityEvent.find()
      .populate('actorId', 'username role')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ events });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
