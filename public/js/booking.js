let currentBookingMentorId = null;
let currentBookingMentorName = '';

const TIME_SLOTS = [
  "09:00 AM", "10:30 AM", "01:00 PM", "02:30 PM", "04:00 PM", "06:00 PM", "08:00 PM"
];

function openBookingModal(mentorId, mentorName, specialtiesStr) {
  currentBookingMentorId = mentorId;
  currentBookingMentorName = mentorName;

  const modal = document.getElementById('bookingModal');
  if (!modal) {
    createBookingModalHTML();
  }

  document.getElementById('bookingMentorName').textContent = mentorName;
  document.getElementById('bookingMentorSpecs').textContent = specialtiesStr || 'General Mentorship & Emotional Support';
  
  // Set default date to today or tomorrow
  const dateInput = document.getElementById('bookingDate');
  const today = new Date().toISOString().split('T')[0];
  dateInput.value = today;
  dateInput.min = today;

  fetchAvailableSlots();
  document.getElementById('bookingModal').classList.remove('hidden');
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (modal) modal.classList.add('hidden');
}

async function fetchAvailableSlots() {
  const dateVal = document.getElementById('bookingDate').value;
  const slotContainer = document.getElementById('timeSlotsContainer');
  if (!dateVal || !currentBookingMentorId) return;

  slotContainer.innerHTML = `<div class="text-xs text-on-surface-variant animate-pulse py-2">Loading available slots...</div>`;

  try {
    const token = localStorage.getItem('care_token');
    const res = await fetch(`/api/bookings/mentor-slots/${currentBookingMentorId}?date=${dateVal}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const bookedSlots = data.bookedSlots || [];

    let html = '';
    TIME_SLOTS.forEach(slot => {
      const isBooked = bookedSlots.includes(slot);
      if (isBooked) {
        html += `
          <button type="button" disabled class="px-3 py-2 rounded-xl text-xs font-bold bg-surface-container-high/50 text-outline-variant cursor-not-allowed border border-outline-variant/20 flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-sm">block</span> ${slot}
          </button>
        `;
      } else {
        html += `
          <button type="button" onclick="selectTimeSlot('${slot}', this)" class="slot-btn px-3 py-2 rounded-xl text-xs font-bold bg-surface-container hover:bg-primary-container text-on-surface hover:text-primary-container transition-all border border-outline-variant/20 active:scale-95 flex items-center justify-center gap-1">
            <span class="material-symbols-outlined text-sm">schedule</span> ${slot}
          </button>
        `;
      }
    });
    slotContainer.innerHTML = html;
  } catch (err) {
    console.error('Failed to load slots:', err);
    slotContainer.innerHTML = `<div class="text-xs text-error">Error loading time slots.</div>`;
  }
}

let selectedSlot = null;

function selectTimeSlot(slot, btnEl) {
  selectedSlot = slot;
  document.querySelectorAll('.slot-btn').forEach(b => {
    b.classList.remove('bg-primary', 'text-white', 'border-primary', 'shadow-md');
    b.classList.add('bg-surface-container', 'text-on-surface');
  });
  btnEl.classList.remove('bg-surface-container', 'text-on-surface');
  btnEl.classList.add('bg-primary', 'text-white', 'border-primary', 'shadow-md');
}

async function submitBooking(event) {
  event.preventDefault();
  const dateVal = document.getElementById('bookingDate').value;
  const topicVal = document.getElementById('bookingTopic').value;
  const notesVal = document.getElementById('bookingNotes').value;
  const alertEl = document.getElementById('bookingAlert');

  if (!selectedSlot) {
    alertEl.innerHTML = `<div class="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-bold">Please select a time slot.</div>`;
    return;
  }

  try {
    const token = localStorage.getItem('care_token');
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        mentorId: currentBookingMentorId,
        date: dateVal,
        timeSlot: selectedSlot,
        topic: topicVal,
        notes: notesVal
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alertEl.innerHTML = `<div class="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-bold">${data.message || 'Booking failed.'}</div>`;
      return;
    }

    alertEl.innerHTML = `<div class="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-700 text-xs font-bold">✨ Session booked successfully!</div>`;
    setTimeout(() => {
      closeBookingModal();
      loadMyBookings();
      if (window.loadQuestStatus) window.loadQuestStatus();
    }, 1200);

  } catch (err) {
    console.error('Booking submission error:', err);
    alertEl.innerHTML = `<div class="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-bold">Network error booking session.</div>`;
  }
}

async function loadMyBookings() {
  const container = document.getElementById('myBookingsContainer');
  if (!container) return;

  try {
    const token = localStorage.getItem('care_token');
    if (!token) return;

    const res = await fetch('/api/bookings/my-bookings', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const bookings = await res.json();

    if (!Array.isArray(bookings) || bookings.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center bg-surface-container-low rounded-2xl border border-outline-variant/15">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">event_busy</span>
          <p class="text-sm font-semibold text-on-surface-variant">No scheduled sessions yet.</p>
          <p class="text-xs text-on-surface-variant/70 mt-1">Book a session with a mentor above to get started!</p>
        </div>
      `;
      return;
    }

    let html = '';
    bookings.forEach(b => {
      const mentorName = b.mentor ? b.mentor.username : 'Peer Mentor';
      const userName = b.user ? b.user.username : 'User';
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
        <div class="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/15 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-primary/30">
          <div class="flex items-start gap-3.5">
            <div class="w-11 h-11 rounded-2xl bg-primary-container/60 text-primary flex items-center justify-center flex-shrink-0 font-bold text-lg">
              <span class="material-symbols-outlined">person</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h4 class="font-headline font-bold text-on-surface text-base">Session with ${mentorName}</h4>
                ${statusBadge}
              </div>
              <p class="text-xs text-on-surface-variant font-medium mt-0.5 flex items-center gap-2">
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm text-primary">calendar_month</span> ${b.date}</span>
                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm text-primary">schedule</span> ${b.timeSlot}</span>
              </p>
              <p class="text-xs text-on-surface-variant/80 mt-1"><span class="font-bold">Topic:</span> ${b.topic}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 self-end md:self-center">
            ${isConfirmed ? `
              <button onclick="cancelBooking('${b._id}')" class="px-3 py-1.5 rounded-xl text-xs font-bold text-error bg-error/10 hover:bg-error/20 transition-colors border border-error/20">
                Cancel
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error('Failed to load my bookings:', err);
  }
}

async function cancelBooking(id) {
  if (!confirm('Are you sure you want to cancel this scheduled session?')) return;
  try {
    const token = localStorage.getItem('care_token');
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    if (res.ok) {
      loadMyBookings();
    }
  } catch (err) {
    console.error('Cancel booking error:', err);
  }
}

function createBookingModalHTML() {
  const modalDiv = document.createElement('div');
  modalDiv.id = 'bookingModal';
  modalDiv.className = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4 hidden';
  modalDiv.innerHTML = `
    <div class="bg-surface-container-lowest max-w-lg w-full rounded-3xl p-6 md:p-8 shadow-2xl border border-outline-variant/20 relative animate-fadeIn">
      <button onclick="closeBookingModal()" class="absolute top-5 right-5 w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface">
        <span class="material-symbols-outlined text-lg">close</span>
      </button>
      
      <div class="flex items-center gap-3 mb-4">
        <div class="w-12 h-12 rounded-2xl bg-primary-container text-primary flex items-center justify-center font-bold text-xl shadow-sm">
          <span class="material-symbols-outlined">event_available</span>
        </div>
        <div>
          <h3 class="font-headline font-extrabold text-xl text-on-surface">Book 1-on-1 Session</h3>
          <p class="text-xs text-on-surface-variant font-medium">With <span id="bookingMentorName" class="text-primary font-bold"></span></p>
        </div>
      </div>

      <p id="bookingMentorSpecs" class="text-xs text-on-surface-variant bg-surface-container p-3 rounded-xl mb-5 font-medium border border-outline-variant/10"></p>

      <form onsubmit="submitBooking(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Select Date</label>
          <input type="date" id="bookingDate" onchange="fetchAvailableSlots()" required class="w-full px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20 text-sm font-semibold text-on-surface focus:outline-none focus:border-primary"/>
        </div>

        <div>
          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Available Time Slots</label>
          <div id="timeSlotsContainer" class="grid grid-cols-3 gap-2"></div>
        </div>

        <div>
          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Session Topic</label>
          <select id="bookingTopic" class="w-full px-4 py-2.5 rounded-xl bg-surface-container border border-outline-variant/20 text-sm font-semibold text-on-surface focus:outline-none focus:border-primary">
            <option value="General Emotional Support">General Emotional Support</option>
            <option value="Academic & Exam Stress">Academic & Exam Stress</option>
            <option value="Career Guidance">Career Guidance</option>
            <option value="Anxiety & Mindfulness">Anxiety & Mindfulness</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Optional Notes</label>
          <textarea id="bookingNotes" rows="2" placeholder="Anything specific you'd like to discuss..." class="w-full px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:border-primary resize-none"></textarea>
        </div>

        <div id="bookingAlert"></div>

        <div class="flex items-center gap-3 pt-2">
          <button type="button" onclick="closeBookingModal()" class="w-1/2 py-3 rounded-full text-xs font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high transition-colors">
            Cancel
          </button>
          <button type="submit" class="w-1/2 py-3 rounded-full text-xs font-bold text-on-primary bg-primary hover:bg-primary-dim transition-all shadow-md active:scale-95">
            Confirm Booking ✨
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modalDiv);
}

document.addEventListener('DOMContentLoaded', () => {
  createBookingModalHTML();
});
