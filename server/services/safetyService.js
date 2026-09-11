const SafetyCase = require('../models/SafetyCase');
const BlockedUser = require('../models/BlockedUser');
const Message = require('../models/Message');
const Session = require('../models/Session');
const User = require('../models/User');
const notificationService = require('./notificationService');
const { logAudit } = require('./auditService');

async function generateCaseNumber() {
  const year = new Date().getFullYear();
  const count = await SafetyCase.countDocuments();
  const nextNum = String(count + 1).padStart(6, '0');
  return `CN-SAF-${year}-${nextNum}`;
}

async function createReport(params) {
  const {
    reporterId,
    reporterRole,
    targetType = 'message', // 'message' | 'user'
    targetId,
    category,
    description = '',
    req = null
  } = params;

  if (!reporterId || !category) {
    throw new Error('Reporter identity and category are required.');
  }

  let reportedUserId = null;
  let reportedRole = 'user';
  let messageId = null;
  let sessionId = null;
  let roomId = null;
  let evidence = {};

  if (targetType === 'message') {
    const message = await Message.findById(targetId);
    if (!message) {
      throw new Error('Target message not found.');
    }

    messageId = message._id;
    sessionId = message.sessionId;
    roomId = message.roomId;
    reportedUserId = message.sender || message.senderId;
    reportedRole = message.senderRole || 'user';

    // Verify reporter participation in session/room
    if (sessionId) {
      const session = await Session.findById(sessionId);
      if (session) {
        const isParticipant = session.user.toString() === reporterId.toString() ||
                              (session.mentor && session.mentor.toString() === reporterId.toString());
        if (!isParticipant && reporterRole !== 'admin') {
          throw new Error('Unauthorized: Reporter is not a participant in this session.');
        }
      }
    }

    evidence = {
      messageId: message._id,
      messageText: message.text,
      createdAt: message.createdAt
    };
  } else if (targetType === 'user') {
    const reportedUser = await User.findById(targetId);
    if (!reportedUser) {
      throw new Error('Reported user not found.');
    }
    reportedUserId = reportedUser._id;
    reportedRole = reportedUser.role;
  } else {
    throw new Error('Invalid target type.');
  }

  if (reporterId.toString() === reportedUserId.toString()) {
    throw new Error('You cannot report yourself.');
  }

  // Duplicate report check within 24h
  const timeWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingDuplicate = await SafetyCase.findOne({
    reporterId,
    reportedUserId,
    category,
    ...(messageId ? { messageId } : {}),
    createdAt: { $gte: timeWindow }
  });

  if (existingDuplicate) {
    return { safetyCase: existingDuplicate, isDuplicate: true };
  }

  const caseNumber = await generateCaseNumber();
  let priority = 'MEDIUM';
  if (category === 'SAFETY_CONCERN' || category === 'ABUSE') {
    priority = 'HIGH';
  }
  if (description.toLowerCase().includes('suicide') || description.toLowerCase().includes('kill') || description.toLowerCase().includes('emergency')) {
    priority = 'CRITICAL';
  }

  const safetyCase = await SafetyCase.create({
    caseNumber,
    reporterId,
    reporterRole,
    reportedUserId,
    reportedRole,
    sessionId,
    roomId,
    messageId,
    category,
    description,
    priority,
    status: 'OPEN',
    evidence
  });

  // Log Audit
  await logAudit({
    actorId: reporterId,
    actorRole: reporterRole,
    action: 'REPORT_CREATED',
    entityType: 'SafetyCase',
    entityId: safetyCase._id.toString(),
    metadata: { caseNumber, category, priority, targetType },
    req
  });

  // Notify Admins
  await notificationService.notifyAdmins({
    type: 'SAFETY_REPORT_CREATED',
    title: `New Safety Case #${caseNumber}`,
    body: `Category: ${category} (Priority: ${priority})`,
    entityType: 'SafetyCase',
    entityId: safetyCase._id.toString(),
    actorId: reporterId,
    actorRole: reporterRole,
    dedupeKey: `case_admin_${safetyCase._id}`
  });

  // Notify Reporter
  await notificationService.createNotification({
    recipientId: reporterId,
    recipientRole: reporterRole,
    type: 'SAFETY_REPORT_CREATED',
    title: 'Report Received',
    body: `Your report (Case #${caseNumber}) has been received and queued for review.`,
    entityType: 'SafetyCase',
    entityId: safetyCase._id.toString(),
    dedupeKey: `case_reporter_${safetyCase._id}`
  });

  return { safetyCase, isDuplicate: false };
}

async function blockUser(blockerId, blockedUserId, reason = '') {
  if (!blockerId || !blockedUserId) {
    throw new Error('Blocker and blocked user IDs required.');
  }

  if (blockerId.toString() === blockedUserId.toString()) {
    throw new Error('You cannot block yourself.');
  }

  const blocked = await BlockedUser.findOneAndUpdate(
    { blockerId, blockedUserId },
    { reason, createdAt: new Date() },
    { upsert: true, new: true }
  );

  await logAudit({
    actorId: blockerId,
    actorRole: 'user',
    action: 'BLOCK_CREATED',
    entityType: 'BlockedUser',
    entityId: blocked._id.toString(),
    metadata: { blockedUserId }
  });

  return blocked;
}

async function unblockUser(blockerId, blockedUserId) {
  const result = await BlockedUser.findOneAndDelete({ blockerId, blockedUserId });
  if (result) {
    await logAudit({
      actorId: blockerId,
      actorRole: 'user',
      action: 'BLOCK_REMOVED',
      entityType: 'BlockedUser',
      entityId: result._id.toString(),
      metadata: { blockedUserId }
    });
  }
  return result;
}

async function isBlocked(userId1, userId2) {
  if (!userId1 || !userId2) return false;
  const count = await BlockedUser.countDocuments({
    $or: [
      { blockerId: userId1, blockedUserId: userId2 },
      { blockerId: userId2, blockedUserId: userId1 }
    ]
  });
  return count > 0;
}

module.exports = {
  generateCaseNumber,
  createReport,
  blockUser,
  unblockUser,
  isBlocked
};
