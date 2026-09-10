let questState = {
  streakCount: 0,
  points: 0,
  checkedInToday: false,
  quests: [],
  unlockedBadges: [],
  allBadges: []
};

async function loadQuestStatus() {
  try {
    const token = localStorage.getItem('care_token');
    if (!token) return;

    const res = await fetch('/api/quests/my-status', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    questState = data;
    renderQuestHub();
  } catch (err) {
    console.error('Failed to load quest status:', err);
  }
}

async function doDailyCheckIn() {
  try {
    const token = localStorage.getItem('care_token');
    const res = await fetch('/api/quests/check-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Check-in completed!');
      loadQuestStatus();
    }
  } catch (err) {
    console.error('Check-in error:', err);
  }
}

async function completeQuest(questId) {
  try {
    const token = localStorage.getItem('care_token');
    const res = await fetch('/api/quests/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ questId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Quest completed!');
      loadQuestStatus();
    }
  } catch (err) {
    console.error('Complete quest error:', err);
  }
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-6 right-6 z-50 bg-primary text-on-primary px-5 py-3 rounded-2xl shadow-xl font-headline font-bold text-xs flex items-center gap-2 animate-bounce';
  toast.innerHTML = `<span class="material-symbols-outlined text-base">verified</span> ${msg}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function renderQuestHub() {
  const streakEl = document.getElementById('questStreakCount');
  const pointsEl = document.getElementById('questPointsCount');
  const checkInBtn = document.getElementById('questCheckInBtn');
  const questsContainer = document.getElementById('questsListContainer');
  const badgesContainer = document.getElementById('badgesGridContainer');

  if (streakEl) streakEl.textContent = `${questState.streakCount} Days`;
  if (pointsEl) pointsEl.textContent = `${questState.points} Pts`;

  if (checkInBtn) {
    if (questState.checkedInToday) {
      checkInBtn.disabled = true;
      checkInBtn.className = 'px-4 py-2 rounded-full text-xs font-extrabold bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 flex items-center gap-1.5 cursor-default';
      checkInBtn.innerHTML = `<span class="material-symbols-outlined text-sm">check_circle</span> Checked in Today ✓`;
    } else {
      checkInBtn.disabled = false;
      checkInBtn.className = 'px-4 py-2 rounded-full text-xs font-extrabold bg-amber-500 text-white hover:bg-amber-600 transition-all shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer';
      checkInBtn.innerHTML = `<span class="material-symbols-outlined text-sm">local_fire_department</span> Daily Check-in (+10 Pts)`;
      checkInBtn.onclick = doDailyCheckIn;
    }
  }

  // Render Quests List
  if (questsContainer) {
    let qHtml = '';
    const completedCount = (questState.quests || []).filter(q => q.completed).length;
    const totalQuests = questState.quests.length || 1;
    const progressPercent = Math.round((completedCount / totalQuests) * 100);

    qHtml += `
      <div class="mb-4">
        <div class="flex justify-between items-center text-xs font-bold text-on-surface-variant mb-1.5">
          <span>Daily Progress</span>
          <span>${completedCount} / ${totalQuests} Completed (${progressPercent}%)</span>
        </div>
        <div class="w-full h-2.5 bg-surface-container rounded-full overflow-hidden border border-outline-variant/10">
          <div class="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-500" style="width: ${progressPercent}%"></div>
        </div>
      </div>
      <div class="space-y-2.5">
    `;

    (questState.quests || []).forEach(q => {
      qHtml += `
        <div class="p-3.5 rounded-2xl ${q.completed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-surface-container-lowest border-outline-variant/15'} border shadow-sm flex items-center justify-between transition-all">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl ${q.completed ? 'bg-emerald-500 text-white' : 'bg-primary-container/60 text-primary'} flex items-center justify-center font-bold text-sm">
              <span class="material-symbols-outlined text-base">${q.completed ? 'check' : q.icon}</span>
            </div>
            <div>
              <h5 class="text-xs font-extrabold text-on-surface flex items-center gap-1.5">
                ${q.title}
                <span class="text-[10px] font-bold text-primary bg-primary-container/40 px-2 py-0.5 rounded-full">+${q.points} Pts</span>
              </h5>
              <p class="text-[11px] text-on-surface-variant/80 mt-0.5">${q.description}</p>
            </div>
          </div>
          <div>
            ${q.completed ? `
              <span class="text-xs font-bold text-emerald-600 flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">task_alt</span> Done
              </span>
            ` : `
              <button onclick="triggerQuestAction('${q.id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-primary bg-primary-container/50 hover:bg-primary-container transition-colors border border-primary/20">
                Start
              </button>
            `}
          </div>
        </div>
      `;
    });

    qHtml += `</div>`;
    questsContainer.innerHTML = qHtml;
  }

  // Render Sanctuary Badges Grid
  if (badgesContainer) {
    let bHtml = '';
    const unlockedIds = (questState.unlockedBadges || []).map(b => b.badgeId);

    (questState.allBadges || []).forEach(badge => {
      const isUnlocked = unlockedIds.includes(badge.badgeId);
      bHtml += `
        <div class="p-3.5 rounded-2xl ${isUnlocked ? 'bg-gradient-to-br from-amber-500/10 via-surface-container-lowest to-emerald-500/10 border-amber-500/30 shadow-md' : 'bg-surface-container-low/40 border-outline-variant/15 opacity-60'} border text-center flex flex-col items-center justify-center transition-all group relative">
          <div class="w-12 h-12 rounded-2xl ${isUnlocked ? 'bg-gradient-to-tr from-amber-400 to-emerald-400 text-white shadow-lg shadow-amber-500/20 animate-pulse' : 'bg-surface-container-high text-on-surface-variant/40'} flex items-center justify-center mb-2 font-bold">
            <span class="material-symbols-outlined text-2xl">${badge.icon}</span>
          </div>
          <h6 class="text-xs font-extrabold text-on-surface tracking-tight">${badge.title}</h6>
          <p class="text-[10px] text-on-surface-variant mt-1 leading-tight line-clamp-2">${badge.description}</p>
          <span class="mt-2 text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${isUnlocked ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30' : 'bg-surface-container text-on-surface-variant/60'}">
            ${isUnlocked ? 'Unlocked ✨' : 'Locked 🔒'}
          </span>
        </div>
      `;
    });

    badgesContainer.innerHTML = bHtml;
  }
}

function triggerQuestAction(questId) {
  if (questId === 'quest_reflect') {
    if (window.openIndexReflectModal) window.openIndexReflectModal();
    completeQuest('quest_reflect');
  } else if (questId === 'quest_ai_chat') {
    if (window.openAiChat) window.openAiChat();
    completeQuest('quest_ai_chat');
  } else if (questId === 'quest_journal') {
    const journalSection = document.getElementById('journalSection');
    if (journalSection) journalSection.scrollIntoView({ behavior: 'smooth' });
    completeQuest('quest_journal');
  } else if (questId === 'quest_book_mentor') {
    const mentorSec = document.getElementById('mentorsSection');
    if (mentorSec) mentorSec.scrollIntoView({ behavior: 'smooth' });
  } else if (questId === 'quest_checkin') {
    doDailyCheckIn();
  }
}

window.loadQuestStatus = loadQuestStatus;
window.completeQuest = completeQuest;

document.addEventListener('DOMContentLoaded', () => {
  loadQuestStatus();
});
