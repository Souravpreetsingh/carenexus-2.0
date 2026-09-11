/**
 * CareNexus Admin Moderation Dashboard Engine
 * Overview Metrics, Safety Case Queue, Moderation Modal, User Account Restrictions, Audit Logs, and Security Events.
 */

(function () {
  'use strict';

  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');

  if (!token || !user || user.role !== 'admin') {
    window.location.href = 'dashboard.html';
    return;
  }

  let activeAdminTab = 'overview'; // 'overview' | 'cases' | 'users' | 'sessions' | 'audit' | 'security'
  let activeCaseId = null;

  function switchAdminTab(tab) {
    activeAdminTab = tab;
    document.querySelectorAll('.admin-nav-btn').forEach(btn => {
      if (btn.dataset.tab === tab) {
        btn.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.remove('text-on-surface-variant', 'hover:bg-surface-container-high');
      } else {
        btn.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
        btn.classList.add('text-on-surface-variant', 'hover:bg-surface-container-high');
      }
    });

    ['adminOverviewSection', 'adminCasesSection', 'adminUsersSection', 'adminSessionsSection', 'adminAuditSection', 'adminSecuritySection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    if (tab === 'overview') {
      document.getElementById('adminOverviewSection')?.classList.remove('hidden');
      loadOverviewMetrics();
    }
    if (tab === 'cases') {
      document.getElementById('adminCasesSection')?.classList.remove('hidden');
      loadCasesQueue();
    }
    if (tab === 'users') {
      document.getElementById('adminUsersSection')?.classList.remove('hidden');
      loadUsersList();
    }
    if (tab === 'sessions') {
      document.getElementById('adminSessionsSection')?.classList.remove('hidden');
      loadSessionsList();
    }
    if (tab === 'audit') {
      document.getElementById('adminAuditSection')?.classList.remove('hidden');
      loadAuditLogs();
    }
    if (tab === 'security') {
      document.getElementById('adminSecuritySection')?.classList.remove('hidden');
      loadSecurityEvents();
    }
  }

  async function loadOverviewMetrics() {
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();

      document.getElementById('metricOpenCases').textContent = data.openCases || 0;
      document.getElementById('metricCriticalCases').textContent = data.criticalCases || 0;
      document.getElementById('metricActiveSessions').textContent = data.activeSessions || 0;
      document.getElementById('metricTotalUsers').textContent = data.totalUsers || 0;
      document.getElementById('metricTotalMentors').textContent = data.totalMentors || 0;
      document.getElementById('metricSecurityEvents').textContent = data.securityEventsCount || 0;
    } catch (err) {
      console.error('[ADMIN] Error loading metrics:', err);
    }
  }

  async function loadCasesQueue() {
    const tableBody = document.getElementById('adminCasesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-xs text-on-surface-variant/70 italic">Loading safety case queue...</td></tr>`;

    const statusFilter = document.getElementById('caseStatusFilter')?.value || '';
    const priorityFilter = document.getElementById('casePriorityFilter')?.value || '';

    try {
      let url = `/api/admin/cases?limit=50`;
      if (statusFilter) url += `&status=${statusFilter}`;
      if (priorityFilter) url += `&priority=${priorityFilter}`;

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch cases');
      const data = await res.json();

      const cases = data.cases || [];
      if (cases.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-xs text-on-surface-variant/70 italic">No safety cases found matching your filters.</td></tr>`;
        return;
      }

      tableBody.innerHTML = '';
      cases.forEach(c => {
        const reporterName = c.reporterId ? c.reporterId.username : 'Unknown';
        const reportedName = c.reportedUserId ? c.reportedUserId.username : 'Unknown';
        const dateStr = new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        let prioClass = 'bg-slate-100 text-slate-700';
        if (c.priority === 'HIGH') prioClass = 'bg-amber-100 text-amber-800 font-bold';
        if (c.priority === 'CRITICAL') prioClass = 'bg-rose-100 text-rose-800 font-bold animate-pulse';

        let statusClass = 'bg-sky-100 text-sky-800';
        if (c.status === 'RESOLVED') statusClass = 'bg-emerald-100 text-emerald-800';
        if (c.status === 'DISMISSED') statusClass = 'bg-slate-100 text-slate-700';

        const row = document.createElement('tr');
        row.className = 'border-b border-outline-variant/10 hover:bg-surface-container-high/50 text-xs transition-colors';
        row.innerHTML = `
          <td class="p-3 font-mono font-bold text-primary">${c.caseNumber}</td>
          <td class="p-3 font-semibold text-on-surface">${c.category}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] ${prioClass}">${c.priority}</span></td>
          <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClass}">${c.status}</span></td>
          <td class="p-3 text-on-surface-variant">${reporterName} → <strong class="text-on-surface">${reportedName}</strong></td>
          <td class="p-3 text-on-surface-variant/70 text-[11px]">${dateStr}</td>
          <td class="p-3 text-right">
            <button onclick="openCaseModal('${c._id}')" class="px-3 py-1.5 rounded-xl font-bold text-xs bg-primary text-on-primary hover:bg-primary-dim shadow-xs transition-all">
              Review Case
            </button>
          </td>
        `;
        tableBody.appendChild(row);
      });
    } catch (err) {
      console.error('[ADMIN] Error loading cases:', err);
    }
  }

  async function openCaseModal(caseId) {
    activeCaseId = caseId;
    const modal = document.getElementById('caseDetailModal');
    if (!modal) return;

    try {
      const res = await fetch(`/api/admin/cases/${caseId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const c = data.case;

      document.getElementById('modalCaseNumber').textContent = c.caseNumber;
      document.getElementById('modalCaseCategory').textContent = c.category;
      document.getElementById('modalCasePriority').value = c.priority;
      document.getElementById('modalCaseStatus').value = c.status;
      document.getElementById('modalReporterName').textContent = c.reporterId ? `${c.reporterId.username} (${c.reporterRole})` : 'Unknown';
      document.getElementById('modalReportedName').textContent = c.reportedUserId ? `${c.reportedUserId.username} (${c.reportedRole || 'user'})` : 'Unknown';
      document.getElementById('modalReportedStatus').textContent = c.reportedUserId ? `Status: ${c.reportedUserId.accountStatus || 'ACTIVE'}` : '';
      document.getElementById('modalCaseDescription').textContent = c.description || 'No description provided.';
      document.getElementById('modalCaseResolution').value = c.resolution || '';

      // Internal Notes Thread
      const notesThread = document.getElementById('modalCaseNotesThread');
      if (notesThread) {
        const notes = c.internalNotes || [];
        if (notes.length === 0) {
          notesThread.innerHTML = `<p class="text-xs text-on-surface-variant/60 italic">No internal admin notes yet.</p>`;
        } else {
          notesThread.innerHTML = '';
          notes.forEach(n => {
            const adminName = n.adminId ? n.adminId.username : 'Admin';
            const dateStr = new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const noteEl = document.createElement('div');
            noteEl.className = 'p-2.5 rounded-xl bg-surface-container-high text-xs space-y-1';
            noteEl.innerHTML = `
              <div class="flex items-center justify-between text-[10px] font-bold text-primary">
                <span>${adminName}</span>
                <span class="text-on-surface-variant/60">${dateStr}</span>
              </div>
              <p class="text-on-surface leading-relaxed">${n.note}</p>
            `;
            notesThread.appendChild(noteEl);
          });
        }
      }

      modal.classList.remove('hidden');
    } catch (err) {
      console.error('[ADMIN] Error opening case modal:', err);
    }
  }

  function closeCaseModal() {
    activeCaseId = null;
    const modal = document.getElementById('caseDetailModal');
    if (modal) modal.classList.add('hidden');
  }

  async function updateCaseAction() {
    if (!activeCaseId) return;
    const status = document.getElementById('modalCaseStatus').value;
    const priority = document.getElementById('modalCasePriority').value;
    const resolution = document.getElementById('modalCaseResolution').value.trim();

    try {
      const res = await fetch(`/api/admin/cases/${activeCaseId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, priority, resolution })
      });

      if (res.ok) {
        alert('Case updated successfully!');
        closeCaseModal();
        loadCasesQueue();
        loadOverviewMetrics();
      }
    } catch (err) {
      console.error('[ADMIN] Error updating case:', err);
    }
  }

  async function addCaseNoteAction() {
    if (!activeCaseId) return;
    const input = document.getElementById('modalNewNoteInput');
    const note = input ? input.value.trim() : '';
    if (!note) return;

    try {
      const res = await fetch(`/api/admin/cases/${activeCaseId}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ note })
      });

      if (res.ok) {
        input.value = '';
        openCaseModal(activeCaseId);
      }
    } catch (err) {
      console.error('[ADMIN] Error adding note:', err);
    }
  }

  async function restrictUserAction(status) {
    if (!activeCaseId) return;
    const reason = prompt(`Specify reason for setting user status to ${status}:`);
    if (reason === null) return;

    try {
      const caseRes = await fetch(`/api/admin/cases/${activeCaseId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const caseData = await caseRes.json();
      const reportedUser = caseData.case ? caseData.case.reportedUserId : null;
      if (!reportedUser) return;

      const targetId = reportedUser._id || reportedUser;

      const res = await fetch(`/api/admin/users/${targetId}/restrict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status, reason })
      });

      if (res.ok) {
        alert(`User status changed to ${status}!`);
        openCaseModal(activeCaseId);
      }
    } catch (err) {
      console.error('[ADMIN] Error restricting user:', err);
    }
  }

  async function loadUsersList() {
    const tableBody = document.getElementById('adminUsersTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-xs text-on-surface-variant/70 italic">Loading registered users...</td></tr>`;

    try {
      const res = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const users = data.users || [];

      tableBody.innerHTML = '';
      users.forEach(u => {
        const row = document.createElement('tr');
        row.className = 'border-b border-outline-variant/10 text-xs hover:bg-surface-container-high/50';
        row.innerHTML = `
          <td class="p-3 font-bold text-on-surface">${u.username}</td>
          <td class="p-3 text-on-surface-variant">${u.email}</td>
          <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${u.role === 'mentor' ? 'bg-teal-100 text-teal-800' : (u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-700')}">${u.role}</span></td>
          <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${u.accountStatus === 'SUSPENDED' || u.accountStatus === 'BANNED' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}">${u.accountStatus || 'ACTIVE'}</span></td>
          <td class="p-3 text-right">
            ${u.role === 'mentor' ? `<button onclick="toggleApproveMentor('${u._id}')" class="px-2.5 py-1 rounded-lg font-semibold text-[11px] ${u.isApproved ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} mr-1">${u.isApproved ? 'Approved' : 'Approve'}</button>` : ''}
            <button onclick="deleteUserAction('${u._id}')" class="px-2.5 py-1 rounded-lg font-semibold text-[11px] text-error bg-error/10 hover:bg-error/20">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });
    } catch (err) {
      console.error('[ADMIN] Error loading users:', err);
    }
  }

  async function loadSessionsList() {
    const tableBody = document.getElementById('adminSessionsTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-xs text-on-surface-variant/70 italic">Loading active and past sessions...</td></tr>`;

    try {
      const res = await fetch('/api/admin/sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const sessions = data.sessions || [];

      tableBody.innerHTML = '';
      sessions.forEach(s => {
        const userName = s.user ? s.user.username : 'Anonymous User';
        const mentorName = s.mentor ? s.mentor.username : 'Unassigned';
        const dateStr = new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

        const row = document.createElement('tr');
        row.className = 'border-b border-outline-variant/10 text-xs hover:bg-surface-container-high/50';
        row.innerHTML = `
          <td class="p-3 font-mono font-bold text-primary text-[11px]">${s._id}</td>
          <td class="p-3 font-semibold text-on-surface">${userName} ↔ ${mentorName}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'active' ? 'bg-emerald-100 text-emerald-800 animate-pulse' : 'bg-slate-100 text-slate-700'}">${s.status}</span></td>
          <td class="p-3 text-on-surface-variant/70 text-[11px]">${dateStr}</td>
          <td class="p-3 text-right">
            <button onclick="deleteSessionAction('${s._id}')" class="px-2.5 py-1 rounded-lg font-semibold text-[11px] text-error bg-error/10 hover:bg-error/20">Delete</button>
          </td>
        `;
        tableBody.appendChild(row);
      });
    } catch (err) {
      console.error('[ADMIN] Error loading sessions:', err);
    }
  }

  async function loadAuditLogs() {
    const list = document.getElementById('adminAuditLogsList');
    if (!list) return;
    list.innerHTML = `<div class="p-6 text-center text-xs text-on-surface-variant/70 italic">Loading audit logs...</div>`;

    try {
      const res = await fetch('/api/admin/audit-logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const logs = data.logs || [];

      if (logs.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-xs text-on-surface-variant/70 italic">No audit logs recorded yet.</div>`;
        return;
      }

      list.innerHTML = '';
      logs.forEach(l => {
        const actor = l.actorId ? l.actorId.username : 'System';
        const dateStr = new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = 'p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/15 text-xs flex items-center justify-between gap-3';
        item.innerHTML = `
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-primary">${l.action}</span>
              <span class="text-on-surface-variant/70 text-[10px]">by ${actor} (${l.actorRole})</span>
            </div>
            <p class="text-[11px] text-on-surface-variant mt-0.5">${l.entityType} #${l.entityId}</p>
          </div>
          <span class="text-[10px] text-on-surface-variant/60 font-mono">${dateStr}</span>
        `;
        list.appendChild(item);
      });
    } catch (err) {
      console.error('[ADMIN] Error loading audit logs:', err);
    }
  }

  async function loadSecurityEvents() {
    const list = document.getElementById('adminSecurityEventsList');
    if (!list) return;
    list.innerHTML = `<div class="p-6 text-center text-xs text-on-surface-variant/70 italic">Loading security events...</div>`;

    try {
      const res = await fetch('/api/admin/security-events', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const events = data.events || [];

      if (events.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-xs text-on-surface-variant/70 italic">No security events logged.</div>`;
        return;
      }

      list.innerHTML = '';
      events.forEach(e => {
        const actor = e.actorId ? e.actorId.username : 'Anonymous';
        const dateStr = new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = 'p-3 rounded-xl bg-surface-container-lowest border border-outline-variant/15 text-xs flex items-center justify-between gap-3';
        item.innerHTML = `
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-rose-700">${e.type}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">${e.severity}</span>
            </div>
            <p class="text-[11px] text-on-surface-variant mt-0.5">Actor: ${actor}</p>
          </div>
          <span class="text-[10px] text-on-surface-variant/60 font-mono">${dateStr}</span>
        `;
        list.appendChild(item);
      });
    } catch (err) {
      console.error('[ADMIN] Error loading security events:', err);
    }
  }

  async function toggleApproveMentor(id) {
    try {
      await fetch(`/api/admin/users/${id}/approve`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadUsersList();
    } catch (err) {
      console.error('[ADMIN] Error toggling mentor approval:', err);
    }
  }

  async function deleteUserAction(id) {
    if (!confirm('Are you sure you want to delete this user account?')) return;
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadUsersList();
    } catch (err) {
      console.error('[ADMIN] Error deleting user:', err);
    }
  }

  async function deleteSessionAction(id) {
    if (!confirm('Are you sure you want to delete this session?')) return;
    try {
      await fetch(`/api/admin/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadSessionsList();
    } catch (err) {
      console.error('[ADMIN] Error deleting session:', err);
    }
  }

  window.switchAdminTab = switchAdminTab;
  window.loadCasesQueue = loadCasesQueue;
  window.openCaseModal = openCaseModal;
  window.closeCaseModal = closeCaseModal;
  window.updateCaseAction = updateCaseAction;
  window.addCaseNoteAction = addCaseNoteAction;
  window.restrictUserAction = restrictUserAction;
  window.toggleApproveMentor = toggleApproveMentor;
  window.deleteUserAction = deleteUserAction;
  window.deleteSessionAction = deleteSessionAction;

  document.addEventListener('DOMContentLoaded', () => {
    switchAdminTab('overview');
  });
})();
