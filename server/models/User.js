const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user', 'mentor', 'admin'], default: 'user' },
  isApproved: { type: Boolean, default: true },
  bio: { type: String, default: '' },
  education: [{
    degree: { type: String },
    institution: { type: String },
    year: { type: String }
  }],
  achievements: [{
    title: { type: String },
    description: { type: String },
    icon: { type: String, default: 'military_tech' }
  }],
  specialties: [{ type: String }],
  experienceYears: { type: Number, default: 0 },
  rating: { type: Number, default: 5.0 },
  isAvailable: { type: Boolean, default: true },
  totalSessionsConducted: { type: Number, default: 0 },
  streakCount: { type: Number, default: 0 },
  lastCheckInDate: { type: String, default: '' },
  points: { type: Number, default: 0 },
  unlockedBadges: [{
    badgeId: { type: String },
    title: { type: String },
    icon: { type: String },
    unlockedAt: { type: Date, default: Date.now }
  }],
  accountStatus: { type: String, enum: ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED'], default: 'ACTIVE' },
  statusReason: { type: String, default: '' },
  statusExpiresAt: { type: Date, default: null },
  restrictionDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  completedQuestsToday: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('User', userSchema);
