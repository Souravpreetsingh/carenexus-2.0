const Session = require('../models/Session');
const Message = require('../models/Message');
const SessionIntelligence = require('../models/SessionIntelligence');
const UserProgressProfile = require('../models/UserProgressProfile');
const MentorCopilotSession = require('../models/MentorCopilotSession');
const aiService = require('./ai/aiService');
const notificationService = require('./notificationService');

async function generateForSession(sessionId, isRegeneration = false) {
  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'completed') {
      throw new Error(`Cannot generate intelligence for session in state "${session.status}". Session must be completed.`);
    }

    // 1. Gather session messages strictly isolated to this session's roomId
    const messages = await Message.find({ roomId: session.roomId, isDeleted: { $ne: true } })
      .sort({ createdAt: 1 })
      .lean();

    // 2. Fetch live copilot state if available
    const copilotSession = await MentorCopilotSession.findOne({ sessionId: session._id }).lean();
    const liveState = copilotSession || {};

    // 3. Fetch previous completed session intelligence for this user (if any)
    const prevIntelligence = await SessionIntelligence.findOne({
      userId: session.user,
      sessionId: { $ne: session._id }
    }).sort({ createdAt: -1 }).lean();

    // 4. Generate structured intelligence via AI service
    const rawAiResult = await aiService.generateSessionIntelligence(messages, liveState, prevIntelligence);

    // 5. Look up existing SessionIntelligence record for idempotency / regeneration
    let record = await SessionIntelligence.findOne({ sessionId: session._id });

    const newVersion = record ? (record.generationVersion + 1) : 1;
    const existingMentorNotes = record ? (record.mentorNotes || []) : [];
    const existingGoals = record ? (record.goals || []) : [];
    const existingActionItems = record ? (record.actionItems || []) : [];

    // Map AI goals, preserving any human mentor-edited goals ('MENTOR_EDITED')
    const mentorEditedGoals = existingGoals.filter(g => g.source === 'MENTOR_EDITED');
    const mentorEditedMap = new Map(mentorEditedGoals.map(g => [g.id, g]));

    const processedGoals = (rawAiResult.goals || []).map((g, idx) => {
      const gId = g.id || `g_${Date.now()}_${idx}`;
      if (mentorEditedMap.has(gId)) {
        return mentorEditedMap.get(gId);
      }
      return {
        id: gId,
        text: g.text,
        status: g.status || 'ACTIVE',
        sourceMessageIds: g.sourceMessageIds || [],
        source: 'AI',
        confidence: g.confidence || 0.9,
        createdAt: g.createdAt ? new Date(g.createdAt) : new Date()
      };
    });

    // Add any mentor-edited goals not present in AI response
    mentorEditedGoals.forEach(g => {
      if (!processedGoals.some(pg => pg.id === g.id)) {
        processedGoals.push(g);
      }
    });

    // Map action items, preserving mentor edits
    const mentorEditedActions = existingActionItems.filter(a => a.source === 'MENTOR_EDITED');
    const mentorEditedActionMap = new Map(mentorEditedActions.map(a => [a.id, a]));

    const processedActionItems = (rawAiResult.actionItems || []).map((a, idx) => {
      const aId = a.id || `act_${Date.now()}_${idx}`;
      if (mentorEditedActionMap.has(aId)) {
        return mentorEditedActionMap.get(aId);
      }
      return {
        id: aId,
        text: typeof a === 'string' ? a : a.text,
        status: a.status || (a.completed ? 'COMPLETED' : 'OPEN'),
        sourceMessageIds: a.sourceMessageIds || [],
        source: 'AI',
        dueAt: a.dueAt ? new Date(a.dueAt) : null,
        completedAt: a.completedAt ? new Date(a.completedAt) : (a.completed ? new Date() : null),
        createdAt: a.createdAt ? new Date(a.createdAt) : new Date()
      };
    });

    if (!record) {
      record = new SessionIntelligence({
        sessionId: session._id,
        userId: session.user,
        mentorId: session.mentor,
        summary: rawAiResult.summary || 'Session completed.',
        keyTopics: rawAiResult.keyTopics || [],
        goals: processedGoals,
        actionItems: processedActionItems,
        followUpSuggestions: rawAiResult.followUpSuggestions || [],
        unresolvedAreas: rawAiResult.unresolvedAreas || [],
        progressSignals: rawAiResult.progressSignals || [],
        comparison: rawAiResult.comparison || {},
        mentorNotes: existingMentorNotes,
        generationVersion: 1,
        generatedAt: new Date(),
        updatedAt: new Date()
      });
    } else {
      record.summary = rawAiResult.summary || record.summary;
      record.keyTopics = rawAiResult.keyTopics || record.keyTopics;
      record.goals = processedGoals;
      record.actionItems = processedActionItems;
      record.followUpSuggestions = rawAiResult.followUpSuggestions || record.followUpSuggestions;
      record.unresolvedAreas = rawAiResult.unresolvedAreas || record.unresolvedAreas;
      record.progressSignals = rawAiResult.progressSignals || record.progressSignals;
      record.comparison = rawAiResult.comparison || record.comparison;
      record.mentorNotes = existingMentorNotes; // NEVER overwrite mentor private notes!
      record.generationVersion = newVersion;
      record.generatedAt = new Date();
      record.updatedAt = new Date();
    }

    await record.save();

    // 6. Update UserProgressProfile idempotently
    await updateUserProgressProfile(session.user, session._id, record);

    // 7. Send notification to Mentor
    if (notificationService && typeof notificationService.createNotification === 'function') {
      await notificationService.createNotification({
        recipientId: session.mentor,
        recipientRole: 'mentor',
        type: 'SESSION_INTELLIGENCE_READY',
        title: 'Session Intelligence Ready',
        body: 'Post-session intelligence summary and goals have been generated.',
        data: { sessionId: session._id.toString() },
        entityType: 'SessionIntelligence',
        entityId: record._id.toString(),
        sessionId: session._id.toString(),
        dedupeKey: `intel_ready_${session._id.toString()}_v${newVersion}`
      }).catch(nErr => console.error('[INTELLIGENCE] Notification error:', nErr.message));
    }

    return record;
  } catch (err) {
    console.error(`[INTELLIGENCE] Failed to generate intelligence for session ${sessionId}:`, err.message);
    throw err;
  }
}

async function updateUserProgressProfile(userId, sessionId, intelligenceRecord) {
  try {
    let profile = await UserProgressProfile.findOne({ userId });
    if (!profile) {
      profile = new UserProgressProfile({
        userId,
        activeGoals: [],
        completedGoals: [],
        recentTopics: [],
        recurringTopics: [],
        progressTimeline: [],
        lastSessionId: sessionId,
        lastUpdatedAt: new Date()
      });
    }

    // Match goals and prevent duplicate goal explosion
    const activeMap = new Map((profile.activeGoals || []).map(g => [g.text.toLowerCase().trim(), g]));

    (intelligenceRecord.goals || []).forEach(g => {
      const normText = g.text.toLowerCase().trim();
      if (g.status === 'COMPLETED') {
        if (!profile.completedGoals.some(cg => cg.text.toLowerCase().trim() === normText)) {
          profile.completedGoals.push({
            id: g.id,
            text: g.text,
            completedAt: new Date()
          });
        }
        activeMap.delete(normText);
      } else if (g.status === 'ACTIVE') {
        if (!activeMap.has(normText)) {
          activeMap.set(normText, {
            id: g.id,
            text: g.text,
            status: 'ACTIVE',
            sourceMessageIds: g.sourceMessageIds || [],
            createdAt: g.createdAt || new Date(),
            updatedAt: new Date()
          });
        }
      }
    });

    profile.activeGoals = Array.from(activeMap.values());

    // Update topics (capped to 10)
    const newTopics = (intelligenceRecord.keyTopics || []).map(kt => kt.topic);
    const combinedTopics = Array.from(new Set([...newTopics, ...(profile.recentTopics || [])])).slice(0, 10);
    profile.recentTopics = combinedTopics;

    // Idempotent Timeline Entry
    const timelineId = `tl_sess_${sessionId.toString()}`;
    const exists = profile.progressTimeline.some(t => t.id === timelineId || (t.sessionId && t.sessionId.toString() === sessionId.toString()));

    if (!exists) {
      profile.progressTimeline.unshift({
        id: timelineId,
        date: new Date(),
        title: 'Session Completed',
        description: intelligenceRecord.summary ? (intelligenceRecord.summary.length > 120 ? intelligenceRecord.summary.substring(0, 117) + '...' : intelligenceRecord.summary) : 'Support session completed.',
        category: 'session',
        sessionId: sessionId
      });
      // Cap timeline to 50 items
      profile.progressTimeline = profile.progressTimeline.slice(0, 50);
    }

    profile.lastSessionId = sessionId;
    profile.lastUpdatedAt = new Date();
    await profile.save();
  } catch (err) {
    console.error('[INTELLIGENCE] Error updating UserProgressProfile:', err.message);
  }
}

module.exports = {
  generateForSession,
  updateUserProgressProfile
};
