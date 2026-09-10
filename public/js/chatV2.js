/**
 * CareNexus Chat V2 Engine
 * State-driven message architecture with AES-256-GCM encryption, client message idempotency,
 * singleton Socket.IO connection manager, and production backend Socket URL routing.
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

  // 3. Socket URL Resolver (Local Dev vs Production Node/Socket.IO Backend)
  function getSocketBaseUrl() {
    if (typeof window !== 'undefined' && window.CARENEXUS_SOCKET_URL) {
      return window.CARENEXUS_SOCKET_URL;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('care_socket_url')) {
      return localStorage.getItem('care_socket_url');
    }
    if (typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return window.location.origin;
      }
    }
    // Render persistent Node/Express Socket.IO Backend
    return 'https://carenexus.onrender.com';
  }

  // 4. Singleton Socket.IO Connection Manager
  function getCareNexusSocket() {
    if (window._careNexusSocket && window._careNexusSocket.connected) {
      return window._careNexusSocket;
    }
    if (!window._careNexusSocket) {
      if (typeof io === 'undefined') {
        console.error('[CHAT-V2] Socket.IO client library (io) is missing!');
        return null;
      }
      const socketUrl = (typeof window.getSocketBaseUrl === 'function') ? window.getSocketBaseUrl() : getSocketBaseUrl();
      console.log(`[CHAT-V2] Socket URL: ${socketUrl}`);
      console.log(`[CHAT-V2] connecting...`);

      window._careNexusSocket = io(socketUrl, {
        auth: { token: token },
        transports: ['polling', 'websocket'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000
      });

      window._careNexusSocket.on('connect', () => {
        const transportName = window._careNexusSocket.io?.engine?.transport?.name || 'unknown';
        console.log(`[CHAT-V2] connected socket=${window._careNexusSocket.id}`);
        console.log(`[CHAT-V2] transport=${transportName}`);
        console.log(`[CHAT-V2] joining room: ${roomId} session: ${sessionId}`);

        window._careNexusSocket.emit('chat:join', { sessionId, roomId, token }, (ack) => {
          if (ack && ack.success) {
            console.log(`[CHAT-V2] joined room: ${roomId} members=${ack.membersCount}`);
          } else {
            console.warn(`[CHAT-V2] join failed:`, ack ? ack.error : 'No ACK');
          }
        });
      });

      window._careNexusSocket.on('connect_error', (err) => {
        console.warn(`[CHAT-V2] connection error to ${socketUrl}:`, err.message);
      });

      window._careNexusSocket.on('reconnect', () => {
        console.log(`[CHAT-V2] socket reconnected: ${window._careNexusSocket.id}`);
        window._careNexusSocket.emit('chat:join', { sessionId, roomId, token });
      });
    }
    return window._careNexusSocket;
  }

  window.getCareNexusSocket = getCareNexusSocket;
  const socket = getCareNexusSocket();

  // 5. Header & UI Initialization
  const chatTitle = document.getElementById('chatTitle');
  if (chatTitle) {
    chatTitle.textContent = user.role === 'mentor' ? 'Chatting with User' : 'Chatting with Mentor';
  }

  // 6. AES-256-GCM Encryption Helpers
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

  // 7. HTML Sanitization & Formatting
  function escHtml(t) {
    if (!t) return '';
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatMessageText(raw) {
    if (!raw) return '';
    if (raw.startsWith('AUDIO_DATA:')) {
      const audioDataUrl = raw.substring('AUDIO_DATA:'.length);
      return `
        <div class="flex flex-col gap-1 my-0.5 min-w-[200px]">
          <div class="flex items-center gap-1.5 font-semibold text-xs mb-1 opacity-90">
            <span class="material-symbols-outlined text-base">graphic_eq</span>
            <span>Voice Note</span>
          </div>
          <audio controls src="${audioDataUrl}" class="w-full max-w-[260px] h-10 rounded-lg outline-none"></audio>
        </div>
      `;
    }
    let safe = escHtml(raw);
    safe = safe.replace(/`([^`]+)`/g, '<code class="bg-surface-container-high px-1.5 py-0.5 rounded text-xs font-mono">$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline text-primary break-all">$1</a>');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  // 8. State Rendering Engine
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
        const statusIndicator = msg.status === 'sending' ? ' <span class="opacity-60">⏳</span>' : (msg.status === 'failed' ? ' <span class="text-error font-bold">⚠️ Failed</span>' : '');
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

  // 9. Message Ingestion / State Mutation Helper
  async function ingestMessage(rawMsg) {
    if (!rawMsg) return;
    const key = rawMsg.clientMessageId || rawMsg._id || `msg_${Date.now()}`;
    const decryptedText = await decryptMessageText(rawMsg.text, roomId);

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

  // 10. Fetch History from Server
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
      console.error('[CHAT-V2] Failed to load message history:', err);
    }
  }

  // 11. Load Session Details for Mentor Briefing
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
      console.error('[CHAT-V2] Error fetching session briefing:', err);
    }
  }

  // 12. Distress Keyword Check
  const CRISIS_TERMS = ['suicide', 'kill myself', 'end my life', 'want to die', 'hurt myself', 'self harm', 'end it all', 'give up'];
  function checkDistress(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return CRISIS_TERMS.some(term => lower.includes(term));
  }

  // 13. Send Message Action
  async function sendMessage() {
    const input = document.getElementById('msgInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    const activeSocket = getCareNexusSocket();
    if (activeSocket) {
      activeSocket.emit('chat:typing:stop', { roomId, senderRole: user.role });
    }

    if (checkDistress(text)) {
      const cb = document.getElementById('crisisBanner');
      if (cb) cb.classList.remove('hidden');
      if (activeSocket) activeSocket.emit('trigger-crisis', { roomId, crisisLevel: 'critical', triggers: ['distress_keywords'] });
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
      sessionId,
      roomId,
      clientMessageId,
      text: encryptedText,
      token
    };

    console.log(`[CHAT-V2] sending message: ${clientMessageId}`);

    if (activeSocket) {
      activeSocket.emit('chat:send', payload, (ack) => {
        console.log(`[CHAT-V2] server acknowledgement received:`, ack ? ack.success : false);
        if (ack && ack.success && ack.message) {
          ingestMessage(ack.message);
        } else if (ack && !ack.success) {
          const item = messageState.get(clientMessageId);
          if (item) {
            item.status = 'failed';
            renderFromState();
          }
        }
      });
    }
  }

  // 14. Socket Event Listeners
  if (socket) {
    socket.on('chat:message', async (msgPayload) => {
      console.log(`[CHAT-V2] message received: ${msgPayload._id || msgPayload.clientMessageId}`);
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');
      await ingestMessage(msgPayload);
    });

    socket.on('receive-message', async (msgPayload) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');
      await ingestMessage(msgPayload);
    });

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

    socket.on('crisis-alert', () => {
      const cb = document.getElementById('crisisBanner');
      if (cb) cb.classList.remove('hidden');
    });

    socket.on('chat:error', (err) => {
      console.error('[CHAT-V2] server error notice:', err);
    });
  }

  // 15. UI Event Attachments (Input height, Keydown, Scroll tracking)
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
      const activeSocket = getCareNexusSocket();
      if (activeSocket) {
        activeSocket.emit('chat:typing:start', { roomId });
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          activeSocket.emit('chat:typing:stop', { roomId });
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

  // 16. Session Termination Action
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
    const activeSocket = getCareNexusSocket();
    if (activeSocket) {
      activeSocket.emit('chat:leave', roomId);
    }
    localStorage.removeItem('roomId');
    localStorage.removeItem('sessionId');
    window.location.href = 'dashboard.html';
  }

  // 17. Voice Audio Recording Logic
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingInterval = null;
  let recordingSeconds = 0;

  async function sendCustomMessage(text) {
    if (!text) return;
    const activeSocket = getCareNexusSocket();
    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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

    const encryptedText = await encryptMessageText(text, roomId);
    const payload = {
      sessionId,
      roomId,
      clientMessageId,
      text: encryptedText,
      token
    };

    if (activeSocket) {
      activeSocket.emit('chat:send', payload, (ack) => {
        if (ack && ack.success && ack.message) {
          ingestMessage(ack.message);
        } else if (ack && !ack.success) {
          const item = messageState.get(clientMessageId);
          if (item) {
            item.status = 'failed';
            renderFromState();
          }
        }
      });
    }
  }

  async function toggleAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopAndSendAudioRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        }
      }

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.start(100);

      document.getElementById('standardInputBar')?.classList.add('hidden');
      document.getElementById('recordingBar')?.classList.remove('hidden');

      recordingSeconds = 0;
      const timerElem = document.getElementById('recordingTimer');
      if (timerElem) timerElem.textContent = '00:00';

      clearInterval(recordingInterval);
      recordingInterval = setInterval(() => {
        recordingSeconds++;
        const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
        const s = String(recordingSeconds % 60).padStart(2, '0');
        if (timerElem) timerElem.textContent = `${m}:${s}`;
      }, 1000);
    } catch (err) {
      alert('Microphone access required to record voice notes: ' + err.message);
    }
  }

  function cancelAudioRecording() {
    if (mediaRecorder) {
      mediaRecorder.onstop = null;
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    mediaRecorder = null;
    audioChunks = [];
    clearInterval(recordingInterval);
    document.getElementById('recordingBar')?.classList.add('hidden');
    document.getElementById('standardInputBar')?.classList.remove('hidden');
  }

  function stopAndSendAudioRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    mediaRecorder.onstop = async () => {
      if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result;
        const audioMessageText = `AUDIO_DATA:${base64Audio}`;
        await sendCustomMessage(audioMessageText);
      };
      reader.readAsDataURL(blob);

      mediaRecorder = null;
      audioChunks = [];
      clearInterval(recordingInterval);
      document.getElementById('recordingBar')?.classList.add('hidden');
      document.getElementById('standardInputBar')?.classList.remove('hidden');
    };

    mediaRecorder.stop();
  }

  // Export functions to global scope
  window.sendMessage = sendMessage;
  window.endSession = endSession;
  window.toggleAudioRecording = toggleAudioRecording;
  window.cancelAudioRecording = cancelAudioRecording;
  window.stopAndSendAudioRecording = stopAndSendAudioRecording;

  // Initialize data loading
  loadHistory();
  loadMentorBriefing();
})();
