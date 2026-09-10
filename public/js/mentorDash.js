let mentorData = {
  isAvailable: true,
  bio: '',
  specialties: [],
  rating: 5.0,
  totalSessionsConducted: 0
};

function getAuthToken() {
  return localStorage.getItem('token') || localStorage.getItem('care_token') || '';
}

async function loadMentorDashboardData() {
  try {
    const token = getAuthToken();
    if (!token) return;

    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        mentorData = data.user;
        renderMentorStats();
        populateProfileForm();
      }
    }
  } catch (err) {
    console.error('Error loading mentor profile data:', err);
  }

  loadMentorBookings();
}

function renderMentorStats() {
  const ratingEl = document.getElementById('mentorStatRating');
  const sessionsEl = document.getElementById('mentorStatSessions');
  const hoursEl = document.getElementById('mentorStatHours');
  const availToggleBtn = document.getElementById('mentorAvailToggleBtn');

  const count = mentorData.totalSessionsConducted || 0;
  if (ratingEl) ratingEl.textContent = `${mentorData.rating || 5.0} ★`;
  if (sessionsEl) sessionsEl.textContent = `${count} Sessions`;
  if (hoursEl) hoursEl.textContent = `${Math.round(count * 1.0)} Hours`;

  if (availToggleBtn) {
    const isAvail = mentorData.isAvailable !== false;
    if (isAvail) {
      availToggleBtn.className = 'px-4 py-2 rounded-full text-xs font-extrabold bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer';
      availToggleBtn.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-white animate-ping"></span> Status: Online & Available 🟢`;
    } else {
      availToggleBtn.className = 'px-4 py-2 rounded-full text-xs font-extrabold bg-slate-600 text-white hover:bg-slate-700 transition-all shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer';
      availToggleBtn.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-slate-300"></span> Status: Offline / Busy ⚪`;
    }
  }
}

async function toggleMentorAvailability() {
  try {
    const newStatus = !(mentorData.isAvailable !== false);
    const token = getAuthToken();

    const res = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ isAvailable: newStatus })
    });

    if (res.ok) {
      const data = await res.json();
      mentorData.isAvailable = newStatus;
      renderMentorStats();
      showToast(newStatus ? 'Status updated to Online & Available! 🟢' : 'Status updated to Offline/Busy. ⚪');
    }
  } catch (err) {
    console.error('Error toggling availability:', err);
  }
}

function populateProfileForm() {
  const bioInput = document.getElementById('mentorEditBio');
  const specsInput = document.getElementById('mentorEditSpecs');

  if (bioInput) bioInput.value = mentorData.bio || '';
  if (specsInput) specsInput.value = (mentorData.specialties || []).join(', ');
}

async function saveMentorProfile(e) {
  if (e) e.preventDefault();
  const bioVal = document.getElementById('mentorEditBio').value;
  const specsVal = document.getElementById('mentorEditSpecs').value;
  const alertEl = document.getElementById('mentorProfileAlert');

  const specsArray = specsVal.split(',').map(s => s.trim()).filter(Boolean);

  try {
    const token = getAuthToken();
    const res = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bio: bioVal, specialties: specsArray })
    });

    if (res.ok) {
      const data = await res.json();
      mentorData = data.user;
      if (alertEl) alertEl.innerHTML = `<div class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-700 text-xs font-bold">✨ Profile updated successfully!</div>`;
      setTimeout(() => alertEl && (alertEl.innerHTML = ''), 3000);
    }
  } catch (err) {
    console.error('Error saving mentor profile:', err);
    if (alertEl) alertEl.innerHTML = `<div class="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-bold">Error saving profile.</div>`;
  }
}

async function loadMentorBookings() {
  const container = document.getElementById('mentorBookingsContainer');
  if (!container) return;

  try {
    const token = getAuthToken();
    const res = await fetch('/api/bookings/my-bookings', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;

    const bookings = await res.json();

    if (!Array.isArray(bookings) || bookings.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center bg-surface-container-low rounded-2xl border border-outline-variant/15">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">event_available</span>
          <p class="text-sm font-semibold text-on-surface-variant">No scheduled 1-on-1 appointments yet.</p>
          <p class="text-xs text-on-surface-variant/70 mt-1">When mentees book a session with you, appointments will appear here.</p>
        </div>
      `;
      return;
    }

    let html = '';
    bookings.forEach(b => {
      const userName = b.user ? b.user.username : 'Mentee';
      const userEmail = b.user ? b.user.email : '';
      const isConfirmed = b.status === 'confirmed';
      const isCompleted = b.status === 'completed';

      let statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-700 border border-amber-500/20">Pending</span>`;
      if (isConfirmed) {
        statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">Confirmed 🟢</span>`;
      } else if (isCompleted) {
        statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-700 border border-blue-500/20">Completed ✨</span>`;
      } else if (b.status === 'cancelled') {
        statusBadge = `<span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-error/10 text-error border border-error/20">Cancelled</span>`;
      }

      html += `
        <div class="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/15 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-primary/30">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-2xl bg-primary-container/60 text-primary flex items-center justify-center font-bold text-lg flex-shrink-0">
              <span class="material-symbols-outlined">person</span>
            </div>
            <div>
              <div class="flex items-center gap-2.5">
                <h4 class="font-headline font-bold text-on-surface text-base">Mentee: ${userName}</h4>
                ${statusBadge}
              </div>
              <p class="text-xs text-on-surface-variant font-medium mt-1 flex flex-wrap items-center gap-3">
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm text-primary">calendar_month</span> ${b.date}</span>
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm text-primary">schedule</span> ${b.timeSlot}</span>
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm text-primary">mail</span> ${userEmail}</span>
              </p>
              <p class="text-xs text-on-surface-variant/90 mt-1.5"><span class="font-bold">Topic:</span> ${b.topic}</p>
              ${b.notes ? `<p class="text-xs italic text-on-surface-variant/70 mt-1">"${b.notes}"</p>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-2 self-end md:self-center">
            ${isConfirmed ? `
              <button onclick="updateMentorBookingStatus('${b._id}', 'completed')" class="px-3.5 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20 flex items-center gap-1">
                <span class="material-symbols-outlined text-sm">task_alt</span> Mark Complete
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading mentor bookings:', err);
  }
}

async function updateMentorBookingStatus(id, newStatus) {
  try {
    const token = getAuthToken();
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Appointment status updated to ${newStatus}!`);
      loadMentorBookings();
    }
  } catch (err) {
    console.error('Error updating booking status:', err);
  }
}

function switchMentorTab(tabId) {
  document.querySelectorAll('.mentor-tab-panel').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.mentor-tab-btn').forEach(btn => {
    btn.classList.remove('border-primary', 'text-primary');
    btn.classList.add('border-transparent', 'text-on-surface-variant');
  });

  const targetPanel = document.getElementById(`mentorPanel_${tabId}`);
  const targetBtn = document.getElementById(`mentorTab_${tabId}`);

  if (targetPanel) targetPanel.classList.remove('hidden');
  if (targetBtn) {
    targetBtn.classList.remove('border-transparent', 'text-on-surface-variant');
    targetBtn.classList.add('border-primary', 'text-primary');
  }
}

window.loadMentorDashboardData = loadMentorDashboardData;
window.toggleMentorAvailability = toggleMentorAvailability;
window.saveMentorProfile = saveMentorProfile;
window.updateMentorBookingStatus = updateMentorBookingStatus;
window.switchMentorTab = switchMentorTab;
