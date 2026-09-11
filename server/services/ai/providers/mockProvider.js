const { analyzeText } = require('../../../utils/nlpEngine');

async function analyzeContext(messages = [], options = {}) {
  return analyzeLiveContext(messages, {}, options);
}

async function analyzeLiveContext(messages = [], existingState = {}, options = {}) {
  if (!messages || messages.length === 0) {
    return {
      currentTopic: existingState.currentTopic || 'General Emotional Support',
      topicConfidence: 0.85,
      topicHistory: existingState.topicHistory || [],
      keyPoints: existingState.keyPoints || [],
      userGoals: existingState.userGoals || [],
      unresolvedTopics: existingState.unresolvedTopics || [],
      suggestedQuestions: existingState.suggestedQuestions || [
        { id: `q_${Date.now()}_1`, question: 'What brings you to our safe space today?', reason: 'Help user articulate primary feelings.', used: false, dismissed: false }
      ],
      actionItems: existingState.actionItems || [],
      conversationSnapshot: existingState.conversationSnapshot || {
        topic: 'General Emotional Support',
        goal: 'Not specified yet',
        recentDevelopment: 'Session initiated',
        unresolved: 'Exploring member needs'
      },
      timeline: existingState.timeline || [],
      whatChanged: existingState.whatChanged || []
    };
  }

  const combinedText = messages.map(m => m.text).join(' ');
  const lowerText = combinedText.toLowerCase();

  // 1. Topic Identification
  let currentTopic = 'Emotional Reflection & Peer Support';
  if (lowerText.includes('work') || lowerText.includes('job') || lowerText.includes('boss') || lowerText.includes('career') || lowerText.includes('workload')) {
    currentTopic = 'Workplace Pressure & Task Management';
  } else if (lowerText.includes('anx') || lowerText.includes('panic') || lowerText.includes('stress') || lowerText.includes('worry')) {
    currentTopic = 'Anxiety Grounding & Stress Relief';
  } else if (lowerText.includes('sad') || lowerText.includes('lonely') || lowerText.includes('alone') || lowerText.includes('depress')) {
    currentTopic = 'Emotional Isolation & Mood Validation';
  } else if (lowerText.includes('sleep') || lowerText.includes('tired') || lowerText.includes('exhaust') || lowerText.includes('insomnia')) {
    currentTopic = 'Rest Recovery & Sleep Routine';
  } else if (lowerText.includes('study') || lowerText.includes('exam') || lowerText.includes('school') || lowerText.includes('grade')) {
    currentTopic = 'Academic Stress & Study Balance';
  }

  // Topic History Evolution
  const topicHistory = Array.isArray(existingState.topicHistory) ? [...existingState.topicHistory] : [];
  const lastTopicObj = topicHistory.length > 0 ? topicHistory[topicHistory.length - 1] : null;

  if (!lastTopicObj || lastTopicObj.topic !== currentTopic) {
    topicHistory.push({
      topic: currentTopic,
      startedAt: new Date(),
      lastActiveAt: new Date(),
      confidence: 0.92,
      sourceMessageIds: []
    });
  } else {
    lastTopicObj.lastActiveAt = new Date();
  }

  // 2. Key Points Extraction & Smart Merge
  const existingPointsMap = new Map((existingState.keyPoints || []).map(p => [p.text, p]));
  messages.forEach(m => {
    if (!m.text || m.isDeleted) return;
    const txt = m.text;
    const msgId = m._id ? m._id.toString() : (m.clientMessageId || null);

    if (txt.length > 15 && m.senderRole === 'user') {
      if (txt.toLowerCase().includes('feel') || txt.toLowerCase().includes('hard') || txt.toLowerCase().includes('struggle') || txt.toLowerCase().includes('want')) {
        const pointText = `User stated: "${txt.length > 75 ? txt.substring(0, 72) + '...' : txt}"`;
        if (!existingPointsMap.has(pointText)) {
          existingPointsMap.set(pointText, {
            text: pointText,
            sourceMessageIds: msgId ? [msgId] : [],
            confidence: 0.92
          });
        }
      }
    }
  });

  if (existingPointsMap.size === 0 && messages.length > 0) {
    const lastUserMsg = messages.filter(m => m.senderRole === 'user').pop();
    if (lastUserMsg) {
      const pointText = `User mentioned: "${lastUserMsg.text.length > 75 ? lastUserMsg.text.substring(0, 72) + '...' : lastUserMsg.text}"`;
      existingPointsMap.set(pointText, {
        text: pointText,
        sourceMessageIds: lastUserMsg._id ? [lastUserMsg._id.toString()] : [],
        confidence: 0.88
      });
    }
  }
  const keyPoints = Array.from(existingPointsMap.values()).slice(-8);

  // 3. User Goals Extraction
  const existingGoalsMap = new Map((existingState.userGoals || []).map(g => [g.text, g]));
  messages.forEach(m => {
    if (!m.text || m.isDeleted || m.senderRole !== 'user') return;
    const lower = m.text.toLowerCase();
    if (lower.includes('want to') || lower.includes('goal is') || lower.includes('hope to') || lower.includes('trying to') || lower.includes('need to')) {
      const goalText = `Goal: ${m.text.length > 70 ? m.text.substring(0, 67) + '...' : m.text}`;
      if (!existingGoalsMap.has(goalText)) {
        existingGoalsMap.set(goalText, {
          id: `goal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          text: goalText,
          confidence: 0.9,
          sourceMessageIds: m._id ? [m._id.toString()] : [],
          status: 'ACTIVE'
        });
      }
    }
  });
  if (existingGoalsMap.size === 0) {
    existingGoalsMap.set('General Support Goal', {
      id: `goal_def_1`,
      text: 'Express feelings and gain emotional clarity.',
      confidence: 0.85,
      sourceMessageIds: [],
      status: 'ACTIVE'
    });
  }
  const userGoals = Array.from(existingGoalsMap.values()).slice(-6);

  // 4. Unresolved Topics
  const unresolvedTopics = [];
  if (lowerText.includes('anx') || lowerText.includes('panic')) {
    unresolvedTopics.push({ id: `unres_1`, text: 'Root triggers causing anxiety spikes have not yet been fully identified.', sourceMessageIds: [] });
  }
  if (lowerText.includes('work') || lowerText.includes('study')) {
    unresolvedTopics.push({ id: `unres_2`, text: 'Specific time management boundaries need further exploration.', sourceMessageIds: [] });
  }
  if (unresolvedTopics.length === 0) {
    unresolvedTopics.push({ id: `unres_def`, text: 'Exploring coping mechanisms suited for member\'s current situation.', sourceMessageIds: [] });
  }

  // 5. Suggested Questions (Excluding asked/dismissed)
  const existingQuestions = existingState.suggestedQuestions || [];
  const askedTexts = new Set(existingQuestions.map(q => q.question));
  const candidateQuestions = [];

  if (currentTopic.includes('Anxiety')) {
    candidateQuestions.push({ question: 'When you feel anxiety rising, what physical sensations do you notice first?', reason: 'Encourage body awareness and grounding.' });
    candidateQuestions.push({ question: 'Have you tried guided 4-7-8 breathing or slow exhalations today?', reason: 'Offer practical calming technique.' });
    candidateQuestions.push({ question: 'What is one small thing that helped you ground yourself in the past?', reason: 'Identify proven coping tools.' });
  } else if (currentTopic.includes('Workplace') || currentTopic.includes('Academic')) {
    candidateQuestions.push({ question: 'What is the most pressing task causing you stress right now?', reason: 'Help prioritize manageable steps.' });
    candidateQuestions.push({ question: 'How are you setting boundaries between work and personal rest?', reason: 'Explore burnout prevention.' });
    candidateQuestions.push({ question: 'What support or tools would make this workload feel more manageable?', reason: 'Identify active solutions.' });
  } else {
    candidateQuestions.push({ question: 'What has been helping you feel supported recently?', reason: 'Identify existing coping mechanisms.' });
    candidateQuestions.push({ question: 'What would feel like a comforting next step for you today?', reason: 'Empower self-directed goals.' });
  }

  const suggestedQuestions = [...existingQuestions];
  candidateQuestions.forEach(c => {
    if (!askedTexts.has(c.question)) {
      suggestedQuestions.push({
        id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        question: c.question,
        reason: c.reason,
        generatedAt: new Date(),
        sourceMessageIds: [],
        used: false,
        dismissed: false
      });
    }
  });

  // 6. Action Items Merge
  const existingActionsMap = new Map((existingState.actionItems || []).map(a => [a.text, a]));
  if (lowerText.includes('routine') || lowerText.includes('schedule') || lowerText.includes('habit')) {
    const actText = 'Establish a gentle daily morning or evening routine.';
    if (!existingActionsMap.has(actText)) {
      existingActionsMap.set(actText, { id: `act_${Date.now()}_1`, text: actText, completed: false, sourceMessageIds: [] });
    }
  }
  if (lowerText.includes('breath') || lowerText.includes('relax') || lowerText.includes('calm')) {
    const actText = 'Practice 3 minutes of slow 4-7-8 breathing exercise.';
    if (!existingActionsMap.has(actText)) {
      existingActionsMap.set(actText, { id: `act_${Date.now()}_2`, text: actText, completed: false, sourceMessageIds: [] });
    }
  }
  if (existingActionsMap.size === 0) {
    const actText = 'Reflect on key insights discussed in today\'s session.';
    existingActionsMap.set(actText, { id: `act_${Date.now()}_def`, text: actText, completed: false, sourceMessageIds: [] });
  }
  const actionItems = Array.from(existingActionsMap.values()).slice(-10);

  // 7. Conversation Snapshot
  const lastUserMsg = messages.filter(m => m.senderRole === 'user').pop();
  const recentDev = lastUserMsg ? `User mentioned: "${lastUserMsg.text.length > 50 ? lastUserMsg.text.substring(0, 47) + '...' : lastUserMsg.text}"` : 'Active dialogue in progress.';
  const primaryGoal = userGoals.length > 0 ? userGoals[0].text : 'Emotional validation and clarity';
  const primaryUnresolved = unresolvedTopics.length > 0 ? unresolvedTopics[0].text : 'Ongoing exploration';

  const conversationSnapshot = {
    topic: currentTopic,
    goal: primaryGoal,
    recentDevelopment: recentDev,
    unresolved: primaryUnresolved
  };

  // 8. Timeline Events
  const timeline = Array.isArray(existingState.timeline) ? [...existingState.timeline] : [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (timeline.length === 0 || (lastTopicObj && lastTopicObj.topic !== currentTopic)) {
    timeline.push({
      id: `tl_${Date.now()}_1`,
      timestamp: now,
      timeStr,
      title: `Topic shifted to "${currentTopic}"`,
      type: 'TOPIC_SWITCH'
    });
  }

  // 9. What Changed Delta Entries
  const whatChanged = Array.isArray(existingState.whatChanged) ? [...existingState.whatChanged] : [];
  if (existingState.currentTopic && existingState.currentTopic !== currentTopic) {
    whatChanged.unshift({
      text: `Conversation focus evolved from "${existingState.currentTopic}" to "${currentTopic}".`,
      timestamp: now
    });
  } else if (messages.length > (existingState.analyzedMessageCount || 0)) {
    whatChanged.unshift({
      text: `Incorporated ${messages.length - (existingState.analyzedMessageCount || 0)} new message(s) into session analysis context.`,
      timestamp: now
    });
  }

  return {
    currentTopic,
    topicConfidence: 0.92,
    topicHistory: topicHistory.slice(-10),
    keyPoints,
    userGoals,
    unresolvedTopics: unresolvedTopics.slice(-10),
    suggestedQuestions: suggestedQuestions.slice(-12),
    actionItems,
    conversationSnapshot,
    timeline: timeline.slice(-20),
    whatChanged: whatChanged.slice(-8)
  };
}

async function generateAskNext(messages = [], existingState = {}, options = {}) {
  const currentTopic = existingState.currentTopic || 'General Emotional Support';
  const questions = [];

  if (currentTopic.includes('Anxiety') || currentTopic.includes('Stress')) {
    questions.push({ question: 'What part of this situation feels hardest to manage right now?', reason: 'Focus on primary emotional bottleneck.' });
    questions.push({ question: 'What has helped you regain a sense of calm in similar moments?', reason: 'Identify past grounding strengths.' });
    questions.push({ question: 'If we break this down into one small step today, what would that look like?', reason: 'Actionable micro-step.' });
  } else {
    questions.push({ question: 'How are you holding up emotionally with everything going on?', reason: 'Validate underlying feelings.' });
    questions.push({ question: 'What kind of support would feel most helpful for you right now?', reason: 'Guide collaborative peer session.' });
    questions.push({ question: 'What is one thing you can do for yourself today to rest?', reason: 'Promote compassionate self-care.' });
  }

  return { questions: questions.slice(0, 3) };
}

async function generateCatchUp(messages = [], existingState = {}, options = {}) {
  const userMsgs = messages.filter(m => m.senderRole === 'user');
  const recentUserMsgs = userMsgs.slice(-4);
  const topic = existingState.currentTopic || 'Emotional Support';

  let catchUpText = `The conversation is currently centered on **${topic}**. `;
  if (recentUserMsgs.length > 0) {
    const snippets = recentUserMsgs.map(m => `"${m.text.length > 40 ? m.text.substring(0, 37) + '...' : m.text}"`).join(', ');
    catchUpText += `Recently, the member shared key details including: ${snippets}. `;
  }
  catchUpText += `The member expresses a desire for validation and actionable grounding strategies.`;

  return { catchUpText };
}

async function generateWhatChanged(existingState = {}, newAnalysis = {}, options = {}) {
  const changes = [];
  if (existingState.currentTopic !== newAnalysis.currentTopic) {
    changes.push(`Primary topic changed from "${existingState.currentTopic || 'Initial'}" to "${newAnalysis.currentTopic}".`);
  }
  const newPointsCount = (newAnalysis.keyPoints || []).length - (existingState.keyPoints || []).length;
  if (newPointsCount > 0) {
    changes.push(`Identified ${newPointsCount} new key statement(s) from recent member messages.`);
  }
  if (newAnalysis.userGoals && newAnalysis.userGoals.length > (existingState.userGoals || []).length) {
    changes.push(`Updated member goals tracking with latest stated intentions.`);
  }
  if (changes.length === 0) {
    changes.push('Re-analyzed recent messages; member remains focused on active discussion topic.');
  }

  return { changes };
}

async function generateSummary(messages = [], options = {}) {
  const liveRes = await analyzeLiveContext(messages, {}, options);
  const userMsgs = messages.filter(m => m.senderRole === 'user');

  const overview = userMsgs.length > 0
    ? `The member engaged in a reflective peer session focusing on ${liveRes.currentTopic.toLowerCase()}. Key discussion highlighted emotional validation and practical coping strategies.`
    : `Support session initiated for ${liveRes.currentTopic.toLowerCase()}.`;

  const keyTakeaways = (liveRes.keyPoints || []).map(k => typeof k === 'string' ? k : (k.text || k.point || JSON.stringify(k)));
  if (keyTakeaways.length === 0) {
    keyTakeaways.push('Member shared emotional reflections in a safe environment.');
  }

  return {
    overview,
    keyTakeaways,
    keyTopics: [liveRes.currentTopic, 'Emotional Grounding', 'Peer Guidance'],
    goals: (liveRes.userGoals || []).map(g => g.text),
    actionItems: (liveRes.actionItems || []).map(a => typeof a === 'string' ? a : a.text),
    suggestedFollowUps: (liveRes.suggestedQuestions || []).map(q => typeof q === 'string' ? q : q.question),
    generatedAt: new Date()
  };
}

async function generateSessionIntelligence(messages = [], liveCopilotState = {}, previousIntelligence = null, options = {}) {
  const liveRes = await analyzeLiveContext(messages, liveCopilotState, options);
  const userMsgs = messages.filter(m => m && m.senderRole === 'user');

  const summary = userMsgs.length > 0
    ? `The conversation focused on ${liveRes.currentTopic.toLowerCase()} and exploring practical ways to build consistency. The user discussed personal challenges and expressed intentions for ongoing support.`
    : `The support session concluded with focus on ${liveRes.currentTopic.toLowerCase()}.`;

  const keyTopics = [
    { topic: liveRes.currentTopic || 'General Support', sourceMessageIds: [] },
    { topic: 'Consistency & Routine', sourceMessageIds: [] }
  ];

  const goals = (liveRes.userGoals && liveRes.userGoals.length > 0)
    ? liveRes.userGoals.map((g, idx) => ({
        id: g.id || `g_${Date.now()}_${idx}`,
        text: g.text || 'Improve daily routine',
        status: g.status || 'ACTIVE',
        sourceMessageIds: g.sourceMessageIds || [],
        source: 'AI',
        confidence: g.confidence || 0.9,
        createdAt: new Date()
      }))
    : [{
        id: `g_${Date.now()}_1`,
        text: 'Develop a manageable daily routine',
        status: 'ACTIVE',
        sourceMessageIds: [],
        source: 'AI',
        confidence: 0.9,
        createdAt: new Date()
      }];

  const actionItems = (liveRes.actionItems && liveRes.actionItems.length > 0)
    ? liveRes.actionItems.map((a, idx) => ({
        id: a.id || `act_${Date.now()}_${idx}`,
        text: typeof a === 'string' ? a : a.text,
        status: a.completed ? 'COMPLETED' : 'OPEN',
        sourceMessageIds: a.sourceMessageIds || [],
        source: 'AI',
        dueAt: null,
        completedAt: a.completed ? new Date() : null,
        createdAt: new Date()
      }))
    : [{
        id: `act_${Date.now()}_1`,
        text: 'Review progress on daily routine before next session',
        status: 'OPEN',
        sourceMessageIds: [],
        source: 'AI',
        dueAt: null,
        completedAt: null,
        createdAt: new Date()
      }];

  const followUpSuggestions = (liveRes.suggestedQuestions && liveRes.suggestedQuestions.length > 0)
    ? liveRes.suggestedQuestions.map(q => ({
        text: typeof q === 'string' ? q : q.question,
        sourceMessageIds: []
      }))
    : [
        { text: 'Review whether the new routine was sustainable.', sourceMessageIds: [] },
        { text: 'Explore which workload factors remain difficult.', sourceMessageIds: [] }
      ];

  const unresolvedAreas = (liveRes.unresolvedTopics && liveRes.unresolvedTopics.length > 0)
    ? liveRes.unresolvedTopics.map(u => ({ text: u.text }))
    : [{ text: 'Specific workload changes have not yet been fully explored.' }];

  const progressSignals = [
    { text: "The conversation indicates increased clarity around the user's stated goal." }
  ];

  let comparison = {
    previousSessionId: previousIntelligence ? previousIntelligence.sessionId : null,
    summary: previousIntelligence ? 'User continues work toward stated goals from prior session.' : 'Initial session completed.',
    goalStatusSummary: previousIntelligence ? 'Goal remains active and progressing.' : 'Initial goals established.'
  };

  return {
    summary,
    keyTopics,
    goals,
    actionItems,
    followUpSuggestions,
    unresolvedAreas,
    progressSignals,
    comparison
  };
}

module.exports = {
  analyzeContext,
  analyzeLiveContext,
  generateAskNext,
  generateCatchUp,
  generateWhatChanged,
  generateSummary,
  generateSessionIntelligence
};
