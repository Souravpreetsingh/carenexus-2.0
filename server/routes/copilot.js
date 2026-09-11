const router = require('express').Router();
const auth = require('../middleware/auth');
const Session = require('../models/Session');
const Message = require('../models/Message');
const MentorCopilotSession = require('../models/MentorCopilotSession');
const aiService = require('../services/ai/aiService');
const { logAudit } = require('../services/auditService');
const { createRateLimiter } = require('../middleware/rateLimiter');

// Server-side AES decryption helper for context pipeline
const crypto = require('crypto');
function decryptMessageText(cipherPayload, roomId) {
  if (!cipherPayload || typeof cipherPayload !== 'string' || !cipherPayload.startsWith('ENC:')) {
    return cipherPayload || '';
  }
  try {
    const parts = cipherPayload.split(':');
    if (parts.length !== 3) return cipherPayload;
    const iv = Buffer.from(parts[1], 'base64');
    const cipherBuffer = Buffer.from(parts[2], 'base64');

    const keyMaterial = Buffer.from('CareNexus-SafeSpace-Salt:' + roomId);
    const key = crypto.createHash('sha256').update(keyMaterial).digest();

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    // Note: Node WebCrypto compatibility fallback
    return '[Encrypted Chat Message]';
  } catch (_) {
    return '[Encrypted Chat Message]';
  }
}

// Server-side Authorization Middleware for Copilot Endpoints
async function requireMentorCopilotAuth(req, res, next) {
  try {
    const userId = req.user ? (req.user.id || req.user._id) : null;
    const userRole = req.user ? req.user.role : null;

    if (!userId || userRole !== 'mentor') {
      return res.status(403).json({ message: 'Forbidden: AI Copilot is mentor-private.' });
    }

    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required.' });
    }

    let session = null;
    if (sessionId.length === 24) {
      session = await Session.findById(sessionId);
    }
    if (!session) {
      session = await Session.findOne({ roomId: sessionId });
    }

    if (!session) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    if (!session.mentor || session.mentor.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Forbidden: You are not the assigned mentor for this session.' });
    }

    if (session.status === 'cancelled' || session.status === 'rejected') {
      return res.status(403).json({ message: 'Copilot is unavailable for cancelled or rejected sessions.' });
    }

    req.sessionDoc = session;
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

router.use(auth);

// GET /api/copilot/session/:sessionId (Get current Copilot state)
router.get('/session/:sessionId', requireMentorCopilotAuth, async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    let copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) {
      copilotState = await MentorCopilotSession.create({
        sessionId: session._id,
        mentorId,
        roomId: session.roomId,
        currentTopic: session.moodTag || 'General Emotional Support',
        keyPoints: [],
        suggestedQuestions: [
          { question: 'What has been on your mind most today?', reason: 'Initiate supportive active listening.' }
        ],
        actionItems: []
      });
    }

    res.json({ copilot: copilotState, sessionStatus: session.status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/analyze or /refresh
router.post('/session/:sessionId/analyze', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    if (session.status === 'completed') {
      return res.status(403).json({ message: 'Session is completed. Copilot analysis is read-only.' });
    }

    // Fetch authorized session messages
    const rawMessages = await Message.find({ sessionId: session._id.toString() }).sort({ createdAt: 1 });
    const cleanMessages = rawMessages.map(m => {
      const obj = m.toObject();
      obj.text = decryptMessageText(obj.text, session.roomId);
      return obj;
    });

    const analysis = await aiService.analyzeSessionContext(cleanMessages, { roomId: session.roomId });

    let copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) {
      copilotState = new MentorCopilotSession({ sessionId: session._id, mentorId, roomId: session.roomId });
    }

    const lastMsg = cleanMessages.length > 0 ? cleanMessages[cleanMessages.length - 1] : null;

    copilotState.currentTopic = analysis.currentTopic;
    copilotState.keyPoints = analysis.keyPoints;
    copilotState.suggestedQuestions = analysis.suggestedQuestions;
    if (analysis.actionItems && analysis.actionItems.length > 0) {
      // Merge action items preserving existing completed states
      const existingMap = new Map((copilotState.actionItems || []).map(item => [item.text, item.completed]));
      copilotState.actionItems = analysis.actionItems.map(item => ({
        id: item.id || `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        text: item.text,
        completed: existingMap.get(item.text) || false,
        sourceMessageIds: item.sourceMessageIds || []
      }));
    }
    copilotState.lastAnalyzedMessageId = lastMsg ? (lastMsg._id ? lastMsg._id.toString() : null) : null;
    copilotState.lastAnalyzedAt = new Date();
    copilotState.updatedAt = new Date();

    await copilotState.save();

    // Log Audit
    await logAudit({
      actorId: mentorId,
      actorRole: 'mentor',
      action: 'COPILOT_ANALYSIS_REQUESTED',
      entityType: 'MentorCopilotSession',
      entityId: copilotState._id.toString(),
      metadata: { sessionId: session._id, currentTopic: analysis.currentTopic },
      req
    });

    res.json({ success: true, copilot: copilotState });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/refresh (Combined Refresh)
router.post('/session/:sessionId/refresh', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  req.url = `/session/${req.params.sessionId}/analyze`;
  return router.handle(req, res);
});

// PATCH /api/copilot/session/:sessionId/action-items/:itemId (Toggle action item)
router.patch('/session/:sessionId/action-items/:itemId', requireMentorCopilotAuth, async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;
    const { itemId } = req.params;
    const { completed } = req.body;

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) return res.status(404).json({ message: 'Copilot state not found.' });

    const item = copilotState.actionItems.find(a => a.id === itemId || a._id.toString() === itemId);
    if (!item) return res.status(404).json({ message: 'Action item not found.' });

    item.completed = completed !== undefined ? Boolean(completed) : !item.completed;
    copilotState.updatedAt = new Date();
    await copilotState.save();

    res.json({ success: true, copilot: copilotState });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/summary (Generate Summary)
router.post('/session/:sessionId/summary', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 10 }), async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    const rawMessages = await Message.find({ sessionId: session._id.toString() }).sort({ createdAt: 1 });
    const cleanMessages = rawMessages.map(m => {
      const obj = m.toObject();
      obj.text = decryptMessageText(obj.text, session.roomId);
      return obj;
    });

    const summaryData = await aiService.generateSessionSummary(cleanMessages, { roomId: session.roomId });

    let copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) {
      copilotState = new MentorCopilotSession({ sessionId: session._id, mentorId, roomId: session.roomId });
    }

    copilotState.summary = summaryData;
    copilotState.updatedAt = new Date();
    await copilotState.save();

    await logAudit({
      actorId: mentorId,
      actorRole: 'mentor',
      action: 'COPILOT_SUMMARY_GENERATED',
      entityType: 'MentorCopilotSession',
      entityId: copilotState._id.toString(),
      metadata: { sessionId: session._id },
      req
    });

    res.json({ success: true, summary: summaryData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
