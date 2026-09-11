const router = require('express').Router();
const auth = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const NotificationPreferences = require('../models/NotificationPreferences');
const { createRateLimiter } = require('../middleware/rateLimiter');

router.use(auth);

// GET /api/notifications (paginated)
router.get('/', async (req, res) => {
  try {
    const recipientId = req.user.id || req.user._id;
    const { limit, cursor, unreadOnly } = req.query;

    const data = await notificationService.getNotifications(recipientId, {
      limit: limit ? Number(limit) : 30,
      cursor: cursor || null,
      unreadOnly: unreadOnly === 'true'
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const recipientId = req.user.id || req.user._id;
    const unreadCount = await notificationService.getUnreadCount(recipientId);
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    const recipientId = req.user.id || req.user._id;
    const notif = await notificationService.markAsRead(req.params.id, recipientId);
    if (!notif) return res.status(404).json({ message: 'Notification not found or unauthorized' });
    res.json({ success: true, notification: notif });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req, res) => {
  try {
    const recipientId = req.user.id || req.user._id;
    await notificationService.markAllAsRead(recipientId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    const recipientId = req.user.id || req.user._id;
    const notif = await notificationService.deleteNotification(req.params.id, recipientId);
    if (!notif) return res.status(404).json({ message: 'Notification not found or unauthorized' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/notifications/preferences
router.get('/preferences', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    let prefs = await NotificationPreferences.findOne({ userId });
    if (!prefs) {
      prefs = await NotificationPreferences.create({ userId });
    }
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/preferences
router.put('/preferences', createRateLimiter({ windowMs: 60000, max: 10 }), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { inApp, browserPush, email, quietHours } = req.body;

    const prefs = await NotificationPreferences.findOneAndUpdate(
      { userId },
      {
        inApp,
        browserPush,
        email,
        quietHours,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, preferences: prefs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
