const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorRole:        { type: String, required: true },
  action:           { type: String, required: true },
  entityType:       { type: String, required: true },
  entityId:         { type: String, required: true },
  metadata:         { type: mongoose.Schema.Types.Mixed, default: {} },
  ipHash:           { type: String, default: '' },
  userAgentSummary: { type: String, default: '' },
  createdAt:        { type: Date, default: Date.now, index: true }
});

auditLogSchema.index({ entityType: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
