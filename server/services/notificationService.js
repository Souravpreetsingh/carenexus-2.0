const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const User = require('../models/User');

let ioInstance = null;

function setSocketIO(io) {
  ioInstance = io;
}

function getSocketIO() {
  return ioInstance;
}

async function isQuietHoursActive(prefs) {
  if (!prefs || !prefs.quietHours || !prefs.quietHours.enabled) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (prefs.quietHours.start || '22:00').split(':').map(Number);
  const [endH, endM] = (prefs.quietHours.end || '07:00').split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Overnight quiet hours (e.g. 22:00 -> 07:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

async function getUnreadCount(recipientId) {
  if (!recipientId) return 0;
  return await Notification.countDocuments({ recipientId, readAt: null });
}

async function createNotification(params) {
  try {
    const {
      recipientId,
      recipientRole,
      type,
      title,
      body,
      data = {},
      entityType = null,
      entityId = null,
      sessionId = null,
      roomId = null,
      actorId = null,
      actorRole = null,
      dedupeKey = null,
      expiresAt = null
    } = params;

    if (!recipientId || !recipientRole || !type || !title || !body) {
      console.warn('[NOTIFICATION-SERVICE] Missing required notification fields');
      return null;
    }

    // Deduplication check
    if (dedupeKey) {
      const existing = await Notification.findOne({ dedupeKey });
      if (existing) return existing;
    }

    // Preferences & quiet hours check
    const prefs = await NotificationPreferences.findOne({ userId: recipientId });
    if (prefs) {
      const isCritical = ['SAFETY_REPORT_CREATED', 'SAFETY_CASE_UPDATED', 'SAFETY_WARNING', 'SYSTEM_ALERT', 'SECURITY_ALERT'].includes(type);
      if (!isCritical && await isQuietHoursActive(prefs)) {
        console.log(`[NOTIFICATION-SERVICE] Quiet hours active for user ${recipientId}. In-app notification created, push suppressed.`);
      }
    }

    const notification = await Notification.create({
      recipientId,
      recipientRole,
      type,
      title,
      body,
      data,
      entityType,
      entityId,
      sessionId,
      roomId,
      actorId,
      actorRole,
      dedupeKey,
      expiresAt
    });

    const unreadCount = await getUnreadCount(recipientId);
    const io = getSocketIO();
    if (io) {
      const targetRoom = `user:${recipientId.toString()}`;
      io.to(targetRoom).emit('notification:new', notification);
      io.to(targetRoom).emit('notification:count', { unreadCount });
    }

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION-SERVICE] Error creating notification:', err);
    return null;
  }
}

async function notifyUser(userId, payload) {
  return await createNotification({ ...payload, recipientId: userId, recipientRole: 'user' });
}

async function notifyMentor(mentorId, payload) {
  return await createNotification({ ...payload, recipientId: mentorId, recipientRole: 'mentor' });
}

async function notifyAdmins(payload) {
  try {
    const admins = await User.find({ role: 'admin' }, '_id');
    const results = [];
    for (const admin of admins) {
      const notif = await createNotification({
        ...payload,
        recipientId: admin._id,
        recipientRole: 'admin',
        dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}_admin_${admin._id}` : null
      });
      results.push(notif);
    }
    return results;
  } catch (err) {
    console.error('[NOTIFICATION-SERVICE] Error notifying admins:', err);
    return [];
  }
}

async function markAsRead(notificationId, recipientId) {
  const notif = await Notification.findOneAndUpdate(
    { _id: notificationId, recipientId },
    { readAt: new Date() },
    { new: true }
  );

  if (notif) {
    const unreadCount = await getUnreadCount(recipientId);
    const io = getSocketIO();
    if (io) {
      const targetRoom = `user:${recipientId.toString()}`;
      io.to(targetRoom).emit('notification:read', { id: notificationId, readAt: notif.readAt });
      io.to(targetRoom).emit('notification:count', { unreadCount });
    }
  }

  return notif;
}

async function markAllAsRead(recipientId) {
  const result = await Notification.updateMany(
    { recipientId, readAt: null },
    { readAt: new Date() }
  );

  const io = getSocketIO();
  if (io) {
    const targetRoom = `user:${recipientId.toString()}`;
    io.to(targetRoom).emit('notification:readAll', { success: true });
    io.to(targetRoom).emit('notification:count', { unreadCount: 0 });
  }

  return result;
}

async function deleteNotification(notificationId, recipientId) {
  const notif = await Notification.findOneAndDelete({ _id: notificationId, recipientId });
  if (notif) {
    const unreadCount = await getUnreadCount(recipientId);
    const io = getSocketIO();
    if (io) {
      const targetRoom = `user:${recipientId.toString()}`;
      io.to(targetRoom).emit('notification:deleted', { id: notificationId });
      io.to(targetRoom).emit('notification:count', { unreadCount });
    }
  }
  return notif;
}

async function getNotifications(recipientId, options = {}) {
  const { limit = 30, cursor = null, unreadOnly = false } = options;
  const query = { recipientId };

  if (unreadOnly) {
    query.readAt = null;
  }

  if (cursor) {
    query.createdAt = { $lt: new Date(cursor) };
  }

  const items = await Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .populate('actorId', 'username role');

  const unreadCount = await getUnreadCount(recipientId);
  const nextCursor = items.length > 0 ? items[items.length - 1].createdAt : null;

  return { notifications: items, unreadCount, nextCursor };
}

module.exports = {
  setSocketIO,
  createNotification,
  notifyUser,
  notifyMentor,
  notifyAdmins,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getNotifications
};
