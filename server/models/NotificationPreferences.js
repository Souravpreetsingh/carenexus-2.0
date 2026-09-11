const mongoose = require('mongoose');

const notificationPreferencesSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  inApp: {
    messages:     { type: Boolean, default: true },
    replies:      { type: Boolean, default: true },
    reactions:    { type: Boolean, default: true },
    sessions:     { type: Boolean, default: true },
    appointments: { type: Boolean, default: true },
    safety:       { type: Boolean, default: true },
    system:       { type: Boolean, default: true }
  },
  browserPush: {
    messages:     { type: Boolean, default: true },
    sessions:     { type: Boolean, default: true },
    appointments: { type: Boolean, default: true },
    safety:       { type: Boolean, default: true },
    system:       { type: Boolean, default: true }
  },
  email: {
    messages:     { type: Boolean, default: false },
    sessions:     { type: Boolean, default: true },
    appointments: { type: Boolean, default: true },
    safety:       { type: Boolean, default: true },
    system:       { type: Boolean, default: true }
  },
  quietHours: {
    enabled: { type: Boolean, default: false },
    start:   { type: String, default: '22:00' },
    end:     { type: String, default: '07:00' }
  },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('NotificationPreferences', notificationPreferencesSchema);
