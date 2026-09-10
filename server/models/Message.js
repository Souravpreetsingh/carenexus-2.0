const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  roomId:          { type: String, required: true, index: true },
  sessionId:       { type: String, index: true },
  clientMessageId: { type: String, unique: true, sparse: true },
  sender:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  senderRole:      { type: String, enum: ['user', 'mentor'] },
  text:            { type: String, required: true },
  replyToMessageId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null, index: true },
  reactions:       [{
    emoji: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userRole: { type: String, enum: ['user', 'mentor'] },
    createdAt: { type: Date, default: Date.now }
  }],
  isEdited:        { type: Boolean, default: false },
  editedAt:        { type: Date, default: null },
  isDeleted:       { type: Boolean, default: false },
  deletedAt:       { type: Date, default: null },
  deletedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt:       { type: Date, default: Date.now }
});

messageSchema.index({ roomId: 1, createdAt: 1 });
messageSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);

