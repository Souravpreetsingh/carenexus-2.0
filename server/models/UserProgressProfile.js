const mongoose = require('mongoose');

const userProgressProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

  activeGoals: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'PAUSED', 'ABANDONED'], default: 'ACTIVE' },
    sourceMessageIds: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }],

  completedGoals: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    completedAt: { type: Date, default: Date.now }
  }],

  recentTopics: [{ type: String }],
  recurringTopics: [{ type: String }],

  progressTimeline: [{
    id: { type: String, required: true },
    date: { type: Date, default: Date.now },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'session' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null }
  }],

  lastSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  lastUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('UserProgressProfile', userProgressProfileSchema);
