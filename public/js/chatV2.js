/**
 * CareNexus Chat V2 Engine
 * State-driven message architecture with AES-256-GCM encryption, idempotency, and namespaced Socket.IO events.
 */

(function () {
  'use strict';

  // 1. Session & Auth State
  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');
  const roomId = localStorage.getItem('roomId');
  const sessionId = localStorage.getItem('sessionId');

  if (!token || !user || !roomId) {
    window.location.href = 'dashboard.html';
    return;
  }

  // 2. Global State Store: Map<messageKey, messageObject>
  const messageState = new Map();
  let isUserScrolledUp = false;
  let roomCryptoKey = null;
  let typingTimer = null;

  // Global socket reference
  const socket = typeof io !== 'undefined' ? io() : null;

  // 3. Header & UI Initialization
  const chatTitle = document.getElementById('chatTitle');
  if (chatTitle) {
    chatTitle.textContent = user.role === 'mentor' ? 'Chatting with User' : 'Chatting with Mentor';
  }

  // 4. AES-256-GCM Encryption Helpers
  async function getRoomKey(roomIdentifier) {
    if (roomCryptoKey) return roomCryptoKey;
    const enc = new TextEncoder();
    const rawKeyMaterial = enc.encode('CareNexus-SafeSpace-Salt:' + roomIdentifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', rawKeyMaterial);
    roomCryptoKey = await crypto.subtle.importKey(
      'raw',
      hashBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return roomCryptoKey;
  }

  async function encryptMessageText(plaintext, roomIdentifier) {
    if (!plaintext) return '';
    try {
      const key = await getRoomKey(roomIdentifier);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedPlain = new TextEncoder().encode(plaintext);
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encodedPlain
      );
      const ivBase64 = btoa(String.fromCharCode(...iv));
      const cipherBase64 = btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
      return `ENC:${ivBase64}:${cipherBase64}`;
    } catch (err) {
      console.error('Encryption error:', err);
      return plaintext;
    }
  }

  async function decryptMessageText(cipherPayload, roomIdentifier) {
    if (!cipherPayload || typeof cipherPayload !== 'string' || !cipherPayload.startsWith('ENC:')) {
      return cipherPayload || '';
    }
    try {
      const parts = cipherPayload.split(':');
      if (parts.length !== 3) return cipherPayload;
      const ivStr = atob(parts[1]);
      const cipherStr = atob(parts[2]);
      const iv = new Uint8Array([...ivStr].map(c => c.charCodeAt(0)));
      const cipherBuffer = new Uint8Array([...cipherStr].map(c => c.charCodeAt(0)));

      const key = await getRoomKey(roomIdentifier);
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        cipherBuffer
      );
      return new TextDecoder().decode(decryptedBuffer);
    } catch (err) {
      console.error('Decryption error:', err);
      return '[🔒 Encrypted Message]';
    }
  }

  // 5. HTML Sanitization & Formatting
  function escHtml(t) {
    if (!t) return '';
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatMessageText(raw) {
    if (!raw) return '';
    let safe = escHtml(raw);
    safe = safe.replace(/`([^`]+)`/g, '<code class="bg-surface-container-high px-1.5 py-0.5 rounded text-xs font-mono">$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-primary break-all">$1</a>');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  // 6. State Rendering Engine
  function renderFromState() {
    const box = document.getElementById('messages');
    if (!box) return;

    // Sort messages chronologically
    const sorted = Array.from(messageState.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tA - tB;
    });

    box.innerHTML = `
      <div class="flex justify-center mb-4">
        <span class="px-3 py-1 bg-surface-container-high rounded-full text-[11px] font-medium text-on-surface-variant uppercase tracking-wider">Today</span>
      </div>
    `;

    sorted.forEach(msg => {
      const isMe = msg.senderRole === user.role;
      const timeStr = new Date(msg.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const label = msg.senderRole === 'mentor' ? 'Mentor' : 'User';
      const formattedContent = formatMessageText(msg.text);

      const wrap = document.createElement('div');
      wrap.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-3`;
      wrap.dataset.msgKey = msg._id || msg.clientMessageId;

      if (!isMe) {
        wrap.innerHTML = `
          <div class="flex items-start gap-3 max-w-[85%]">
            <div class="w-8 h-8 rounded-full bg-primary-container flex-shrink-0 flex items-center justify-center">
              <span class="material-symbols-outlined text-[18px] text-primary">diversity_1</span>
            </div>
            <div>
              <div class="bg-surface-container-low p-4 rounded-2xl rounded-tl-none shadow-sm text-on-surface leading-relaxed text-sm break-words">${formattedContent}</div>
              <span class="text-[10px] text-on-surface-variant/60 ml-1 mt-1 block">${label} · ${timeStr}</span>
            </div>
          </div>
        `;
      } else {
        const statusIndicator = msg.status === 'sending' ? ' <span class="opacity-60">⏳</span>' : '';
        wrap.innerHTML = `
          <div class="flex items-end gap-3 max-w-[85%]">
            <div>
              <div class="bg-primary text-on-primary p-4 rounded-2xl rounded-br-none shadow-sm leading-relaxed text-sm break-words">${formattedContent}</div>
              <span class="text-[10px] text-on-surface-variant/60 mr-1 mt-1 block text-right">You · ${timeStr}${statusIndicator}</span>
            </div>
          </div>
        `;
      }
      box.appendChild(wrap);
    });

    if (!isUserScrolledUp) {
      box.scrollTop = box.scrollHeight;
    }
  }

  // 7. Message Ingestion / State Mutation Helper
  async function ingestMessage(rawMsg) {
    if (!rawMsg) return;
    const key = rawMsg.clientMessageId || rawMsg._id || `msg_${Date.now()}`;
    const decryptedText = await decryptMessageText(rawMsg.text, roomId);

    // If matching clientMessageId exists in state, update it with server details
    let existingKey = null;
    if (rawMsg.clientMessageId && messageState.has(rawMsg.clientMessageId)) {
      existingKey = rawMsg.clientMessageId;
    } else if (rawMsg._id && messageState.has(rawMsg._id)) {
      existingKey = rawMsg._id;
    }

    const msgObj = {
      _id: rawMsg._id || (existingKey ? messageState.get(existingKey)._id : null),
      clientMessageId: rawMsg.clientMessageId || (existingKey ? messageState.get(existingKey).clientMessageId : null),
      roomId: rawMsg.roomId || roomId,
      sessionId: rawMsg.sessionId || sessionId,
      senderId: rawMsg.senderId || rawMsg.sender || null,
      senderRole: rawMsg.senderRole,
      text: decryptedText,
      createdAt: rawMsg.createdAt || new Date(),
      status: 'sent'
    };

    if (existingKey && existingKey !== msgObj._id && msgObj._id) {
      messageState.delete(existingKey);
    }
    messageState.set(msgObj._id || msgObj.clientMessageId, msgObj);
    renderFromState();
  }

  // 8. Fetch History from Server
  async function loadHistory() {
    try {
      const res = await fetch(`/api/sessions/${roomId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        for (const m of data.messages) {
          await ingestMessage(m);
        }
      }
    } catch (err) {
      console.error('Failed to load message history:', err);
    }
  }

  // 9. Load Session Details for Mentor Briefing
  async function loadMentorBriefing() {
    if (user.role !== 'mentor') return;
    try {
      const res = await fetch(`/api/sessions/room/${roomId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.session) {
        const s = data.session;
        const briefingCard = document.getElementById('mentorBriefingCard');
        if (briefingCard) briefingCard.classList.remove('hidden');

        const tag = document.getElementById('briefingMoodTag');
        if (tag) tag.textContent = s.moodTag || 'General Support';

        const note = document.getElementById('briefingFeelingsNote');
        if (note) note.textContent = s.userFeelingsNote ? `"${s.userFeelingsNote}"` : 'User requested general emotional guidance without a specific note.';

        const approach = document.getElementById('briefingSuggestedApproach');
        if (approach && s.aiGuidance && s.aiGuidance.suggestedApproach) {
          approach.textContent = s.aiGuidance.suggestedApproach;
        }
      }
    } catch (err) {
      console.error('Error fetching session briefing:', err);
    }
  }

  // 10. Distress Keyword Check
  const CRISIS_TERMS = ['suicide', 'kill myself', 'end my life', 'want to die', 'hurt myself', 'self harm', 'end it all', 'give up'];
  function checkDistress(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return CRISIS_TERMS.some(term => lower.includes(term));
  }

  // 11. Send Message Action
  async function sendMessage() {
    const input = document.getElementById('msgInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    if (socket) {
      socket.emit('chat:typing:stop', { roomId, senderRole: user.role });
      socket.emit('stop-typing', { roomId, senderRole: user.role });
    }

    if (checkDistress(text)) {
      const cb = document.getElementById('crisisBanner');
      if (cb) cb.classList.remove('hidden');
      if (socket) socket.emit('trigger-crisis', { roomId, crisisLevel: 'critical', triggers: ['distress_keywords'] });
    }

    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add optimistic local entry
    const optimisticMsg = {
      clientMessageId,
      roomId,
      sessionId,
      senderId: user.id || user._id,
      senderRole: user.role,
      text: text,
      createdAt: new Date().toISOString(),
      status: 'sending'
    };
    messageState.set(clientMessageId, optimisticMsg);
    renderFromState();

    // Encrypt for wire transmission
    const encryptedText = await encryptMessageText(text, roomId);

    const payload = {
      roomId,
      sessionId,
      clientMessageId,
      senderId: user.id || user._id,
      senderRole: user.role,
      text: encryptedText
    };

    if (socket) {
      // Primary Chat V2 event
      socket.emit('chat:send', payload, (ack) => {
        if (ack && ack.success && ack.message) {
          ingestMessage(ack.message);
        }
      });
    }
  }

  // 12. Socket Setup & Namespaced Event Listeners
  if (socket) {
    // Join room on namespaced event and legacy event
    socket.emit('chat:join', { roomId, token });
    socket.emit('join-room', roomId);

    // Incoming messages
    socket.on('chat:message', async (msgPayload) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');
      await ingestMessage(msgPayload);
    });

    socket.on('receive-message', async (msgPayload) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');
      await ingestMessage(msgPayload);
    });

    // Typing indicators
    socket.on('chat:typing:start', ({ senderRole }) => {
      if (senderRole !== user.role) {
        const indicator = document.getElementById('typingIndicator');
        const textSpan = document.getElementById('typingText');
        if (textSpan) textSpan.textContent = `${senderRole === 'mentor' ? 'Mentor' : 'User'} is typing...`;
        if (indicator) indicator.classList.remove('hidden');
      }
    });

    socket.on('chat:typing:stop', ({ senderRole }) => {
      if (senderRole !== user.role) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.classList.add('hidden');
      }
    });

    socket.on('typing', ({ senderRole }) => {
      if (senderRole !== user.role) {
        const indicator = document.getElementById('typingIndicator');
        const textSpan = document.getElementById('typingText');
        if (textSpan) textSpan.textContent = `${senderRole === 'mentor' ? 'Mentor' : 'User'} is typing...`;
        if (indicator) indicator.classList.remove('hidden');
      }
    });

    socket.on('stop-typing', ({ senderRole }) => {
      if (senderRole !== user.role) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.classList.add('hidden');
      }
    });

    socket.on('crisis-alert', () => {
      const cb = document.getElementById('crisisBanner');
      if (cb) cb.classList.remove('hidden');
    });

    socket.on('chat:error', (err) => {
      console.error('Chat server error:', err);
    });
  }

  // 13. UI Event Attachments (Input height, Keydown, Scroll tracking)
  const messagesBox = document.getElementById('messages');
  if (messagesBox) {
    messagesBox.addEventListener('scroll', () => {
      const distFromBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight;
      isUserScrolledUp = distFromBottom > 100;
    });
  }

  const msgInput = document.getElementById('msgInput');
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 128) + 'px';
      if (socket) {
        socket.emit('chat:typing:start', { roomId, senderRole: user.role });
        socket.emit('typing', { roomId, senderRole: user.role });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          socket.emit('chat:typing:stop', { roomId, senderRole: user.role });
          socket.emit('stop-typing', { roomId, senderRole: user.role });
        }, 1500);
      }
    });

    msgInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // 14. Session Termination Action
  async function endSession() {
    if (!confirm('End this session?')) return;
    if (typeof window.hangUp === 'function') window.hangUp();
    try {
      await fetch(`/api/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      console.error('Error completing session:', err);
    }
    if (socket) {
      socket.emit('chat:leave', roomId);
      socket.emit('leave-room', roomId);
    }
    localStorage.removeItem('roomId');
    localStorage.removeItem('sessionId');
    window.location.href = 'dashboard.html';
  }

  // Export functions to global scope for HTML onclick handlers
  window.sendMessage = sendMessage;
  window.endSession = endSession;

  // Initialize data loading
  loadHistory();
  loadMentorBriefing();
})();
