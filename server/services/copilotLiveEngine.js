const Session = require('../models/Session');
const Message = require('../models/Message');
const MentorCopilotSession = require('../models/MentorCopilotSession');
const aiService = require('./ai/aiService');

const COPILOT_LIVE_ENABLED = process.env.COPILOT_LIVE_ENABLED !== 'false';
const COPILOT_ANALYSIS_MESSAGE_THRESHOLD = Number(process.env.COPILOT_ANALYSIS_MESSAGE_THRESHOLD) || 5;
const COPILOT_ANALYSIS_DEBOUNCE_MS = Number(process.env.COPILOT_ANALYSIS_DEBOUNCE_MS) || 15000;
const COPILOT_MAX_ANALYSES_PER_SESSION = Number(process.env.COPILOT_MAX_ANALYSES_PER_SESSION) || 50;

// In-memory buffer map: Map<sessionId, { messageIds: Set<string>, debounceTimer: Timeout | null, isAnalyzing: boolean }>
const pendingBuffers = new Map();

function getOrCreateBuffer(sessionIdStr) {
  if (!pendingBuffers.has(sessionIdStr)) {
    pendingBuffers.set(sessionIdStr, {
      messageIds: new Set(),
      debounceTimer: null,
      isAnalyzing: false
    });
  }
  return pendingBuffers.get(sessionIdStr);
}

function notifyMentor(io, mentorId, eventName, payload) {
  if (!io || !mentorId) return;
  const mentorRoom = `user:${mentorId.toString()}`;
  console.log(`[COPILOT-LIVE] Emitting private event '${eventName}' to mentor room '${mentorRoom}'`);
  io.to(mentorRoom).emit(eventName, payload);
}

async function onNewMessage(sessionId, messageId, senderRole, io) {
  if (!COPILOT_LIVE_ENABLED || !sessionId || !messageId) return;
  const sessionIdStr = sessionId.toString();

  try {
    const copilotDoc = await MentorCopilotSession.findOne({ sessionId });
    if (!copilotDoc || copilotDoc.isLivePaused) {
      return;
    }

    if (copilotDoc.analyzedMessageCount >= COPILOT_MAX_ANALYSES_PER_SESSION) {
      console.log(`[COPILOT-LIVE] Max analyses per session (${COPILOT_MAX_ANALYSES_PER_SESSION}) reached for session ${sessionIdStr}`);
      return;
    }

    const buffer = getOrCreateBuffer(sessionIdStr);
    buffer.messageIds.add(messageId.toString());

    console.log(`[COPILOT-LIVE] Buffer size for session ${sessionIdStr}: ${buffer.messageIds.size} / ${COPILOT_ANALYSIS_MESSAGE_THRESHOLD}`);

    if (buffer.messageIds.size >= COPILOT_ANALYSIS_MESSAGE_THRESHOLD) {
      if (buffer.debounceTimer) {
        clearTimeout(buffer.debounceTimer);
        buffer.debounceTimer = null;
      }
      runLiveAnalysis(sessionIdStr, io, 'THRESHOLD_REACHED');
    } else {
      if (buffer.debounceTimer) {
        clearTimeout(buffer.debounceTimer);
      }
      buffer.debounceTimer = setTimeout(() => {
        buffer.debounceTimer = null;
        runLiveAnalysis(sessionIdStr, io, 'DEBOUNCE_EXPIRED');
      }, COPILOT_ANALYSIS_DEBOUNCE_MS);
    }
  } catch (err) {
    console.error(`[COPILOT-LIVE] onNewMessage error:`, err.message);
  }
}

async function runLiveAnalysis(sessionIdStr, io, triggerReason) {
  const buffer = pendingBuffers.get(sessionIdStr);
  if (!buffer || buffer.messageIds.size === 0 || buffer.isAnalyzing) {
    return;
  }

  buffer.isAnalyzing = true;
  console.log(`[COPILOT-LIVE] Running live analysis for session ${sessionIdStr} (Reason: ${triggerReason})`);

  try {
    const session = await Session.findById(sessionIdStr);
    if (!session || session.status !== 'active' || !session.mentor) {
      buffer.messageIds.clear();
      buffer.isAnalyzing = false;
      return;
    }

    const mentorId = session.mentor;
    let copilotState = await MentorCopilotSession.findOne({ sessionId: session._id, mentorId });
    if (!copilotState) {
      copilotState = new MentorCopilotSession({ sessionId: session._id, mentorId, roomId: session.roomId });
    }

    if (copilotState.isLivePaused) {
      buffer.messageIds.clear();
      buffer.isAnalyzing = false;
      return;
    }

    // Emit analysis start to Mentor ONLY
    copilotState.status = 'ANALYZING';
    notifyMentor(io, mentorId, 'copilot:analysis:start', {
      sessionId: sessionIdStr,
      status: 'ANALYZING',
      version: copilotState.analysisVersion
    });

    // Fetch messages
    const rawMessages = await Message.find({ sessionId: session._id.toString() }).sort({ createdAt: 1 });
    const cleanMessages = rawMessages.map(m => m.toObject());

    const analysisResult = await aiService.analyzeLiveContext(cleanMessages, copilotState, { roomId: session.roomId });

    const lastMsg = cleanMessages.length > 0 ? cleanMessages[cleanMessages.length - 1] : null;

    // Monotonically increase analysisVersion
    copilotState.analysisVersion = (copilotState.analysisVersion || 1) + 1;
    copilotState.currentTopic = analysisResult.currentTopic || copilotState.currentTopic;
    copilotState.topicConfidence = analysisResult.topicConfidence || 0.9;

    if (analysisResult.topicHistory) copilotState.topicHistory = analysisResult.topicHistory.slice(-10);
    if (analysisResult.keyPoints) copilotState.keyPoints = analysisResult.keyPoints.slice(-10);
    if (analysisResult.userGoals) copilotState.userGoals = analysisResult.userGoals.slice(-10);
    if (analysisResult.unresolvedTopics) copilotState.unresolvedTopics = analysisResult.unresolvedTopics.slice(-10);
    if (analysisResult.suggestedQuestions) copilotState.suggestedQuestions = analysisResult.suggestedQuestions.slice(-15);
    if (analysisResult.actionItems) copilotState.actionItems = analysisResult.actionItems.slice(-15);
    if (analysisResult.conversationSnapshot) copilotState.conversationSnapshot = analysisResult.conversationSnapshot;
    if (analysisResult.timeline) copilotState.timeline = analysisResult.timeline.slice(-20);
    if (analysisResult.whatChanged) copilotState.whatChanged = analysisResult.whatChanged.slice(-10);

    copilotState.lastAnalyzedMessageId = lastMsg ? (lastMsg._id ? lastMsg._id.toString() : null) : null;
    copilotState.analyzedMessageCount = (copilotState.analyzedMessageCount || 0) + 1;
    copilotState.lastAnalyzedAt = new Date();
    copilotState.updatedAt = new Date();
    copilotState.status = 'READY';

    await copilotState.save();
    buffer.messageIds.clear();

    console.log(`[COPILOT-LIVE] Live analysis complete. New version: v${copilotState.analysisVersion}`);

    // Private Mentor Socket Notification
    notifyMentor(io, mentorId, 'copilot:update', {
      sessionId: sessionIdStr,
      copilot: copilotState
    });
    notifyMentor(io, mentorId, 'copilot:analysis:complete', {
      sessionId: sessionIdStr,
      version: copilotState.analysisVersion,
      status: 'READY'
    });

  } catch (err) {
    console.error(`[COPILOT-LIVE] Analysis execution error:`, err.message);
    try {
      const session = await Session.findById(sessionIdStr);
      if (session && session.mentor) {
        notifyMentor(io, session.mentor, 'copilot:error', {
          sessionId: sessionIdStr,
          error: err.message
        });
      }
    } catch (_) {}
  } finally {
    if (buffer) buffer.isAnalyzing = false;
  }
}

function cancelPendingAnalysis(sessionIdStr) {
  const buffer = pendingBuffers.get(sessionIdStr);
  if (buffer) {
    if (buffer.debounceTimer) {
      clearTimeout(buffer.debounceTimer);
      buffer.debounceTimer = null;
    }
    buffer.messageIds.clear();
  }
}

module.exports = {
  onNewMessage,
  runLiveAnalysis,
  cancelPendingAnalysis
};
