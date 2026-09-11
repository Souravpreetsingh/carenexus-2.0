/**
 * CareNexus Trust & Safety Engine
 * Supports user/message reporting, case status tracking, blocking/unblocking users, and emergency escalation.
 */

(function () {
  'use strict';

  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');
  if (!token || !user) {
    window.location.href = 'login.html';
    return;
  }

  let activeSafetyTab = 'report'; // 'report' | 'my-reports' | 'blocked' | 'privacy'

  function switchSafetyTab(tab) {
    activeSafetyTab = tab;
    document.querySelectorAll('.safety-tab-btn').forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.remove('bg-surface-container', 'text-on-surface-variant');
      } else {
        btn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.add('bg-surface-container', 'text-on-surface-variant');
      }
    });

    ['safetyReportSection', 'safetyMyReportsSection', 'safetyBlockedSection', 'safetyPrivacySection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    if (tab === 'report') document.getElementById('safetyReportSection')?.classList.remove('hidden');
    if (tab === 'my-reports') {
      document.getElementById('safetyMyReportsSection')?.classList.remove('hidden');
      loadMyReports();
    }
    if (tab === 'blocked') {
      document.getElementById('safetyBlockedSection')?.classList.remove('hidden');
      loadBlockedUsers();
    }
    if (tab === 'privacy') document.getElementById('safetyPrivacySection')?.classList.remove('hidden');
  }

  async function submitReportForm(e) {
    e.preventDefault();
    const targetType = document.getElementById('reportTargetType').value;
    const targetId = document.getElementById('reportTargetId').value.trim();
    const category = document.getElementById('reportCategory').value;
    const description = document.getElementById('reportDescription').value.trim();

    if (!targetId || !category) {
      alert('Please fill out all required target and category fields.');
      return;
    }

    try {
      const res = await fetch('/api/safety/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetType, targetId, category, description })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Report Submitted Successfully!\nCase Number: ${data.caseNumber}\nOur Trust & Safety team will review your report shortly.`);
        document.getElementById('safetyReportForm').reset();
        switchSafetyTab('my-reports');
      } else {
        alert('Report Submission Notice: ' + (data.message || 'Server error'));
      }
    } catch (err) {
      console.error('[SAFETY] Error submitting report:', err);
      alert('Failed to submit report. Please try again.');
    }
  }

  async function loadMyReports() {
    const list = document.getElementById('myReportsList');
    if (!list) return;
    list.innerHTML = `<div class="p-8 text-center text-on-surface-variant/70 italic text-xs">Loading submitted safety reports...</div>`;

    try {
      const res = await fetch('/api/safety/my-reports', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch reports');
      const data = await res.json();

      const cases = data.cases || [];
      if (cases.length === 0) {
        list.innerHTML = `
          <div class="p-10 text-center flex flex-col items-center justify-center space-y-2">
            <span class="material-symbols-outlined text-4xl text-primary/40">verified_user</span>
            <h5 class="font-bold text-on-surface text-sm">No Reports Submitted</h5>
            <p class="text-xs text-on-surface-variant max-w-xs">You have not filed any safety concerns or reports.</p>
          </div>
        `;
        return;
      }

      list.innerHTML = '';
      cases.forEach(c => {
        const dateStr = new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        let statusBadgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
        if (c.status === 'RESOLVED') statusBadgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
        if (c.status === 'DISMISSED') statusBadgeClass = 'bg-slate-500/10 text-slate-600 border-slate-500/20';
        if (c.status === 'UNDER_REVIEW') statusBadgeClass = 'bg-sky-500/10 text-sky-600 border-sky-500/20';

        const card = document.createElement('div');
        card.className = 'p-4 rounded-2xl border border-outline-variant/15 bg-surface-container-lowest shadow-xs space-y-2';
        card.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs font-bold text-primary">${c.caseNumber}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadgeClass}">${c.status}</span>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-on-surface">Category: ${c.category}</span>
            <span class="text-on-surface-variant/70 text-[10px]">${dateStr}</span>
          </div>
          ${c.description ? `<p class="text-xs text-on-surface-variant italic bg-surface-container-low p-2 rounded-xl">"${c.description}"</p>` : ''}
          ${c.resolution ? `<p class="text-xs font-semibold text-emerald-700 bg-emerald-50 p-2 rounded-xl border border-emerald-200">Resolution Note: ${c.resolution}</p>` : ''}
        `;
        list.appendChild(card);
      });
    } catch (err) {
      console.error('[SAFETY] Error loading my reports:', err);
    }
  }

  async function loadBlockedUsers() {
    const list = document.getElementById('blockedUsersList');
    if (!list) return;
    list.innerHTML = `<div class="p-8 text-center text-on-surface-variant/70 italic text-xs">Loading blocked users...</div>`;

    try {
      const res = await fetch('/api/safety/blocked', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch blocked users');
      const data = await res.json();

      const blocked = data.blocked || [];
      if (blocked.length === 0) {
        list.innerHTML = `
          <div class="p-10 text-center flex flex-col items-center justify-center space-y-2">
            <span class="material-symbols-outlined text-4xl text-primary/40">block</span>
            <h5 class="font-bold text-on-surface text-sm">No Blocked Users</h5>
            <p class="text-xs text-on-surface-variant max-w-xs">You currently have no users on your blocked list.</p>
          </div>
        `;
        return;
      }

      list.innerHTML = '';
      blocked.forEach(b => {
        const u = b.blockedUserId;
        if (!u) return;
        const card = document.createElement('div');
        card.className = 'p-3.5 rounded-2xl border border-outline-variant/15 bg-surface-container-lowest flex items-center justify-between gap-3';
        card.innerHTML = `
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center font-bold text-sm">
              ${(u.username || 'U')[0].toUpperCase()}
            </div>
            <div>
              <h5 class="font-bold text-on-surface text-xs">${u.username}</h5>
              <span class="text-[10px] text-on-surface-variant/70 uppercase tracking-wider font-semibold">${u.role}</span>
            </div>
          </div>
          <button onclick="unblockUserAction('${u._id}')" class="px-3 py-1.5 rounded-xl text-xs font-semibold text-error bg-error/10 hover:bg-error/20 transition-colors">
            Unblock
          </button>
        `;
        list.appendChild(card);
      });
    } catch (err) {
      console.error('[SAFETY] Error loading blocked users:', err);
    }
  }

  async function unblockUserAction(userId) {
    if (!confirm('Unblock this user?')) return;
    try {
      const res = await fetch(`/api/safety/block/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadBlockedUsers();
      }
    } catch (err) {
      console.error('[SAFETY] Error unblocking user:', err);
    }
  }

  window.switchSafetyTab = switchSafetyTab;
  window.submitReportForm = submitReportForm;
  window.unblockUserAction = unblockUserAction;

  document.addEventListener('DOMContentLoaded', () => {
    switchSafetyTab('report');
  });
})();
