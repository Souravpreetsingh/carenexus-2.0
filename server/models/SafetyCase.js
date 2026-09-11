const mongoose = require('mongoose');

const safetyCaseSchema = new mongoose.Schema({
  caseNumber:      { type: String, required: true, unique: true, index: true },
  reporterId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reporterRole:    { type: String, enum: ['user', 'mentor', 'admin'], required: true },
  reportedUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reportedRole:    { type: String, enum: ['user', 'mentor', 'admin'] },
  sessionId:       { type: String, default: null, index: true },
  roomId:          { type: String, default: null },
  messageId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  category:        { type: String, required: true, enum: ['HARASSMENT', 'ABUSE', 'SPAM', 'INAPPROPRIATE_CONTENT', 'FRAUD', 'SAFETY_CONCERN', 'PROFESSIONAL_CONDUCT', 'OTHER'] },
  description:     { type: String, default: '' },
  priority:        { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  status:          { type: String, enum: ['OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED'], default: 'OPEN', index: true },
  assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  resolution:      { type: String, default: '' },
  internalNotes:   [{
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  evidence:        { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date, default: Date.now },
  resolvedAt:      { type: Date, default: null }
});

safetyCaseSchema.index({ status: 1, priority: 1, createdAt: -1 });

module.exports = mongoose.model('SafetyCase', safetyCaseSchema);
