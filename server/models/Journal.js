const mongoose = require('mongoose');

const journalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mood: { type: String, required: true },
  intensity: { type: Number, default: 5, min: 1, max: 10 },
  note: { type: String, default: '' },
  aiInsight: { type: String, default: '' },
  mindfulnessExercise: {
    title: { type: String },
    type: { type: String },
    duration: { type: String },
    steps: [{ type: String }]
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Journal', journalSchema);
