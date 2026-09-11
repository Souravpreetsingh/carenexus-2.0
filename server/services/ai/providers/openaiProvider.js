const mockProvider = require('./mockProvider');

async function callLLM(prompt, systemInstructions, options = {}) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY not configured');
  }

  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemInstructions },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API returned HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Empty LLM response content');
  }

  return JSON.parse(rawContent);
}

async function analyzeContext(messages = [], options = {}) {
  return analyzeLiveContext(messages, {}, options);
}

async function analyzeLiveContext(messages = [], existingState = {}, options = {}) {
  try {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return await mockProvider.analyzeLiveContext(messages, existingState, options);

    const formattedHistory = messages.map(m => `[${m.senderRole.toUpperCase()}] ${m._id ? `(id:${m._id})` : ''}: ${m.text}`).join('\n');

    const systemInstructions = `You are the CareNexus AI Mentor Copilot system.
Your job is to analyze the active conversation between a User and a Mentor to assist the Mentor.
You are a PRIVATE assistant for the Mentor. Never output medical diagnoses or clinical prescriptions.

Output strict JSON matching this schema:
{
  "currentTopic": "Short topic string",
  "topicConfidence": 0.9,
  "keyPoints": [
    { "text": "Key observation", "sourceMessageIds": ["msgId"], "confidence": 0.9 }
  ],
  "userGoals": [
    { "id": "goal_1", "text": "Stated user goal", "confidence": 0.9, "sourceMessageIds": [], "status": "ACTIVE" }
  ],
  "unresolvedTopics": [
    { "id": "unres_1", "text": "Unresolved issue", "sourceMessageIds": [] }
  ],
  "suggestedQuestions": [
    { "id": "q_1", "question": "Follow-up question?", "reason": "Why this question helps." }
  ],
  "actionItems": [
    { "id": "act_1", "text": "Action item description", "completed": false, "sourceMessageIds": [] }
  ],
  "conversationSnapshot": {
    "topic": "Current topic",
    "goal": "Primary goal",
    "recentDevelopment": "Recent development",
    "unresolved": "Primary unresolved area"
  }
}`;

    const prompt = `<chat_history>\n${formattedHistory}\n</chat_history>\n\nAnalyze the chat history above and return structured JSON.`;

    const json = await callLLM(prompt, systemInstructions, options);
    return {
      currentTopic: json.currentTopic || existingState.currentTopic || 'General Support',
      topicConfidence: json.topicConfidence || 0.9,
      keyPoints: Array.isArray(json.keyPoints) ? json.keyPoints : [],
      userGoals: Array.isArray(json.userGoals) ? json.userGoals : [],
      unresolvedTopics: Array.isArray(json.unresolvedTopics) ? json.unresolvedTopics : [],
      suggestedQuestions: Array.isArray(json.suggestedQuestions) ? json.suggestedQuestions : [],
      actionItems: Array.isArray(json.actionItems) ? json.actionItems : [],
      conversationSnapshot: json.conversationSnapshot || {}
    };
  } catch (err) {
    console.warn('[OPENAI-PROVIDER] Live context LLM call failed, falling back to mock provider:', err.message);
    return await mockProvider.analyzeLiveContext(messages, existingState, options);
  }
}

async function generateAskNext(messages = [], existingState = {}, options = {}) {
  try {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return await mockProvider.generateAskNext(messages, existingState, options);

    const formattedHistory = messages.slice(-10).map(m => `[${m.senderRole.toUpperCase()}]: ${m.text}`).join('\n');
    const systemInstructions = `You are the CareNexus AI Mentor Copilot.
Generate 1-3 targeted, empathetic follow-up questions for the mentor to ask next.
Return JSON format: { "questions": [ { "question": "...", "reason": "..." } ] }`;

    const json = await callLLM(`<chat_history>\n${formattedHistory}\n</chat_history>`, systemInstructions, options);
    return { questions: Array.isArray(json.questions) ? json.questions : [] };
  } catch (err) {
    return await mockProvider.generateAskNext(messages, existingState, options);
  }
}

async function generateCatchUp(messages = [], existingState = {}, options = {}) {
  try {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) return await mockProvider.generateCatchUp(messages, existingState, options);

    const formattedHistory = messages.slice(-12).map(m => `[${m.senderRole.toUpperCase()}]: ${m.text}`).join('\n');
    const systemInstructions = `You are the CareNexus AI Mentor Copilot.
Provide a concise private catch-up summary of the latest conversation developments for the mentor.
Return JSON format: { "catchUpText": "..." }`;

    const json = await callLLM(`<chat_history>\n${formattedHistory}\n</chat_history>`, systemInstructions, options);
    return { catchUpText: json.catchUpText || 'Latest conversation analyzed.' };
  } catch (err) {
    return await mockProvider.generateCatchUp(messages, existingState, options);
  }
}

async function generateWhatChanged(existingState = {}, newAnalysis = {}, options = {}) {
  return await mockProvider.generateWhatChanged(existingState, newAnalysis, options);
}

async function generateSummary(messages = [], options = {}) {
  try {
    const formattedHistory = messages.map(m => `[${m.senderRole.toUpperCase()}]: ${m.text}`).join('\n');

    const systemInstructions = `You are the CareNexus AI Mentor Copilot system.
Generate a structured, professional session summary for the Mentor.
Output strict JSON matching this schema:
{
  "overview": "Short neutral summary of the session",
  "keyTakeaways": ["Takeaway 1"],
  "keyTopics": ["Topic 1", "Topic 2"],
  "goals": ["Goal 1"],
  "actionItems": ["Action 1"],
  "suggestedFollowUps": ["Suggestion 1"]
}`;

    const prompt = `<chat_history>\n${formattedHistory}\n</chat_history>\n\nSummarize the session history above in JSON format.`;

    const json = await callLLM(prompt, systemInstructions, options);
    return {
      overview: json.overview || 'Session summary generated.',
      keyTakeaways: Array.isArray(json.keyTakeaways) ? json.keyTakeaways : [],
      keyTopics: Array.isArray(json.keyTopics) ? json.keyTopics : [],
      goals: Array.isArray(json.goals) ? json.goals : [],
      actionItems: Array.isArray(json.actionItems) ? json.actionItems : [],
      suggestedFollowUps: Array.isArray(json.suggestedFollowUps) ? json.suggestedFollowUps : [],
      generatedAt: new Date()
    };
  } catch (err) {
    console.warn('[OPENAI-PROVIDER] Summary LLM call failed, falling back to mock provider:', err.message);
    return await mockProvider.generateSummary(messages, options);
  }
}

module.exports = {
  analyzeContext,
  analyzeLiveContext,
  generateAskNext,
  generateCatchUp,
  generateWhatChanged,
  generateSummary
};
