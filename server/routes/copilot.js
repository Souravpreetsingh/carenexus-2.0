const router = require('express').Router();
const auth = require('../middleware/auth');
const Session = require('../models/Session');
const Message = require('../models/Message');
const MentorCopilotSession = require('../models/MentorCopilotSession');
const aiService = require('../services/ai/aiService');
const copilotLiveEngine = require('../services/copilotLiveEngine');
const { logAudit } = require('../services/auditService');
const { createRateLimiter } = require('../middleware/rateLimiter');

const crypto = require('crypto');
function decryptMessageText(cipherPayload, roomId) {
  if (!cipherPayload || typeof cipherPayload !== 'string' || !cipherPayload.startsWith('ENC:')) {
    return cipherPayload || '';
  }
  try {
    const parts = cipherPayload.split(':');
    if (parts.length !== 3) return cipherPayload;
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
        topicConfidence: 0.9,
        topicHistory: [{ topic: session.moodTag || 'General Emotional Support', startedAt: new Date(), lastActiveAt: new Date(), confidence: 0.9 }],
        keyPoints: [],
        suggestedQuestions: [
          { id: `q_init_1`, question: 'What has been on your mind most today?', reason: 'Initiate supportive active listening.', used: false, dismissed: false }
        ],
        actionItems: [],
        conversationSnapshot: {
          topic: session.moodTag || 'General Emotional Support',
          goal: 'Initial reflection',
          recentDevelopment: 'Session started',
          unresolved: 'Exploring member goals'
        },
        timeline: [{ id: `tl_init`, timestamp: new Date(), timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), title: 'Session Initiated', type: 'INFO' }],
        whatChanged: []
      });
    }

    res.json({ copilot: copilotState, sessionStatus: session.status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/analyze or /refresh (Manual Refresh)
router.post('/session/:sessionId/analyze', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 20 }), async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    if (session.status === 'completed') {
      return res.status(403).json({ message: 'Session is completed. Copilot analysis is read-only.' });
    }

    // Cancel any pending live debounce timer for this session
    copilotLiveEngine.cancelPendingAnalysis(session._id.toString());

    const io = req.app.get('io');
    await copilotLiveEngine.runLiveAnalysis(session._id.toString(), io, 'MANUAL_REFRESH');

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });

    await logAudit({
      actorId: mentorId,
      actorRole: 'mentor',
      action: 'COPILOT_MANUAL_REFRESH',
      entityType: 'MentorCopilotSession',
      entityId: copilotState._id.toString(),
      metadata: { sessionId: session._id, currentTopic: copilotState.currentTopic, version: copilotState.analysisVersion },
      req
    });

    res.json({ success: true, copilot: copilotState });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/refresh
router.post('/session/:sessionId/refresh', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 20 }), async (req, res) => {
  req.url = `/session/${req.params.sessionId}/analyze`;
  return router.handle(req, res);
});

// POST /api/copilot/session/:sessionId/ask-next (Generate Targeted Questions)
router.post('/session/:sessionId/ask-next', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    const rawMessages = await Message.find({ sessionId: session._id.toString() }).sort({ createdAt: 1 });
    const cleanMessages = rawMessages.map(m => m.toObject());

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    const result = await aiService.generateAskNext(cleanMessages, copilotState || {});

    res.json({ success: true, questions: result.questions || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/catch-up (Concise Summary of Recent Developments)
router.post('/session/:sessionId/catch-up', requireMentorCopilotAuth, createRateLimiter({ windowMs: 60000, max: 15 }), async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    const rawMessages = await Message.find({ sessionId: session._id.toString() }).sort({ createdAt: 1 });
    const cleanMessages = rawMessages.map(m => m.toObject());

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    const result = await aiService.generateCatchUp(cleanMessages, copilotState || {});

    res.json({ success: true, catchUpText: result.catchUpText });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/copilot/session/:sessionId/what-changed (Delta analysis)
router.post('/session/:sessionId/what-changed', requireMentorCopilotAuth, async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    const changes = copilotState ? (copilotState.whatChanged || []) : [];

    res.json({ success: true, changes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/copilot/session/:sessionId/questions/:questionId (Toggle Question Used / Dismissed)
router.patch('/session/:sessionId/questions/:questionId', requireMentorCopilotAuth, async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;
    const { questionId } = req.params;
    const { used, dismissed } = req.body;

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) return res.status(404).json({ message: 'Copilot state not found.' });

    const q = (copilotState.suggestedQuestions || []).find(item => item.id === questionId || item._id.toString() === questionId);
    if (!q) return res.status(404).json({ message: 'Question suggestion not found.' });

    if (used !== undefined) q.used = Boolean(used);
    if (dismissed !== undefined) q.dismissed = Boolean(dismissed);

    copilotState.updatedAt = new Date();
    await copilotState.save();

    res.json({ success: true, copilot: copilotState });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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

    const item = (copilotState.actionItems || []).find(a => a.id === itemId || a._id.toString() === itemId);
    if (!item) return res.status(404).json({ message: 'Action item not found.' });

    item.completed = completed !== undefined ? Boolean(completed) : !item.completed;
    copilotState.updatedAt = new Date();
    await copilotState.save();

    res.json({ success: true, copilot: copilotState });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/copilot/session/:sessionId/toggle-live (Pause / Resume Live Intelligence)
router.patch('/session/:sessionId/toggle-live', requireMentorCopilotAuth, async (req, res) => {
  try {
    const session = req.sessionDoc;
    const mentorId = req.user.id || req.user._id;
    const { isLivePaused } = req.body;

    const copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) return res.status(404).json({ message: 'Copilot state not found.' });

    copilotState.isLivePaused = isLivePaused !== undefined ? Boolean(isLivePaused) : !copilotState.isLivePaused;
    if (copilotState.isLivePaused) {
      copilotLiveEngine.cancelPendingAnalysis(session._id.toString());
    }
    copilotState.updatedAt = new Date();
    await copilotState.save();

    res.json({ success: true, isLivePaused: copilotState.isLivePaused, copilot: copilotState });
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
    const cleanMessages = rawMessages.map(m => m.toObject());

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
