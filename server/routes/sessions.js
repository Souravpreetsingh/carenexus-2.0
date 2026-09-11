const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const Session = require('../models/Session');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const safetyService = require('../services/safetyService');

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

    const requestingUser = await User.findById(req.user.id);
    if (requestingUser && (requestingUser.accountStatus === 'SUSPENDED' || requestingUser.accountStatus === 'BANNED')) {
      return res.status(403).json({ message: `Account is ${requestingUser.accountStatus}. Session request is disabled.` });
    }

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

    if (bestMentor) {
      const blocked = await safetyService.isBlocked(req.user.id, bestMentor._id);
      if (blocked) {
        return res.status(403).json({ message: 'Session request cannot be created with this mentor due to safety preferences.' });
      }
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

    const io = req.app.get('io');
    if (io) io.emit('new-request', { session: populatedSession });

    if (bestMentor) {
      await notificationService.notifyMentor(bestMentor._id, {
        type: 'SESSION_REQUEST',
        title: 'New Support Session Request',
        body: `A member has requested support (${moodTag || 'General Support'}).`,
        entityType: 'Session',
        entityId: session._id.toString(),
        sessionId: session._id.toString(),
        roomId: session.roomId,
        actorId: req.user.id,
        actorRole: 'user',
        dedupeKey: `sess_req_${session._id}`
      });
    }

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

    const io = req.app.get('io');
    if (io) io.emit('request-cancelled', { sessionId: session._id });

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

    const io = req.app.get('io');
    if (io) io.emit('request-rejected', { sessionId: session._id });

    res.json({ message: 'Session request rejected.', session });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Mentor: get all pending sessions with User Feelings & AI Guidance Briefing
router.get('/pending', auth, async (req, res) => {
  try {
    if (req.user.role !== 'mentor') return res.status(403).json({ message: 'Mentors only' });
    const rawSessions = await Session.find({ status: 'pending' })
      .populate('user', 'username')
      .populate('recommendedMentor', 'username')
      .sort({ createdAt: -1 });

    const sessions = rawSessions.map(s => {
      const obj = s.toObject();
      obj.isReturningSession = Boolean(s.previousSessionId);
      return obj;
    });

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

    const io = req.app.get('io');
    if (io) io.emit('request-accepted', { sessionId: session._id, roomId: session.roomId });

    await notificationService.notifyUser(session.user._id, {
      type: 'SESSION_ACCEPTED',
      title: 'Mentor Accepted Your Request',
      body: 'Your mentor is ready! Click to enter your private safe space.',
      entityType: 'Session',
      entityId: session._id.toString(),
      sessionId: session._id.toString(),
      roomId: session.roomId,
      actorId: req.user.id,
      actorRole: 'mentor',
      dedupeKey: `sess_acc_${session._id}`
    });

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

const sessionIntelligenceService = require('../services/sessionIntelligenceService');

// Complete a session
router.post('/:id/complete', auth, async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    const isOwner = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id);
    if (!isOwner) return res.status(403).json({ message: 'Unauthorized' });

    session.status = 'completed';
    session.completedAt = new Date();
    await session.save();

    // Trigger post-session intelligence generation asynchronously (non-blocking)
    sessionIntelligenceService.generateForSession(session._id).catch(err => {
      console.error('[INTELLIGENCE] Async generation error post-session complete:', err.message);
    });

    res.json({ session, message: 'Session completed.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// User: Reconnect / Talk Again with Same Mentor
router.post('/reconnect-mentor', auth, async (req, res) => {
  try {
    if (req.user.role !== 'user') return res.status(403).json({ message: 'Only users can request sessions' });
    const { mentorId, previousSessionId } = req.body;

    if (!previousSessionId) {
      return res.status(400).json({ message: 'previousSessionId is required' });
    }

    // 1. Verify previous session exists
    const prevSession = await Session.findById(previousSessionId);
    if (!prevSession) {
      return res.status(404).json({ message: 'Previous session not found' });
    }

    // 2. Security: Verify previous session belongs to authenticated user
    if (prevSession.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized: Previous session does not belong to you' });
    }

    // 3. Verify previous session is completed
    if (prevSession.status !== 'completed') {
      return res.status(400).json({ message: 'Previous session must be completed before starting a new request' });
    }

    // 4. Determine target mentor ID & validate mentor exists
    const targetMentorId = mentorId || (prevSession.mentor ? prevSession.mentor.toString() : (prevSession.recommendedMentor ? prevSession.recommendedMentor.toString() : null));
    if (!targetMentorId) {
      return res.status(400).json({ message: 'No valid mentor found for this previous session' });
    }

    // Security: If mentorId was explicitly supplied, verify it matches the mentor from previous session
    const prevMentorId = prevSession.mentor ? prevSession.mentor.toString() : (prevSession.recommendedMentor ? prevSession.recommendedMentor.toString() : null);
    if (mentorId && prevMentorId && mentorId !== prevMentorId) {
      return res.status(400).json({ message: 'mentorId does not match the mentor from the specified previous session' });
    }

    const targetMentor = await User.findById(targetMentorId);
    if (!targetMentor || targetMentor.role !== 'mentor') {
      return res.status(400).json({ message: 'Target mentor not found or invalid' });
    }

    // 5. Prevent duplicate pending/active requests for the user
    const existing = await Session.findOne({
      user: req.user.id,
      status: { $in: ['pending', 'active'] }
    }).populate('recommendedMentor', 'username specialties rating bio education achievements')
      .populate('mentor', 'username specialties rating bio education achievements');

    if (existing) {
      return res.status(400).json({ success: false, error: 'DUPLICATE_ACTIVE_REQUEST', message: 'You already have an active or pending session request', session: existing });
    }

    // 6. Create completely NEW session with NEW roomId
    const newRoomId = uuidv4();
    const newSession = await Session.create({
      user: req.user.id,
      mentor: null,
      recommendedMentor: targetMentor._id,
      roomId: newRoomId,
      status: 'pending',
      previousSessionId: prevSession._id,
      moodTag: prevSession.moodTag || 'General Support',
      userFeelingsNote: `Talk Again request with ${targetMentor.username}`,
      aiGuidance: prevSession.aiGuidance || {}
    });

    const populatedSession = await Session.findById(newSession._id)
      .populate('recommendedMentor', 'username specialties rating bio education achievements')
      .populate('user', 'username');

    const io = req.app.get('io');
    if (io) io.emit('new-request', { session: populatedSession });

    res.status(201).json({ success: true, session: populatedSession });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// User or Mentor: Get Session History with metadata & message counts
router.get('/history', auth, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'user') {
      query = { user: req.user.id };
    } else {
      query = { $or: [{ mentor: req.user.id }, { recommendedMentor: req.user.id }] };
    }

    const rawSessions = await Session.find(query)
      .populate('user', 'username')
      .populate('mentor', 'username specialties rating bio education achievements')
      .populate('recommendedMentor', 'username specialties rating bio education achievements')
      .populate('previousSessionId')
      .sort({ createdAt: -1 });

    const sessions = await Promise.all(rawSessions.map(async (s) => {
      const msgCount = await Message.countDocuments({
        $or: [{ roomId: s.roomId }, { sessionId: s._id.toString() }]
      });
      const obj = s.toObject();
      obj.messageCount = msgCount;
      obj.isReturningSession = !!s.previousSessionId;
      return obj;
    }));

    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get chat history by sessionId (secured by membership)
router.get('/id/:sessionId/messages', auth, async (req, res) => {
  try {
    const session = await Session.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMember = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id) || (session.recommendedMentor && session.recommendedMentor.toString() === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Access denied to private room' });

    const messages = await Message.find({
      $or: [{ roomId: session.roomId }, { sessionId: session._id.toString() }]
    })
      .populate('sender', 'username role')
      .populate({ path: 'replyToMessageId', select: '_id senderRole text isDeleted createdAt' })
      .sort('createdAt');
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get chat history for a room (secured by membership)
router.get('/:roomId/messages', auth, async (req, res) => {
  try {
    const session = await Session.findOne({ roomId: req.params.roomId });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const isMember = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id) || (session.recommendedMentor && session.recommendedMentor.toString() === req.user.id);
    if (!isMember) return res.status(403).json({ message: 'Access denied to private room' });

    const messages = await Message.find({ roomId: req.params.roomId })
      .populate('sender', 'username role')
      .populate({ path: 'replyToMessageId', select: '_id senderRole text isDeleted createdAt' })
      .sort('createdAt');
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single message by messageId (for jump-to-target context lookup)
router.get('/message/:messageId', auth, async (req, res) => {
  try {
    const message = await Message.findById(req.params.messageId)
      .populate('sender', 'username role')
      .populate({ path: 'replyToMessageId', select: '_id senderRole text isDeleted createdAt' });

    if (!message) return res.status(404).json({ message: 'Message not found' });

    const session = await Session.findOne({ roomId: message.roomId });
    if (session) {
      const isMember = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id) || (session.recommendedMentor && session.recommendedMentor.toString() === req.user.id);
      if (!isMember) return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ message });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Report a message (secured by session membership)
router.post('/message/:messageId/report', auth, async (req, res) => {
  try {
    const { reason, notes } = req.body;
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    const session = await Session.findOne({ roomId: message.roomId });
    if (session) {
      const isMember = session.user.toString() === req.user.id || (session.mentor && session.mentor.toString() === req.user.id) || (session.recommendedMentor && session.recommendedMentor.toString() === req.user.id);
      if (!isMember) return res.status(403).json({ message: 'Access denied' });
    }

    console.log(`[REPORT] User ${req.user.id} reported message ${message._id}: reason=${reason} notes=${notes}`);
    res.json({ success: true, message: 'Report submitted successfully for administrative review.' });
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
