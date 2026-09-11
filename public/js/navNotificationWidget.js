/**
 * CareNexus Shared Navigation Notification Bell Widget
 * Realtime Socket.IO notification listener, unread count badge, and dropdown preview panel.
 */

(function () {
  'use strict';

  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');
  if (!token || !user) return;

  function initNavWidget() {
    const container = document.getElementById('navNotificationContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="relative inline-block text-left">
        <button id="navNotifBellBtn" onclick="toggleNavNotifDropdown()" title="Notifications"
          class="relative p-2 rounded-xl text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors flex items-center justify-center">
          <span class="material-symbols-outlined text-2xl">notifications</span>
          <span id="navNotifBadge" class="hidden absolute -top-0.5 -right-0.5 bg-rose-500 text-white font-bold text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-surface animate-pulse">0</span>
        </button>

        <div id="navNotifDropdown" class="hidden fixed sm:absolute right-2 sm:right-0 top-16 sm:top-12 z-50 w-80 sm:w-96 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-2xl overflow-hidden transition-all">
          <div class="p-3.5 border-b border-outline-variant/15 flex items-center justify-between bg-surface-container-low">
            <div class="flex items-center gap-2 font-headline font-bold text-on-surface text-sm">
              <span class="material-symbols-outlined text-primary text-base">notifications</span>
              <span>Notifications</span>
              <span id="navDropdownCountPill" class="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-bold">0 unread</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <button onclick="markAllNotificationsReadNav()" class="text-primary hover:underline font-semibold">Mark all read</button>
            </div>
          </div>

          <div id="navNotifList" class="max-h-80 overflow-y-auto divide-y divide-outline-variant/10 text-xs">
            <div class="p-4 text-center text-on-surface-variant/70 italic">Loading notifications...</div>
          </div>

          <div class="p-2.5 bg-surface-container-low border-t border-outline-variant/15 text-center">
            <a href="notifications.html" class="text-xs font-bold text-primary hover:underline flex items-center justify-center gap-1">
              <span>View all notifications</span>
              <span class="material-symbols-outlined text-sm">arrow_forward</span>
            </a>
          </div>
        </div>
      </div>
    `;

    fetchUnreadCountNav();
    fetchLatestNotificationsNav();
    attachSocketNotifListeners();
  }

  async function fetchUnreadCountNav() {
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        updateBadgeNav(data.unreadCount || 0);
      }
    } catch (err) {
      console.error('[NAV-NOTIF] Error fetching count:', err);
    }
  }

  function updateBadgeNav(count) {
    const badge = document.getElementById('navNotifBadge');
    const pill = document.getElementById('navDropdownCountPill');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    if (pill) {
      pill.textContent = `${count} unread`;
    }
  }

  async function fetchLatestNotificationsNav() {
    try {
      const res = await fetch('/api/notifications?limit=6', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      renderDropdownListNav(data.notifications || []);
    } catch (err) {
      console.error('[NAV-NOTIF] Error fetching list:', err);
    }
  }

  function renderDropdownListNav(notifications) {
    const list = document.getElementById('navNotifList');
    if (!list) return;

    if (notifications.length === 0) {
      list.innerHTML = `<div class="p-6 text-center text-on-surface-variant/70 text-xs italic">You're all caught up! No new notifications.</div>`;
      return;
    }

    list.innerHTML = '';
    notifications.forEach(n => {
      const isUnread = !n.readAt;
      const timeStr = new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const item = document.createElement('div');
      item.className = `p-3 transition-colors cursor-pointer flex items-start gap-3 ${isUnread ? 'bg-primary-container/20 font-semibold' : 'hover:bg-surface-container-high'}`;
      
      let icon = 'notifications';
      if (n.type.includes('SESSION')) icon = 'calendar_today';
      if (n.type.includes('MESSAGE')) icon = 'chat';
      if (n.type.includes('SAFETY')) icon = 'shield';
      if (n.type.includes('SECURITY')) icon = 'warning';

      item.onclick = async () => {
        if (isUnread) await markNotificationReadNav(n._id);
        handleNotificationDeepLinkNav(n);
      };

      item.innerHTML = `
        <div class="w-8 h-8 rounded-full ${isUnread ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'} flex items-center justify-center flex-shrink-0 mt-0.5">
          <span class="material-symbols-outlined text-sm">${icon}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1">
            <h5 class="text-xs font-bold text-on-surface truncate">${n.title}</h5>
            <span class="text-[10px] text-on-surface-variant/60 flex-shrink-0">${timeStr}</span>
          </div>
          <p class="text-[11px] text-on-surface-variant truncate mt-0.5">${n.body}</p>
        </div>
      `;
      list.appendChild(item);
    });
  }

  async function markNotificationReadNav(id) {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchUnreadCountNav();
      fetchLatestNotificationsNav();
    } catch (err) {
      console.error('[NAV-NOTIF] Error marking read:', err);
    }
  }

  async function markAllNotificationsReadNav() {
    try {
      await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchUnreadCountNav();
      fetchLatestNotificationsNav();
    } catch (err) {
      console.error('[NAV-NOTIF] Error marking all read:', err);
    }
  }

  function handleNotificationDeepLinkNav(n) {
    if (n.type.includes('MESSAGE') || n.type.includes('REPLY')) {
      if (n.roomId) {
        window.location.href = `chat.html?roomId=${n.roomId}&sessionId=${n.sessionId || ''}`;
      } else {
        window.location.href = 'chat.html';
      }
    } else if (n.type.includes('SESSION')) {
      window.location.href = 'dashboard.html';
    } else if (n.type.includes('SAFETY')) {
      window.location.href = user.role === 'admin' ? 'admin.html' : 'safety.html';
    } else {
      window.location.href = 'notifications.html';
    }
  }

  function toggleNavNotifDropdown() {
    const dropdown = document.getElementById('navNotifDropdown');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      dropdown.classList.remove('hidden');
      fetchLatestNotificationsNav();
    } else {
      dropdown.classList.add('hidden');
    }
  }

  function attachSocketNotifListeners() {
    if (typeof window.getCareNexusSocket === 'function') {
      const socket = window.getCareNexusSocket();
      if (socket) {
        socket.on('notification:new', (newNotif) => {
          fetchUnreadCountNav();
          fetchLatestNotificationsNav();
        });
        socket.on('notification:count', ({ unreadCount }) => {
          updateBadgeNav(unreadCount);
        });
      }
    }
  }

  window.toggleNavNotifDropdown = toggleNavNotifDropdown;
  window.markAllNotificationsReadNav = markAllNotificationsReadNav;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavWidget);
  } else {
    initNavWidget();
  }
})();
