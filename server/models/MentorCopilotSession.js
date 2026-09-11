const mongoose = require('mongoose');

const mentorCopilotSessionSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, unique: true, index: true },
  mentorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roomId:    { type: String, required: true, index: true },
  currentTopic: { type: String, default: 'General Emotional Support' },
  keyPoints: [{
    text: { type: String, required: true },
    sourceMessageIds: [{ type: String }],
    confidence: { type: Number, default: 0.9 }
  }],
  suggestedQuestions: [{
    question: { type: String, required: true },
    reason: { type: String, default: '' }
  }],
  actionItems: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    completed: { type: Boolean, default: false },
    sourceMessageIds: [{ type: String }]
  }],
  summary: {
    overview: { type: String, default: '' },
    keyTopics: [{ type: String }],
    goals: [{ type: String }],
    actionItems: [{ type: String }],
    followUpSuggestions: [{ type: String }],
    generatedAt: { type: Date, default: null }
  },
  lastAnalyzedMessageId: { type: String, default: null },
  lastAnalyzedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

mentorCopilotSessionSchema.index({ sessionId: 1, mentorId: 1 });

module.exports = mongoose.model('MentorCopilotSession', mentorCopilotSessionSchema);
