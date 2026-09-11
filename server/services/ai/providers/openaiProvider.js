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
  try {
    const formattedHistory = messages.map(m => `[${m.senderRole.toUpperCase()}] ${m._id ? `(id:${m._id})` : ''}: ${m.text}`).join('\n');

    const systemInstructions = `You are the CareNexus AI Mentor Copilot system.
Your job is to analyze the conversation between a User and a Mentor to help the Mentor understand the discussion.
You are a PRIVATE assistant for the Mentor. Never output medical diagnoses or prescriptions.
Output strict JSON matching this schema:
{
  "currentTopic": "Short topic string",
  "keyPoints": [
    { "text": "Key observation", "sourceMessageIds": ["msgId"], "confidence": 0.9 }
  ],
  "suggestedQuestions": [
    { "question": "Follow-up question?", "reason": "Why this question helps." }
  ],
  "actionItems": [
    { "id": "act_1", "text": "Action item description", "completed": false, "sourceMessageIds": [] }
  ]
}`;

    const prompt = `<chat_history>\n${formattedHistory}\n</chat_history>\n\nAnalyze the chat history above and return structured JSON.`;

    const json = await callLLM(prompt, systemInstructions, options);
    return {
      currentTopic: json.currentTopic || 'General Support',
      keyPoints: Array.isArray(json.keyPoints) ? json.keyPoints : [],
      suggestedQuestions: Array.isArray(json.suggestedQuestions) ? json.suggestedQuestions : [],
      actionItems: Array.isArray(json.actionItems) ? json.actionItems : []
    };
  } catch (err) {
    console.warn('[OPENAI-PROVIDER] LLM call failed, falling back to mock provider:', err.message);
    return await mockProvider.analyzeContext(messages, options);
  }
}

async function generateSummary(messages = [], options = {}) {
  try {
    const formattedHistory = messages.map(m => `[${m.senderRole.toUpperCase()}]: ${m.text}`).join('\n');

    const systemInstructions = `You are the CareNexus AI Mentor Copilot system.
Generate a structured, professional session summary for the Mentor.
Output strict JSON matching this schema:
{
  "overview": "Short neutral summary of the session",
  "keyTopics": ["Topic 1", "Topic 2"],
  "goals": ["Goal 1"],
  "actionItems": ["Action 1"],
  "followUpSuggestions": ["Suggestion 1"]
}`;

    const prompt = `<chat_history>\n${formattedHistory}\n</chat_history>\n\nSummarize the session history above in JSON format.`;

    const json = await callLLM(prompt, systemInstructions, options);
    return {
      overview: json.overview || 'Session summary generated.',
      keyTopics: Array.isArray(json.keyTopics) ? json.keyTopics : [],
      goals: Array.isArray(json.goals) ? json.goals : [],
      actionItems: Array.isArray(json.actionItems) ? json.actionItems : [],
      followUpSuggestions: Array.isArray(json.followUpSuggestions) ? json.followUpSuggestions : [],
      generatedAt: new Date()
    };
  } catch (err) {
    console.warn('[OPENAI-PROVIDER] Summary LLM call failed, falling back to mock provider:', err.message);
    return await mockProvider.generateSummary(messages, options);
  }
}

module.exports = {
  analyzeContext,
  generateSummary
};
