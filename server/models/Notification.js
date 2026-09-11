const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipientRole: { type: String, enum: ['user', 'mentor', 'admin'], required: true },
  type:          { type: String, required: true },
  title:         { type: String, required: true },
  body:          { type: String, required: true },
  data:          { type: mongoose.Schema.Types.Mixed, default: {} },
  entityType:    { type: String, default: null },
  entityId:      { type: String, default: null },
  sessionId:     { type: String, default: null },
  roomId:        { type: String, default: null },
  actorId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole:     { type: String, default: null },
  readAt:        { type: Date, default: null },
  dedupeKey:     { type: String, default: null, sparse: true, unique: true },
  expiresAt:     { type: Date, default: null },
  createdAt:     { type: Date, default: Date.now }
});

notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
