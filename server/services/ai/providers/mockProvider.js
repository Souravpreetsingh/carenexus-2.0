const { analyzeText } = require('../../../utils/nlpEngine');

async function analyzeContext(messages = [], options = {}) {
  if (!messages || messages.length === 0) {
    return {
      currentTopic: 'General Support & Active Listening',
      keyPoints: [],
      suggestedQuestions: [
        { question: 'What brings you to our safe space today?', reason: 'Help user articulate their primary feeling.' },
        { question: 'How has your day been feeling so far?', reason: 'Gently explore recent emotional baseline.' }
      ],
      actionItems: []
    };
  }

  const combinedText = messages.map(m => m.text).join(' ');
  const lowerText = combinedText.toLowerCase();
  const nlp = analyzeText(combinedText);

  // Determine current topic
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

  // Extract key points
  const keyPoints = [];
  messages.forEach(m => {
    if (!m.text || m.isDeleted) return;
    const txt = m.text;
    const msgId = m._id ? m._id.toString() : (m.clientMessageId || null);

    if (txt.length > 15) {
      if (m.senderRole === 'user') {
        if (txt.toLowerCase().includes('feel') || txt.toLowerCase().includes('hard') || txt.toLowerCase().includes('struggle') || txt.toLowerCase().includes('want')) {
          keyPoints.push({
            text: `User stated: "${txt.length > 70 ? txt.substring(0, 67) + '...' : txt}"`,
            sourceMessageIds: msgId ? [msgId] : [],
            confidence: 0.92
          });
        }
      }
    }
  });

  if (keyPoints.length === 0 && messages.length > 0) {
    const lastUserMsg = messages.filter(m => m.senderRole === 'user').pop();
    if (lastUserMsg) {
      keyPoints.push({
        text: `User mentioned: "${lastUserMsg.text.length > 70 ? lastUserMsg.text.substring(0, 67) + '...' : lastUserMsg.text}"`,
        sourceMessageIds: lastUserMsg._id ? [lastUserMsg._id.toString()] : [],
        confidence: 0.88
      });
    }
  }

  // Suggested Questions
  const suggestedQuestions = [];
  if (currentTopic.includes('Anxiety')) {
    suggestedQuestions.push({ question: 'When you feel anxiety rising, what physical sensations do you notice first?', reason: 'Encourage body awareness and grounding.' });
    suggestedQuestions.push({ question: 'Have you tried guided 4-7-8 breathing or slow exhalations today?', reason: 'Offer practical calming technique.' });
  } else if (currentTopic.includes('Workplace') || currentTopic.includes('Academic')) {
    suggestedQuestions.push({ question: 'What is the most pressing task causing you stress right now?', reason: 'Help prioritize manageable steps.' });
    suggestedQuestions.push({ question: 'How are you setting boundaries between work and personal rest?', reason: 'Explore burnout prevention.' });
  } else {
    suggestedQuestions.push({ question: 'What has been helping you feel supported recently?', reason: 'Identify existing coping mechanisms.' });
    suggestedQuestions.push({ question: 'What would feel like a comforting next step for you today?', reason: 'Empower self-directed goals.' });
  }

  // Action Items
  const actionItems = [];
  if (lowerText.includes('routine') || lowerText.includes('schedule') || lowerText.includes('habit')) {
    actionItems.push({ id: `act_${Date.now()}_1`, text: 'Establish a gentle daily morning or evening routine.', completed: false });
  }
  if (lowerText.includes('breath') || lowerText.includes('relax') || lowerText.includes('calm')) {
    actionItems.push({ id: `act_${Date.now()}_2`, text: 'Practice 3 minutes of slow 4-7-8 breathing exercise.', completed: false });
  }
  if (actionItems.length === 0) {
    actionItems.push({ id: `act_${Date.now()}_def`, text: 'Reflect on key insights discussed in today\'s session.', completed: false });
  }

  return {
    currentTopic,
    keyPoints: keyPoints.slice(0, 5),
    suggestedQuestions: suggestedQuestions.slice(0, 4),
    actionItems: actionItems.slice(0, 4)
  };
}

async function generateSummary(messages = [], options = {}) {
  const analysis = await analyzeContext(messages, options);
  const userMsgs = messages.filter(m => m.senderRole === 'user');

  const overview = userMsgs.length > 0
    ? `The member engaged in a reflective peer session focusing on ${analysis.currentTopic.toLowerCase()}. Key discussion highlighted emotional validation and practical coping strategies.`
    : `Support session initiated for ${analysis.currentTopic.toLowerCase()}.`;

  const keyTakeaways = (analysis.keyPoints || []).map(k => typeof k === 'string' ? k : (k.text || k.point || JSON.stringify(k)));
  if (keyTakeaways.length === 0) {
    keyTakeaways.push('Member shared emotional reflections in a safe environment.');
  }

  return {
    overview,
    keyTakeaways,
    keyTopics: [analysis.currentTopic, 'Emotional Grounding', 'Peer Guidance'],
    goals: ['Identify primary stressors', 'Establish calm coping habits'],
    actionItems: (analysis.actionItems || []).map(a => typeof a === 'string' ? a : a.text),
    suggestedFollowUps: (analysis.suggestedQuestions || []).map(q => typeof q === 'string' ? q : q.question),
    generatedAt: new Date()
  };
}

module.exports = {
  analyzeContext,
  generateSummary
};
