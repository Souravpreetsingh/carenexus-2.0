/**
 * CareNexus Notification Center Engine
 * Supports tabbed filtering (All, Unread, Preferences), pagination, mark as read, delete, and quiet hours configuration.
 */

(function () {
  'use strict';

  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');
  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  let currentTab = 'all'; // 'all' | 'unread' | 'preferences'
  let nextCursor = null;
  let isLoading = false;

  async function loadNotifications(reset = false) {
    if (isLoading) return;
    isLoading = true;

    const list = document.getElementById('notifCenterList');
    if (reset && list) {
      list.innerHTML = `<div class="p-8 text-center text-on-surface-variant/70 italic text-sm">Loading notifications...</div>`;
      nextCursor = null;
    }

    try {
      let url = `/api/notifications?limit=25`;
      if (currentTab === 'unread') url += `&unreadOnly=true`;
      if (nextCursor && !reset) url += `&cursor=${encodeURIComponent(nextCursor)}`;

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load notifications');

      const data = await res.json();
      nextCursor = data.nextCursor;

      renderNotifications(data.notifications || [], reset);
      updateUnreadBadge(data.unreadCount || 0);
    } catch (err) {
      console.error('[NOTIF-CENTER] Error:', err);
      if (list && reset) {
        list.innerHTML = `<div class="p-8 text-center text-error text-sm font-semibold">Failed to load notifications. Please check your connection.</div>`;
      }
    } finally {
      isLoading = false;
    }
  }

  function renderNotifications(items, reset) {
    const list = document.getElementById('notifCenterList');
    const loadMoreBtn = document.getElementById('loadMoreNotifBtn');
    if (!list) return;

    if (reset) list.innerHTML = '';

    if (items.length === 0 && reset) {
      list.innerHTML = `
        <div class="p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div class="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-3xl">
            <span class="material-symbols-outlined">mark_email_read</span>
          </div>
          <h4 class="font-headline font-bold text-on-surface text-base">You're all caught up!</h4>
          <p class="text-xs text-on-surface-variant max-w-xs">No ${currentTab === 'unread' ? 'unread ' : ''}notifications at this time.</p>
        </div>
      `;
      if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
      return;
    }

    items.forEach(n => {
      const isUnread = !n.readAt;
      const dateObj = new Date(n.createdAt);
      const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let icon = 'notifications';
      if (n.type.includes('SESSION')) icon = 'calendar_today';
      if (n.type.includes('MESSAGE')) icon = 'chat';
      if (n.type.includes('SAFETY')) icon = 'shield';
      if (n.type.includes('SECURITY')) icon = 'warning';

      const card = document.createElement('div');
      card.className = `p-4 sm:p-5 rounded-2xl border transition-all flex items-start justify-between gap-4 ${isUnread ? 'bg-primary-container/20 border-primary/30 shadow-xs' : 'bg-surface-container-lowest border-outline-variant/15 hover:bg-surface-container-high'}`;

      card.innerHTML = `
        <div class="flex items-start gap-4 flex-1 min-w-0 cursor-pointer" onclick="handleNotificationClick('${n._id}', '${n.type}', '${n.roomId || ''}', '${n.sessionId || ''}')">
          <div class="w-10 h-10 rounded-xl ${isUnread ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center flex-shrink-0 shadow-xs">
            <span class="material-symbols-outlined text-lg">${icon}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="font-headline font-bold text-on-surface text-sm truncate">${n.title}</h4>
              ${isUnread ? '<span class="w-2 h-2 rounded-full bg-primary flex-shrink-0 animate-ping"></span>' : ''}
            </div>
            <p class="text-xs text-on-surface-variant leading-relaxed mt-1 break-words">${n.body}</p>
            <span class="text-[10px] font-semibold text-on-surface-variant/60 block mt-2">${dateStr} at ${timeStr}</span>
          </div>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          ${isUnread ? `
            <button onclick="markSingleRead('${n._id}')" title="Mark as read" class="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors">
              <span class="material-symbols-outlined text-lg">check_circle</span>
            </button>
          ` : ''}
          <button onclick="deleteSingleNotif('${n._id}')" title="Delete notification" class="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors">
            <span class="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      `;
      list.appendChild(card);
    });

    if (loadMoreBtn) {
      if (nextCursor) loadMoreBtn.classList.remove('hidden');
      else loadMoreBtn.classList.add('hidden');
    }
  }

  function updateUnreadBadge(count) {
    const pill = document.getElementById('notifCenterUnreadPill');
    if (pill) pill.textContent = `${count} unread`;
  }

  async function handleNotificationClick(id, type, roomId, sessionId) {
    await markSingleRead(id);
    if (type.includes('MESSAGE') || type.includes('REPLY')) {
      if (roomId) window.location.href = `chat.html?roomId=${roomId}&sessionId=${sessionId || ''}`;
      else window.location.href = 'chat.html';
    } else if (type.includes('SESSION')) {
      window.location.href = 'dashboard.html';
    } else if (type.includes('SAFETY')) {
      window.location.href = user.role === 'admin' ? 'admin.html' : 'safety.html';
    }
  }

  async function markSingleRead(id) {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadNotifications(true);
    } catch (err) {
      console.error('[NOTIF-CENTER] Error marking read:', err);
    }
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadNotifications(true);
    } catch (err) {
      console.error('[NOTIF-CENTER] Error marking all read:', err);
    }
  }

  async function deleteSingleNotif(id) {
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadNotifications(true);
    } catch (err) {
      console.error('[NOTIF-CENTER] Error deleting notification:', err);
    }
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.notif-tab-btn').forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.remove('bg-surface-container', 'text-on-surface-variant');
      } else {
        btn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.add('bg-surface-container', 'text-on-surface-variant');
      }
    });

    const listSection = document.getElementById('notifCenterListSection');
    const prefsSection = document.getElementById('notifPrefsSection');

    if (tab === 'preferences') {
      if (listSection) listSection.classList.add('hidden');
      if (prefsSection) prefsSection.classList.remove('hidden');
      loadPreferences();
    } else {
      if (listSection) listSection.classList.remove('hidden');
      if (prefsSection) prefsSection.classList.add('hidden');
      loadNotifications(true);
    }
  }

  async function loadPreferences() {
    try {
      const res = await fetch('/api/notifications/preferences', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const p = data.preferences;
      if (!p) return;

      document.getElementById('prefInAppMessages').checked = p.inApp?.messages ?? true;
      document.getElementById('prefInAppSessions').checked = p.inApp?.sessions ?? true;
      document.getElementById('prefInAppSafety').checked = p.inApp?.safety ?? true;

      document.getElementById('prefQuietHoursEnabled').checked = p.quietHours?.enabled ?? false;
      document.getElementById('prefQuietHoursStart').value = p.quietHours?.start || '22:00';
      document.getElementById('prefQuietHoursEnd').value = p.quietHours?.end || '07:00';
    } catch (err) {
      console.error('[NOTIF-CENTER] Error loading preferences:', err);
    }
  }

  async function savePreferences(e) {
    if (e) e.preventDefault();
    try {
      const payload = {
        inApp: {
          messages: document.getElementById('prefInAppMessages').checked,
          replies: true,
          reactions: true,
          sessions: document.getElementById('prefInAppSessions').checked,
          safety: document.getElementById('prefInAppSafety').checked,
          system: true
        },
        quietHours: {
          enabled: document.getElementById('prefQuietHoursEnabled').checked,
          start: document.getElementById('prefQuietHoursStart').value,
          end: document.getElementById('prefQuietHoursEnd').value
        }
      };

      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('Notification preferences saved successfully!');
      }
    } catch (err) {
      console.error('[NOTIF-CENTER] Error saving preferences:', err);
    }
  }

  // Export functions to window
  window.switchTab = switchTab;
  window.markAllRead = markAllRead;
  window.markSingleRead = markSingleRead;
  window.deleteSingleNotif = deleteSingleNotif;
  window.handleNotificationClick = handleNotificationClick;
  window.savePreferences = savePreferences;
  window.loadMoreNotifications = () => loadNotifications(false);

  document.addEventListener('DOMContentLoaded', () => {
    switchTab('all');
  });
})();
