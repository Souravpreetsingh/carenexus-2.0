const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const Session = require('../models/Session');
const Message = require('../models/Message');
const auth = require('../middleware/auth');

const User = require('../models/User');

// AI Multi-Parameter Mentor-Matching Algorithm
async function findBestMentorMatch(moodTag) {
  const mentors = await User.find({ role: 'mentor' });
  if (!mentors || mentors.length === 0) return { bestMentor: null, matchScore: 90 };

  const normTag = (moodTag || '').toLowerCase();
  let bestMentor = mentors[0];
  let highestScore = 0;

  for (const m of mentors) {
    let score = 60;
    const specialties = m.specialties || [];
    if (specialties.some(s => s.toLowerCase().includes(normTag) || normTag.includes(s.toLowerCase()))) {
      score += 25;
    }
    if (m.rating) score += Math.round((m.rating / 5) * 10);
    
    if (score > highestScore) {
      highestScore = score;
      bestMentor = m;
    }
  }

  const matchScore = Math.min(99, Math.max(85, highestScore));
  return { bestMentor, matchScore };
}

const { analyzeText } = require('../utils/nlpEngine');

// User: request a support session with AI Mentor Matching & User Feelings Briefing
router.post('/request', auth, async (req, res) => {
  try {
    if (req.user.role !== 'user') return res.status(403).json({ message: 'Only users can request sessions' });
    const { moodTag, userFeelingsNote, mentorId } = req.body;

    const existing = await Session.findOne({ user: req.user.id, status: { $in: ['pending', 'active'] } })
      .populate('recommendedMentor', 'username specialties rating bio education achievements');
    if (existing) return res.json({ session: existing });

    let bestMentor = null;
    let matchScore = 90;

    if (mentorId) {
      bestMentor = await User.findById(mentorId);
      matchScore = 98;
    } else {
      const match = await findBestMentorMatch(moodTag);
      bestMentor = match.bestMentor;
      matchScore = match.matchScore;
    }

    // AI Analysis & Mentor Guidance Generation
    const feelingsText = userFeelingsNote || moodTag || 'General emotional support requested';
    const nlpResult = analyzeText(feelingsText);
    
    let suggestedApproach = 'Provide an empathetic, non-judgmental sanctuary for active listening.';
    const lowerNote = feelingsText.toLowerCase();
    if (lowerNote.includes('anx') || lowerNote.includes('stress') || lowerNote.includes('panic')) {
      suggestedApproach = 'Validate feelings of stress, acknowledge pressure, and guide user through calming 4-7-8 breathing if needed.';
    } else if (lowerNote.includes('burnout') || lowerNote.includes('exhaust') || lowerNote.includes('work')) {
      suggestedApproach = 'Focus on rest validation, workload boundaries, and compassionate listening.';
    } else if (lowerNote.includes('sad') || lowerNote.includes('grief') || lowerNote.includes('lonely')) {
      suggestedApproach = 'Offer gentle presence, allow emotional venting without rushing solutions.';
    }

    const aiGuidance = {
      summary: nlpResult.recommendation || 'Supportive peer listening.',
      distressLevel: nlpResult.crisisLevel,
      suggestedApproach
    };

    const session = await Session.create({
      user: req.user.id,
      roomId: uuidv4(),
      moodTag: moodTag || 'General Support',
      userFeelingsNote: userFeelingsNote || '',
      crisisLevel: nlpResult.crisisLevel || 'none',
      matchScore,
      recommendedMentor: bestMentor ? bestMentor._id : null,
      aiGuidance
    });

    const populatedSession = await Session.findById(session._id)
      .populate('recommendedMentor', 'username specialties rating bio education achievements');

    res.status(201).json({ session: populatedSession });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// User or Mentor: cancel a pending/active session request
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.user.toString() !== req.user.id && (session.mentor && session.mentor.toString() !== req.user.id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    session.status = 'cancelled';
    await session.save();
    res.json({ message: 'Session request cancelled successfully.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mentor: reject/decline a pending request
router.post('/:id/reject', auth, async (req, res) => {
  try {
    if (req.user.role !== 'mentor') return res.status(403).json({ message: 'Mentors only' });
    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'rejected' },
      { new: true }
    );
    if (!session) return res.status(409).json({ message: 'This request is no longer available or already processed.' });
    res.json({ message: 'Session request rejected.', session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mentor: get all pending sessions with User Feelings & AI Guidance Briefing
router.get('/pending', auth, async (req, res) => {
  try {
    if (req.user.role !== 'mentor') return res.status(403).json({ message: 'Mentors only' });
    const sessions = await Session.find({ status: 'pending' })
      .populate('user', 'username')
      .populate('recommendedMentor', 'username')
      .sort({ createdAt: -1 });
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mentor: accept a session (Atomic operation to prevent race conditions)
router.post('/:id/accept', auth, async (req, res) => {
  try {
    if (req.user.role !== 'mentor') return res.status(403).json({ message: 'Mentors only' });
    const session = await Session.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { mentor: req.user.id, status: 'active' },
      { new: true }
    ).populate('user', 'username');
    
    if (!session) {
      return res.status(409).json({ message: 'This request is no longer available.' });
    }
    res.json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get my active session (user or mentor)
router.get('/my', auth, async (req, res) => {
  try {
    const query = req.user.role === 'user'
      ? { user: req.user.id, status: { $in: ['pending', 'active'] } }
      : { mentor: req.user.id, status: 'active' };
    const session = await Session.findOne(query)
      .populate('user', 'username')
      .populate('mentor', 'username specialties rating bio education achievements')
      .populate('recommendedMentor', 'username specialties rating bio education achievements');
    res.json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Complete a session
router.post('/:id/complete', auth, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    const isOwner = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id);
    if (!isOwner) return res.status(403).json({ message: 'Unauthorized' });

    session.status = 'completed';
    await session.save();
    res.json({ session, message: 'Session completed.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get chat history for a room (secured by membership)
router.get('/:roomId/messages', auth, async (req, res) => {
  try {
    const session = await Session.findOne({ roomId: req.params.roomId });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMember = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id) || req.user.role === 'mentor';
    if (!isMember) return res.status(403).json({ message: 'Access denied to private room' });

    const messages = await Message.find({ roomId: req.params.roomId })
      .populate('sender', 'username role')
      .sort('createdAt');
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get session details by roomId (for chat metadata & mentor briefing)
router.get('/room/:roomId', auth, async (req, res) => {
  try {
    const session = await Session.findOne({ roomId: req.params.roomId })
      .populate('user', 'username')
      .populate('mentor', 'username specialties rating bio education achievements')
      .populate('recommendedMentor', 'username specialties rating bio education achievements');
    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
