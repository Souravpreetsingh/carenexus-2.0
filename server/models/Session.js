const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mentor:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  roomId:  { type: String, unique: true },
  status:    { type: String, enum: ['pending', 'active', 'completed'], default: 'pending' },
  moodTag:   { type: String, default: 'General Support' },
  userFeelingsNote: { type: String, default: '' },
  crisisLevel: { type: String, enum: ['none', 'moderate', 'critical'], default: 'none' },
  matchScore: { type: Number, default: 95 },
  recommendedMentor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  aiGuidance: {
    summary: { type: String, default: '' },
    distressLevel: { type: String, default: 'none' },
    suggestedApproach: { type: String, default: '' }
  },
  previousSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  completedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

sessionSchema.index({ user: 1, status: 1 });
sessionSchema.index({ mentor: 1, status: 1 });
sessionSchema.index({ previousSessionId: 1 });

module.exports = mongoose.model('Session', sessionSchema);
