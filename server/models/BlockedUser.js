const mongoose = require('mongoose');

const blockedUserSchema = new mongoose.Schema({
  blockerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  blockedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason:        { type: String, default: '' },
  createdAt:     { type: Date, default: Date.now }
});

blockedUserSchema.index({ blockerId: 1, blockedUserId: 1 }, { unique: true });

module.exports = mongoose.model('BlockedUser', blockedUserSchema);
