const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId:    { type: String, required: true },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  senderRole: { type: String, enum: ['user', 'mentor'] },
  text:      { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // Auto-destruct 24h post-creation
});

module.exports = mongoose.model('Message', messageSchema);
