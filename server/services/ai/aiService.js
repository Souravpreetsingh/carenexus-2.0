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

  // Filter out deleted messages
  const valid = rawMessages.filter(m => m && !m.isDeleted && m.text);
  const sliced = valid.slice(-maxMessages);

  // Character limit budget check
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
  try {
    const cleanMessages = sanitizeAndLimitMessages(messages);
    const provider = getActiveProvider();
    return await provider.analyzeContext(cleanMessages, options);
  } catch (err) {
    console.error('[AI-SERVICE] Context analysis error:', err.message);
    return await mockProvider.analyzeContext(messages, options);
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

module.exports = {
  analyzeSessionContext,
  generateSessionSummary
};
