/**
 * CareNexus User Care Progress Controller
 */

(function () {
  'use strict';

  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');

  if (!token || !user) {
    window.location.href = 'index.html';
    return;
  }

  function escHtml(t) {
    if (!t) return '';
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadUserProgress() {
    try {
      const res = await fetch('/api/progress', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const profile = data.profile || {};
      const briefings = data.recentSessionBriefings || [];

      renderProgressOverview(profile);
      renderActiveGoals(profile.activeGoals || []);
      renderActionPlan(briefings);
      renderTimeline(profile.progressTimeline || []);
      renderSessionBriefings(briefings);
    } catch (err) {
      console.error('[PROGRESS] Error loading progress profile:', err.message);
    }
  }

  function renderProgressOverview(profile) {
    const activeElem = document.getElementById('statActiveGoals');
    const completedElem = document.getElementById('statCompletedGoals');
    const badgeElem = document.getElementById('activeGoalsBadge');

    const activeCount = (profile.activeGoals || []).length;
    const completedCount = (profile.completedGoals || []).length;

    if (activeElem) activeElem.textContent = activeCount;
    if (completedElem) completedElem.textContent = completedCount;
    if (badgeElem) badgeElem.textContent = `${activeCount} Active`;
  }

  function renderActiveGoals(goals) {
    const container = document.getElementById('activeGoalsList');
    if (!container) return;

    if (!goals || goals.length === 0) {
      container.innerHTML = '<p class="italic text-xs text-on-surface-variant p-4 text-center">Your progress will appear here after your first completed session.</p>';
      return;
    }

    container.innerHTML = goals.map((g, idx) => `
      <div class="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/10 flex items-start gap-3 space-y-1">
        <span class="material-symbols-outlined text-primary text-base mt-0.5">flag</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <h4 class="font-bold text-xs text-on-surface truncate">${escHtml(g.text)}</h4>
            <span class="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">${escHtml(g.status || 'ACTIVE')}</span>
          </div>
          <p class="text-[10px] text-on-surface-variant mt-1">Added ${new Date(g.createdAt || Date.now()).toLocaleDateString()}</p>
        </div>
      </div>
    `).join('');
  }

  function renderActionPlan(briefings) {
    const container = document.getElementById('actionPlanList');
    const badgeElem = document.getElementById('actionPlanBadge');
    if (!container) return;

    const actionItems = [];
    briefings.forEach(b => {
      (b.actionItems || []).forEach(a => {
        actionItems.push({ ...a, sessionId: b.sessionId });
      });
    });

    const openCount = actionItems.filter(a => a.status !== 'COMPLETED' && a.status !== 'DISMISSED').length;
    if (badgeElem) badgeElem.textContent = `${openCount} Open`;

    if (actionItems.length === 0) {
      container.innerHTML = '<p class="italic text-xs text-on-surface-variant p-4 text-center">No open action items right now.</p>';
      return;
    }

    container.innerHTML = actionItems.map(item => `
      <div class="p-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/10 flex items-center justify-between text-xs">
        <div class="flex items-center gap-2 flex-1 truncate">
          <span class="material-symbols-outlined text-primary text-base">${item.status === 'COMPLETED' ? 'check_box' : 'check_box_outline_blank'}</span>
          <span class="${item.status === 'COMPLETED' ? 'line-through opacity-60' : 'font-medium text-on-surface'} truncate">${escHtml(item.text)}</span>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md ${item.status === 'COMPLETED' ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary-container/40 text-primary'}">${escHtml(item.status || 'OPEN')}</span>
      </div>
    `).join('');
  }

  function renderTimeline(timeline) {
    const container = document.getElementById('progressTimelineContainer');
    if (!container) return;

    if (!timeline || timeline.length === 0) {
      container.innerHTML = '<p class="italic text-xs text-on-surface-variant p-4">No care timeline events recorded yet.</p>';
      return;
    }

    container.innerHTML = timeline.map(event => `
      <div class="relative">
        <div class="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full bg-primary border-2 border-surface"></div>
        <div class="p-3.5 rounded-xl bg-surface-container-lowest border border-outline-variant/10 space-y-1">
          <div class="flex items-center justify-between text-[11px]">
            <span class="font-bold text-primary">${escHtml(event.title)}</span>
            <span class="text-on-surface-variant/70 text-[10px]">${new Date(event.date || Date.now()).toLocaleDateString()}</span>
          </div>
          ${event.description ? `<p class="text-xs text-on-surface-variant leading-normal">${escHtml(event.description)}</p>` : ''}
        </div>
      </div>
    `).join('');
  }

  function renderSessionBriefings(briefings) {
    const container = document.getElementById('sessionBriefingsList');
    if (!container) return;

    if (!briefings || briefings.length === 0) {
      container.innerHTML = '<p class="italic text-xs text-on-surface-variant p-4 col-span-2 text-center">No completed sessions available yet.</p>';
      return;
    }

    container.innerHTML = briefings.map(b => `
      <div class="p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/10 space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-base">verified</span>
            <span class="font-bold text-xs text-on-surface">${b.mentor ? escHtml(b.mentor.name) : 'Mentor'}</span>
          </div>
          <span class="text-[10px] text-on-surface-variant">${b.completedAt ? new Date(b.completedAt).toLocaleDateString() : ''}</span>
        </div>
        <p class="text-xs text-on-surface-variant leading-relaxed line-clamp-3">${escHtml(b.summary)}</p>
        ${(b.keyTopics && b.keyTopics.length > 0) ? `
          <div class="flex flex-wrap gap-1 pt-1">
            ${b.keyTopics.map(t => `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">${escHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  document.addEventListener('DOMContentLoaded', loadUserProgress);
})();
