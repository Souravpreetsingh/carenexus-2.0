const mongoose = require('mongoose');

const mentorCopilotSessionSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, unique: true, index: true },
  mentorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  roomId:    { type: String, required: true, index: true },
  
  currentTopic: { type: String, default: 'General Emotional Support' },
  topicConfidence: { type: Number, default: 0.9 },
  topicHistory: [{
    topic: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
    confidence: { type: Number, default: 0.9 },
    sourceMessageIds: [{ type: String }]
  }],

  keyPoints: [{
    text: { type: String, required: true },
    sourceMessageIds: [{ type: String }],
    confidence: { type: Number, default: 0.9 }
  }],

  userGoals: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    confidence: { type: Number, default: 0.9 },
    sourceMessageIds: [{ type: String }],
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'ABANDONED'], default: 'ACTIVE' }
  }],

  unresolvedTopics: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    sourceMessageIds: [{ type: String }]
  }],

  suggestedQuestions: [{
    id: { type: String },
    question: { type: String, required: true },
    reason: { type: String, default: '' },
    generatedAt: { type: Date, default: Date.now },
    sourceMessageIds: [{ type: String }],
    used: { type: Boolean, default: false },
    dismissed: { type: Boolean, default: false }
  }],

  actionItems: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    completed: { type: Boolean, default: false },
    sourceMessageIds: [{ type: String }]
  }],

  conversationSnapshot: {
    topic: { type: String, default: '' },
    goal: { type: String, default: '' },
    recentDevelopment: { type: String, default: '' },
    unresolved: { type: String, default: '' }
  },

  timeline: [{
    id: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    timeStr: { type: String, default: '' },
    title: { type: String, required: true },
    type: { type: String, default: 'INFO' }
  }],

  whatChanged: [{
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],

  summary: {
    overview: { type: String, default: '' },
    keyTakeaways: [{ type: String }],
    keyTopics: [{ type: String }],
    goals: [{ type: String }],
    actionItems: [{ type: String }],
    suggestedFollowUps: [{ type: String }],
    generatedAt: { type: Date, default: null }
  },

  lastAnalyzedMessageId: { type: String, default: null },
  analyzedMessageCount:  { type: Number, default: 0 },
  analysisVersion:       { type: Number, default: 1 },
  status:                { type: String, enum: ['IDLE', 'ANALYZING', 'READY', 'ERROR', 'UNAVAILABLE'], default: 'IDLE' },
  isLivePaused:          { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

mentorCopilotSessionSchema.index({ sessionId: 1, mentorId: 1 });

module.exports = mongoose.model('MentorCopilotSession', mentorCopilotSessionSchema);
