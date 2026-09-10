const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId:          { type: String, required: true, index: true },
  sessionId:       { type: String, index: true },
  clientMessageId: { type: String, unique: true, sparse: true },
  sender:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  senderRole:      { type: String, enum: ['user', 'mentor'] },
  text:            { type: String, required: true },
  createdAt:       { type: Date, default: Date.now }
});

messageSchema.index({ roomId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);

