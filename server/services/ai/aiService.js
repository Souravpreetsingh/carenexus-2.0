const mockProvider = require('./providers/mockProvider');
const openaiProvider = require('./providers/openaiProvider');

function getActiveProvider() {
  const provider = (process.env.AI_PROVIDER || '').toLowerCase();
  if (provider === 'openai' || provider === 'openrouter' || (process.env.AI_API_KEY && provider !== 'mock')) {
    return openaiProvider;
  }
  return mockProvider;
}

function sanitizeAndLimitMessages(rawMessages = []) {
  const maxMessages = Number(process.env.COPILOT_MAX_MESSAGES) || 30;
  const maxChars = Number(process.env.COPILOT_MAX_CONTEXT_CHARS) || 8000;

  const valid = rawMessages.filter(m => m && !m.isDeleted && m.text);
  const sliced = valid.slice(-maxMessages);

  let charCount = 0;
  const budgeted = [];

  for (let i = sliced.length - 1; i >= 0; i--) {
    const msg = sliced[i];
    const textLen = (msg.text || '').length;
    if (charCount + textLen > maxChars) break;
    charCount += textLen;
    budgeted.unshift(msg);
  }

  return budgeted;
}

async function analyzeSessionContext(messages = [], options = {}) {
  return analyzeLiveContext(messages, {}, options);
}

async function analyzeLiveContext(messages = [], existingState = {}, options = {}) {
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.analyzeLiveContext(cleanMessages, existingState, options);
  } catch (err) {
    console.error('[AI-SERVICE] Context analysis error:', err.message);
    return await mockProvider.analyzeLiveContext(messages, existingState, options);
  }
}

async function generateAskNext(messages = [], existingState = {}, options = {}) {
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.generateAskNext(cleanMessages, existingState, options);
  } catch (err) {
    console.error('[AI-SERVICE] generateAskNext error:', err.message);
    return await mockProvider.generateAskNext(messages, existingState, options);
  }
}

async function generateCatchUp(messages = [], existingState = {}, options = {}) {
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.generateCatchUp(cleanMessages, existingState, options);
  } catch (err) {
    console.error('[AI-SERVICE] generateCatchUp error:', err.message);
    return await mockProvider.generateCatchUp(messages, existingState, options);
  }
}

async function generateWhatChanged(existingState = {}, newAnalysis = {}, options = {}) {
  try {
    const provider = getActiveProvider();
    return await provider.generateWhatChanged(existingState, newAnalysis, options);
  } catch (err) {
    console.error('[AI-SERVICE] generateWhatChanged error:', err.message);
    return await mockProvider.generateWhatChanged(existingState, newAnalysis, options);
  }
}

async function generateSessionSummary(messages = [], options = {}) {
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.generateSummary(cleanMessages, options);
  } catch (err) {
    console.error('[AI-SERVICE] Summary generation error:', err.message);
    return await mockProvider.generateSummary(messages, options);
  }
}

async function generateSessionIntelligence(messages = [], liveCopilotState = {}, previousIntelligence = null, options = {}) {
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.generateSessionIntelligence(cleanMessages, liveCopilotState, previousIntelligence, options);
  } catch (err) {
    console.error('[AI-SERVICE] generateSessionIntelligence error:', err.message);
    return await mockProvider.generateSessionIntelligence(messages, liveCopilotState, previousIntelligence, options);
  }
}

module.exports = {
  analyzeSessionContext,
  analyzeLiveContext,
  generateAskNext,
  generateCatchUp,
  generateWhatChanged,
  generateSessionSummary,
  generateSessionIntelligence
};
