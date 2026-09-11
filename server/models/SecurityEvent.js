const mongoose = require('mongoose');

const securityEventSchema = new mongoose.Schema({
  type:      { type: String, required: true },
  actorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  severity:  { type: String, enum: ['INFO', 'WARNING', 'HIGH', 'CRITICAL'], default: 'INFO', index: true },
  metadata:  { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('SecurityEvent', securityEventSchema);
