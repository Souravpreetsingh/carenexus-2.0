const mongoose = require('mongoose');

const sessionIntelligenceSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, unique: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  mentorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  summary: { type: String, default: '' },

  keyTopics: [{
    topic: { type: String, required: true },
    sourceMessageIds: [{ type: String }]
  }],

  goals: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'PAUSED', 'ABANDONED'], default: 'ACTIVE' },
    sourceMessageIds: [{ type: String }],
    source: { type: String, enum: ['AI', 'MENTOR_EDITED'], default: 'AI' },
    confidence: { type: Number, default: 0.9 },
    createdAt: { type: Date, default: Date.now }
  }],

  actionItems: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'COMPLETED', 'DISMISSED'], default: 'OPEN' },
    sourceMessageIds: [{ type: String }],
    source: { type: String, enum: ['AI', 'MENTOR_EDITED'], default: 'AI' },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  }],

  followUpSuggestions: [{
    text: { type: String, required: true },
    sourceMessageIds: [{ type: String }]
  }],

  unresolvedAreas: [{
    text: { type: String, required: true }
  }],

  progressSignals: [{
    text: { type: String, required: true }
  }],

  comparison: {
    previousSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    summary: { type: String, default: '' },
    goalStatusSummary: { type: String, default: '' }
  },

  // Strictly Mentor Private Notes! Never exposed to user accounts or public endpoints.
  mentorNotes: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }],

  generationVersion: { type: Number, default: 1 },
  generatedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Compound indexes for user & mentor history lookups
sessionIntelligenceSchema.index({ userId: 1, createdAt: -1 });
sessionIntelligenceSchema.index({ mentorId: 1, createdAt: -1 });

module.exports = mongoose.model('SessionIntelligence', sessionIntelligenceSchema);
