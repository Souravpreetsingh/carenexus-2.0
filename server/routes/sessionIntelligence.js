const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Session = require('../models/Session');
const SessionIntelligence = require('../models/SessionIntelligence');
const sessionIntelligenceService = require('../services/sessionIntelligenceService');
const { apiLimiter } = require('../middleware/rateLimiter');

// GET /api/session-intelligence/:sessionId
router.get('/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const isUser = session.user.toString() === req.user.id;
    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isUser && !isMentor && !isAdmin) {
      return res.status(403).json({ message: 'Unauthorized access to session intelligence' });
    }

    let intel = await SessionIntelligence.findOne({ sessionId });
    if (!intel) {
      return res.status(404).json({ message: 'Session intelligence not found for this session' });
    }

    const intelObj = intel.toObject();

    // STRICT PRIVACY FILTERING:
    // If requester is a User (and not mentor/admin), strip private mentor fields!
    if (isUser && !isMentor && !isAdmin) {
      delete intelObj.mentorNotes;
      delete intelObj.followUpSuggestions;
    }

    res.json({ intelligence: intelObj, isMentor, isUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/session-intelligence/:sessionId/generate or regenerate
router.post('/:sessionId/generate', auth, apiLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isMentor && !isAdmin) {
      return res.status(403).json({ message: 'Only authorized mentors or admins can generate session intelligence' });
    }

    if (session.status !== 'completed') {
      return res.status(400).json({ message: 'Session must be completed before generating intelligence' });
    }

    const intel = await sessionIntelligenceService.generateForSession(sessionId, true);
    res.json({ intelligence: intel, message: 'Session intelligence generated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/:sessionId/regenerate', auth, apiLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isMentor && !isAdmin) {
      return res.status(403).json({ message: 'Only authorized mentors or admins can regenerate session intelligence' });
    }

    const intel = await sessionIntelligenceService.generateForSession(sessionId, true);
    res.json({ intelligence: intel, message: 'Session intelligence regenerated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/session-intelligence/:sessionId/mentor-notes (Strictly Mentor Private!)
router.patch('/:sessionId/mentor-notes', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Note text is required' });
    }

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    if (!isMentor) {
      return res.status(403).json({ message: 'Only the session mentor can manage private notes' });
    }

    let intel = await SessionIntelligence.findOne({ sessionId });
    if (!intel) {
      return res.status(404).json({ message: 'Session intelligence record not found' });
    }

    const noteId = `note_${Date.now()}`;
    intel.mentorNotes.push({
      id: noteId,
      text: text.trim(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    intel.updatedAt = new Date();
    await intel.save();

    res.json({ mentorNotes: intel.mentorNotes, message: 'Private note saved successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/session-intelligence/:sessionId/action-items/:itemId
router.patch('/:sessionId/action-items/:itemId', auth, async (req, res) => {
  try {
    const { sessionId, itemId } = req.params;
    const { status } = req.body; // 'OPEN', 'COMPLETED', 'DISMISSED'

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isUser = session.user.toString() === req.user.id;
    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    if (!isUser && !isMentor) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    let intel = await SessionIntelligence.findOne({ sessionId });
    if (!intel) return res.status(404).json({ message: 'Session intelligence not found' });

    const item = intel.actionItems.find(a => a.id === itemId);
    if (!item) return res.status(404).json({ message: 'Action item not found' });

    if (status && ['OPEN', 'COMPLETED', 'DISMISSED'].includes(status)) {
      item.status = status;
      if (status === 'COMPLETED') {
        item.completedAt = new Date();
      }
      if (isMentor) {
        item.source = 'MENTOR_EDITED';
      }
    }

    intel.updatedAt = new Date();
    await intel.save();

    res.json({ actionItems: intel.actionItems, message: 'Action item updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/session-intelligence/:sessionId/goals/:goalId
router.patch('/:sessionId/goals/:goalId', auth, async (req, res) => {
  try {
    const { sessionId, goalId } = req.params;
    const { text, status } = req.body;

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMentor = session.mentor && session.mentor.toString() === req.user.id;
    if (!isMentor) {
      return res.status(403).json({ message: 'Only authorized mentors can update goals' });
    }

    let intel = await SessionIntelligence.findOne({ sessionId });
    if (!intel) return res.status(404).json({ message: 'Session intelligence not found' });

    const goal = intel.goals.find(g => g.id === goalId);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });

    if (text) goal.text = text;
    if (status && ['ACTIVE', 'COMPLETED', 'PAUSED', 'ABANDONED'].includes(status)) {
      goal.status = status;
    }
    goal.source = 'MENTOR_EDITED';

    intel.updatedAt = new Date();
    await intel.save();

    // Update user profile goal list asynchronously
    sessionIntelligenceService.updateUserProgressProfile(session.user, session._id, intel).catch(err => {
      console.error('[INTELLIGENCE] Failed to update progress profile:', err.message);
    });

    res.json({ goals: intel.goals, message: 'Goal updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
