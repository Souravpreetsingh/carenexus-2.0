const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const UserProgressProfile = require('../models/UserProgressProfile');
const Session = require('../models/Session');
const SessionIntelligence = require('../models/SessionIntelligence');

// GET /api/progress (User progress dashboard overview)
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    let profile = await UserProgressProfile.findOne({ userId }).lean();

    if (!profile) {
      profile = {
        userId,
        activeGoals: [],
        completedGoals: [],
        recentTopics: [],
        recurringTopics: [],
        progressTimeline: [],
        lastSessionId: null
      };
    }

    // Fetch user's completed sessions for session briefings
    const completedSessions = await Session.find({ user: userId, status: 'completed' })
      .populate('mentor', 'name avatar role')
      .sort({ completedAt: -1 })
      .limit(5)
      .lean();

    const sessionIds = completedSessions.map(s => s._id);

    // Fetch user-safe session intelligence summaries (omit mentor private notes!)
    const intelRecords = await SessionIntelligence.find({ sessionId: { $in: sessionIds } })
      .select('-mentorNotes -followUpSuggestions')
      .lean();

    const intelMap = new Map(intelRecords.map(i => [i.sessionId.toString(), i]));

    const recentSessionBriefings = completedSessions.map(s => {
      const intel = intelMap.get(s._id.toString()) || {};
      return {
        sessionId: s._id,
        completedAt: s.completedAt,
        mentor: s.mentor ? { name: s.mentor.name, avatar: s.mentor.avatar } : null,
        summary: intel.summary || 'Session completed.',
        keyTopics: (intel.keyTopics || []).map(t => t.topic),
        goalsCount: (intel.goals || []).length,
        actionItems: (intel.actionItems || []).map(a => ({ id: a.id, text: a.text, status: a.status }))
      };
    });

    res.json({
      profile,
      recentSessionBriefings
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/progress/goals
router.get('/goals', auth, async (req, res) => {
  try {
    const { status } = req.query;
    const profile = await UserProgressProfile.findOne({ userId: req.user.id }).lean();
    if (!profile) {
      return res.json({ activeGoals: [], completedGoals: [] });
    }

    if (status === 'active') {
      return res.json({ goals: profile.activeGoals });
    } else if (status === 'completed') {
      return res.json({ goals: profile.completedGoals });
    }

    res.json({
      activeGoals: profile.activeGoals,
      completedGoals: profile.completedGoals
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/progress/timeline
router.get('/timeline', auth, async (req, res) => {
  try {
    const profile = await UserProgressProfile.findOne({ userId: req.user.id }).lean();
    res.json({
      timeline: profile ? profile.progressTimeline : []
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
