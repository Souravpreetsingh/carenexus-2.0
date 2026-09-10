/**
 * CareNexus Chat V2 Engine
 * Advanced Messaging Engine with Single-Level Quoted Replies, AES-256-GCM Encryption,
 * Delivery States, Reaction Toggling, Soft Deletion, In-Place Editing, Jump-to-Message,
 * Session-Scoped Search Drawer, and Read-Only Enforcement.
 */

(function () {
  'use strict';

  // 1. Session & Auth State
  const token = localStorage.getItem('token') || localStorage.getItem('care_token');
  const user = JSON.parse(localStorage.getItem('user') || localStorage.getItem('care_user') || 'null');
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('roomId') || localStorage.getItem('roomId');
  const sessionId = urlParams.get('sessionId') || localStorage.getItem('sessionId');

  if (!token || !user || !roomId) {
    window.location.href = 'dashboard.html';
    return;
  }

  // 2. Global State Store: Map<messageKey, messageObject>
  const messageState = new Map();
  let isUserScrolledUp = false;
  let unreadCount = 0;
  let roomCryptoKey = null;
  let typingTimer = null;

  // Active Context Actions State
  let replyingToMessage = null; // Target message object when replying
  let activeActionMessageId = null; // Target message key when context menu is open
  let editingMessageId = null; // Message being edited in modal
  let isReadOnlyMode = false;

  // 3. Socket URL Resolver
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
    return 'https://carenexus-9olf.onrender.com';
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

      window._careNexusSocket = io(socketUrl, {
        auth: { token: token },
        transports: ['polling', 'websocket'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000
      });

      window._careNexusSocket.on('connect', () => {
        console.log(`[CHAT-V2] connected socket=${window._careNexusSocket.id}`);
        window._careNexusSocket.emit('chat:join', { sessionId, roomId, token }, (ack) => {
          if (ack && ack.success) {
            console.log(`[CHAT-V2] joined room: ${roomId}`);
            emitReadReceipt();
          } else {
            console.warn(`[CHAT-V2] join failed:`, ack ? ack.error : 'No ACK');
          }
        });
      });

      window._careNexusSocket.on('connect_error', (err) => {
        console.warn(`[CHAT-V2] connection error to ${socketUrl}:`, err.message);
      });

      window._careNexusSocket.on('reconnect', () => {
        window._careNexusSocket.emit('chat:join', { sessionId, roomId, token });
        emitReadReceipt();
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

  function formatDateSeparator(dateObj) {
    const d = new Date(dateObj);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'TODAY';
    if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  }

  // Read Receipt Emitter
  function emitReadReceipt() {
    if (isReadOnlyMode) return;
    const activeSocket = getCareNexusSocket();
    if (activeSocket) {
      activeSocket.emit('chat:read', { sessionId, roomId });
    }
  }

  // 8. State Rendering Engine
  function renderFromState() {
    const box = document.getElementById('messages');
    if (!box) return;

    const sorted = Array.from(messageState.values()).sort((a, b) => {
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tA - tB;
    });

    box.innerHTML = '';
    let lastDateLabel = null;

    sorted.forEach(msg => {
      const msgDate = new Date(msg.createdAt || Date.now());
      const dateLabel = formatDateSeparator(msgDate);

      // Render Date Separator Pill
      if (dateLabel !== lastDateLabel) {
        lastDateLabel = dateLabel;
        const dateSep = document.createElement('div');
        dateSep.className = 'flex justify-center my-4';
        dateSep.innerHTML = `
          <span class="px-3.5 py-1 bg-surface-container-high/80 backdrop-blur-md rounded-full text-[11px] font-bold text-on-surface-variant uppercase tracking-wider shadow-xs border border-outline-variant/10">
            ${dateLabel}
          </span>
        `;
        box.appendChild(dateSep);
      }

      const isMe = msg.senderRole === user.role;
      const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const label = msg.senderRole === 'mentor' ? 'Mentor' : 'User';
      const key = msg._id || msg.clientMessageId;

      const wrap = document.createElement('div');
      wrap.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-3 group relative`;
      wrap.dataset.msgKey = key;

      // Handle Deleted Message State
      let contentHtml = '';
      if (msg.isDeleted) {
        contentHtml = `<span class="italic opacity-60 text-xs flex items-center gap-1"><span class="material-symbols-outlined text-sm">block</span> This message was deleted</span>`;
      } else {
        contentHtml = formatMessageText(msg.text);
        if (msg.isEdited) {
          contentHtml += ` <span class="text-[10px] opacity-70 italic ml-1">(edited)</span>`;
        }
      }

      // Handle Quoted Reply Preview Block
      let replyBlockHtml = '';
      if (msg.replyToMessageId) {
        let replyTarget = msg.replyToMessage;
        if (!replyTarget && typeof msg.replyToMessageId === 'object') {
          replyTarget = msg.replyToMessageId;
        } else if (!replyTarget) {
          const targetKey = typeof msg.replyToMessageId === 'string' ? msg.replyToMessageId : msg.replyToMessageId._id;
          replyTarget = messageState.get(targetKey);
        }

        const replyTargetId = replyTarget ? (replyTarget._id || replyTarget.clientMessageId) : (typeof msg.replyToMessageId === 'string' ? msg.replyToMessageId : msg.replyToMessageId._id);
        const replyRoleLabel = replyTarget ? (replyTarget.senderRole === user.role ? 'You' : (replyTarget.senderRole === 'mentor' ? 'Mentor' : 'User')) : 'Original Message';
        let replySnippet = replyTarget ? (replyTarget.isDeleted ? 'This message was deleted' : (replyTarget.text ? (replyTarget.text.startsWith('AUDIO_DATA:') ? '[Voice Note]' : replyTarget.text) : 'Encrypted content')) : 'Click to jump to original message';

        if (replySnippet.length > 60) replySnippet = replySnippet.substring(0, 57) + '...';

        replyBlockHtml = `
          <div onclick="jumpToMessage('${replyTargetId}')" 
            class="mb-2 p-2 rounded-lg bg-black/10 dark:bg-white/10 border-l-4 border-primary text-xs cursor-pointer hover:bg-black/15 transition-all">
            <span class="font-bold text-[10px] text-primary block">${replyRoleLabel}</span>
            <p class="truncate opacity-80 italic text-[11px]">${escHtml(replySnippet)}</p>
          </div>
        `;
      }

      // Handle Reactions Pill Display
      let reactionsHtml = '';
      if (msg.reactions && typeof msg.reactions === 'object' && !msg.isDeleted) {
        const counts = {};
        if (Array.isArray(msg.reactions)) {
          msg.reactions.forEach(r => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
        } else {
          Object.keys(msg.reactions).forEach(emoji => {
            const val = msg.reactions[emoji];
            if (Array.isArray(val)) counts[emoji] = val.length;
            else if (val) counts[emoji] = Number(val);
          });
        }

        const keys = Object.keys(counts).filter(e => counts[e] > 0);
        if (keys.length > 0) {
          reactionsHtml = `<div class="flex flex-wrap gap-1 mt-1.5">`;
          keys.forEach(e => {
            reactionsHtml += `
              <button onclick="toggleReaction('${key}', '${e}')" 
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high hover:bg-primary-container text-xs shadow-xs border border-outline-variant/15 transition-all transform active:scale-95">
                <span>${e}</span> <span class="font-bold text-[10px]">${counts[e]}</span>
              </button>
            `;
          });
          reactionsHtml += `</div>`;
        }
      }

      // Delivery Status Indicators for 'isMe'
      let statusIndicatorHtml = '';
      if (isMe) {
        if (msg.status === 'sending') {
          statusIndicatorHtml = ' <span class="opacity-60 text-[10px]" title="Sending">⏳</span>';
        } else if (msg.status === 'sent') {
          statusIndicatorHtml = ' <span class="opacity-70 text-[10px]" title="Sent">✓</span>';
        } else if (msg.status === 'delivered') {
          statusIndicatorHtml = ' <span class="opacity-80 text-[10px]" title="Delivered">✓✓</span>';
        } else if (msg.status === 'seen') {
          statusIndicatorHtml = ' <span class="text-primary font-bold text-[10px]" title="Seen by recipient">✓✓ Seen</span>';
        } else if (msg.status === 'failed') {
          statusIndicatorHtml = ` <button onclick="retrySendMessage('${key}')" class="text-error font-bold text-[10px] hover:underline">⚠️ Failed (Retry)</button>`;
        }
      }

      // Action Trigger Icon (Desktop Hover & Mobile)
      const actionTriggerBtnHtml = `
        <button onclick="openActionMenu('${key}')" title="Message Options"
          class="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-opacity flex items-center justify-center self-center">
          <span class="material-symbols-outlined text-base">more_vert</span>
        </button>
      `;

      if (!isMe) {
        wrap.innerHTML = `
          <div class="flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%]">
            <div class="w-8 h-8 rounded-full bg-primary-container flex-shrink-0 flex items-center justify-center shadow-xs mt-1">
              <span class="material-symbols-outlined text-[18px] text-primary">diversity_1</span>
            </div>
            <div>
              <div class="bg-surface-container-low border border-outline-variant/15 p-3.5 rounded-2xl rounded-tl-none shadow-sm text-on-surface leading-relaxed text-sm break-words relative">
                ${replyBlockHtml}
                ${contentHtml}
                ${reactionsHtml}
              </div>
              <span class="text-[10px] text-on-surface-variant/70 ml-1 mt-1 block font-medium">${label} · ${timeStr}</span>
            </div>
            ${actionTriggerBtnHtml}
          </div>
        `;
      } else {
        wrap.innerHTML = `
          <div class="flex items-end gap-2 max-w-[85%] sm:max-w-[75%] justify-end">
            ${actionTriggerBtnHtml}
            <div>
              <div class="bg-primary text-on-primary p-3.5 rounded-2xl rounded-br-none shadow-sm leading-relaxed text-sm break-words relative">
                ${replyBlockHtml}
                ${contentHtml}
                ${reactionsHtml}
              </div>
              <span class="text-[10px] text-on-surface-variant/70 mr-1 mt-1 block text-right font-medium">You · ${timeStr}${statusIndicatorHtml}</span>
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
    const key = rawMsg._id || rawMsg.clientMessageId || `msg_${Date.now()}`;
    const decryptedText = await decryptMessageText(rawMsg.text, roomId);

    // Decrypt replied message text if present
    let replyToMsgObj = rawMsg.replyToMessage || null;
    if (replyToMsgObj && replyToMsgObj.text) {
      replyToMsgObj = { ...replyToMsgObj, text: await decryptMessageText(replyToMsgObj.text, roomId) };
    }

    let existingKey = null;
    if (rawMsg.clientMessageId && messageState.has(rawMsg.clientMessageId)) {
      existingKey = rawMsg.clientMessageId;
    } else if (rawMsg._id && messageState.has(rawMsg._id)) {
      existingKey = rawMsg._id;
    }

    const prevObj = existingKey ? messageState.get(existingKey) : {};

    const msgObj = {
      _id: rawMsg._id || prevObj._id || null,
      clientMessageId: rawMsg.clientMessageId || prevObj.clientMessageId || null,
      roomId: rawMsg.roomId || roomId,
      sessionId: rawMsg.sessionId || sessionId,
      senderId: rawMsg.senderId || rawMsg.sender || prevObj.senderId || null,
      senderRole: rawMsg.senderRole || prevObj.senderRole,
      text: decryptedText,
      replyToMessageId: rawMsg.replyToMessageId || prevObj.replyToMessageId || null,
      replyToMessage: replyToMsgObj || prevObj.replyToMessage || null,
      reactions: rawMsg.reactions || prevObj.reactions || {},
      isEdited: rawMsg.isEdited !== undefined ? rawMsg.isEdited : (prevObj.isEdited || false),
      editedAt: rawMsg.editedAt || prevObj.editedAt || null,
      isDeleted: rawMsg.isDeleted !== undefined ? rawMsg.isDeleted : (prevObj.isDeleted || false),
      deletedAt: rawMsg.deletedAt || prevObj.deletedAt || null,
      deletedBy: rawMsg.deletedBy || prevObj.deletedBy || null,
      createdAt: rawMsg.createdAt || prevObj.createdAt || new Date().toISOString(),
      status: rawMsg.status || prevObj.status || 'sent'
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

  // 13. Reply Controls Logic
  function setReplyTarget(msgId) {
    if (isReadOnlyMode) return;
    const msg = messageState.get(msgId);
    if (!msg || msg.isDeleted) return;

    replyingToMessage = msg;
    const bar = document.getElementById('replyBarPreview');
    const roleElem = document.getElementById('replyPreviewRole');
    const textElem = document.getElementById('replyPreviewText');

    if (roleElem) {
      const label = msg.senderRole === user.role ? 'You' : (msg.senderRole === 'mentor' ? 'Mentor' : 'User');
      roleElem.textContent = `Replying to ${label}`;
    }

    if (textElem) {
      let snippet = msg.text || '';
      if (snippet.startsWith('AUDIO_DATA:')) snippet = '[Voice Note]';
      if (snippet.length > 70) snippet = snippet.substring(0, 67) + '...';
      textElem.textContent = snippet;
    }

    if (bar) bar.classList.remove('hidden');
    const input = document.getElementById('msgInput');
    if (input) input.focus();
  }

  function cancelReply() {
    replyingToMessage = null;
    const bar = document.getElementById('replyBarPreview');
    if (bar) bar.classList.add('hidden');
  }

  // 14. Send Message Action
  async function sendMessage() {
    if (isReadOnlyMode) return;
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
    const replyTargetId = replyingToMessage ? (replyingToMessage._id || replyingToMessage.clientMessageId) : null;
    const replyTargetObj = replyingToMessage ? {
      _id: replyingToMessage._id,
      clientMessageId: replyingToMessage.clientMessageId,
      senderRole: replyingToMessage.senderRole,
      text: replyingToMessage.text,
      isDeleted: replyingToMessage.isDeleted
    } : null;

    cancelReply();

    // Optimistic Entry
    const optimisticMsg = {
      clientMessageId,
      roomId,
      sessionId,
      senderId: user.id || user._id,
      senderRole: user.role,
      text: text,
      replyToMessageId: replyTargetId,
      replyToMessage: replyTargetObj,
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
      replyToMessageId: replyTargetId,
      token
    };

    console.log(`[CHAT-V2] sending message: ${clientMessageId} replyTo=${replyTargetId}`);

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

  function sendQuickReply(text) {
    if (isReadOnlyMode) return;
    const input = document.getElementById('msgInput');
    if (input) {
      input.value = text;
      sendMessage();
    }
  }

  // 15. Message Action Menu Handlers
  function openActionMenu(msgId) {
    activeActionMessageId = msgId;
    const msg = messageState.get(msgId);
    if (!msg) return;

    const modal = document.getElementById('messageActionModal');
    const editBtn = document.getElementById('actionEditBtn');
    const deleteBtn = document.getElementById('actionDeleteBtn');

    const isMe = msg.senderRole === user.role;

    if (editBtn) {
      if (isMe && !msg.isDeleted && !isReadOnlyMode) editBtn.classList.remove('hidden');
      else editBtn.classList.add('hidden');
    }

    if (deleteBtn) {
      if (isMe && !msg.isDeleted && !isReadOnlyMode) deleteBtn.classList.remove('hidden');
      else deleteBtn.classList.add('hidden');
    }

    if (modal) modal.classList.remove('hidden');
  }

  function closeActionMenu() {
    activeActionMessageId = null;
    const modal = document.getElementById('messageActionModal');
    if (modal) modal.classList.add('hidden');
  }

  function actionReply() {
    if (activeActionMessageId) setReplyTarget(activeActionMessageId);
    closeActionMenu();
  }

  function actionCopy() {
    if (!activeActionMessageId) return;
    const msg = messageState.get(activeActionMessageId);
    if (msg && msg.text && !msg.isDeleted) {
      navigator.clipboard.writeText(msg.text).then(() => {
        console.log('[CHAT-V2] Text copied to clipboard');
      });
    }
    closeActionMenu();
  }

  function actionEdit() {
    if (!activeActionMessageId || isReadOnlyMode) return;
    const msg = messageState.get(activeActionMessageId);
    if (!msg || msg.isDeleted) return;

    editingMessageId = activeActionMessageId;
    closeActionMenu();

    const modal = document.getElementById('editMessageModal');
    const input = document.getElementById('editMessageInput');
    if (input) input.value = msg.text || '';
    if (modal) modal.classList.remove('hidden');
  }

  function closeEditModal() {
    editingMessageId = null;
    const modal = document.getElementById('editMessageModal');
    if (modal) modal.classList.add('hidden');
  }

  async function submitMessageEdit() {
    if (!editingMessageId || isReadOnlyMode) return;
    const input = document.getElementById('editMessageInput');
    const newText = input ? input.value.trim() : '';
    if (!newText) return;

    const msg = messageState.get(editingMessageId);
    if (!msg) return;

    const messageId = msg._id || msg.clientMessageId;
    closeEditModal();

    // Encrypt updated text for socket transmission
    const encryptedText = await encryptMessageText(newText, roomId);
    const activeSocket = getCareNexusSocket();

    if (activeSocket) {
      activeSocket.emit('chat:message:edit', {
        sessionId,
        roomId,
        messageId,
        newText: encryptedText
      }, (ack) => {
        if (ack && ack.success && ack.message) {
          ingestMessage(ack.message);
        }
      });
    }
  }

  function actionDelete() {
    if (!activeActionMessageId || isReadOnlyMode) return;
    if (!confirm('Are you sure you want to delete this message?')) return;

    const msg = messageState.get(activeActionMessageId);
    if (!msg) return;

    const messageId = msg._id || msg.clientMessageId;
    closeActionMenu();

    const activeSocket = getCareNexusSocket();
    if (activeSocket) {
      activeSocket.emit('chat:message:delete', {
        sessionId,
        roomId,
        messageId
      }, (ack) => {
        if (ack && ack.success) {
          msg.isDeleted = true;
          msg.text = '[This message was deleted]';
          renderFromState();
        }
      });
    }
  }

  function toggleReaction(msgId, emoji) {
    if (isReadOnlyMode) return;
    const activeSocket = getCareNexusSocket();
    if (activeSocket) {
      activeSocket.emit('chat:reaction:toggle', {
        sessionId,
        roomId,
        messageId: msgId,
        emoji
      }, (ack) => {
        if (ack && ack.success && ack.reactions) {
          const msg = messageState.get(msgId);
          if (msg) {
            msg.reactions = ack.reactions;
            renderFromState();
          }
        }
      });
    }
  }

  function actionReact(emoji) {
    if (activeActionMessageId) toggleReaction(activeActionMessageId, emoji);
    closeActionMenu();
  }

  async function actionReport() {
    if (!activeActionMessageId) return;
    const reason = prompt('Please specify the reason for reporting this message:');
    if (!reason || !reason.trim()) return;

    const msg = messageState.get(activeActionMessageId);
    const targetId = msg ? (msg._id || msg.clientMessageId) : activeActionMessageId;
    closeActionMenu();

    try {
      const res = await fetch(`/api/sessions/message/${targetId}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Thank you. The message has been reported for safety review.');
      } else {
        alert('Report submission error: ' + (data.message || 'Server error'));
      }
    } catch (err) {
      console.error('Error reporting message:', err);
    }
  }

  // 16. Jump-To-Message with Highlight & Smooth Scroll
  async function jumpToMessage(msgId) {
    if (!msgId) return;
    let targetElem = document.querySelector(`[data-msg-key="${msgId}"]`);

    if (!targetElem) {
      try {
        const res = await fetch(`/api/sessions/message/${msgId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.message) {
            await ingestMessage(data.message);
            targetElem = document.querySelector(`[data-msg-key="${msgId}"]`);
          }
        }
      } catch (err) {
        console.error('[CHAT-V2] Error fetching single target message for jump:', err);
      }
    }

    if (targetElem) {
      targetElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetElem.classList.add('ring-4', 'ring-primary', 'shadow-2xl', 'scale-[1.02]', 'transition-all', 'duration-300');
      setTimeout(() => {
        targetElem.classList.remove('ring-4', 'ring-primary', 'shadow-2xl', 'scale-[1.02]', 'transition-all', 'duration-300');
      }, 2000);
    }
  }

  // 17. Search Drawer Engine
  function toggleChatSearch() {
    const drawer = document.getElementById('chatSearchDrawer');
    if (!drawer) return;
    const isHidden = drawer.classList.contains('hidden');
    if (isHidden) {
      drawer.classList.remove('hidden');
      const input = document.getElementById('chatSearchInput');
      if (input) input.focus();
    } else {
      drawer.classList.add('hidden');
    }
  }

  function performChatSearch(query) {
    const resultsContainer = document.getElementById('chatSearchResults');
    const countElem = document.getElementById('chatSearchCount');
    if (!resultsContainer) return;

    if (!query || !query.trim()) {
      resultsContainer.innerHTML = '';
      if (countElem) countElem.textContent = '0 results';
      return;
    }

    const q = query.toLowerCase().trim();
    const matches = Array.from(messageState.values()).filter(msg => {
      if (msg.isDeleted || !msg.text) return false;
      return msg.text.toLowerCase().includes(q);
    });

    if (countElem) countElem.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'}`;

    resultsContainer.innerHTML = '';
    matches.forEach(msg => {
      const key = msg._id || msg.clientMessageId;
      const roleLabel = msg.senderRole === user.role ? 'You' : (msg.senderRole === 'mentor' ? 'Mentor' : 'User');
      const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let textSnippet = escHtml(msg.text);
      if (textSnippet.length > 80) textSnippet = textSnippet.substring(0, 77) + '...';

      const item = document.createElement('div');
      item.className = 'p-2.5 rounded-xl hover:bg-surface-container-high cursor-pointer transition-colors flex items-center justify-between gap-3';
      item.onclick = () => {
        toggleChatSearch();
        jumpToMessage(key);
      };
      item.innerHTML = `
        <div class="overflow-hidden">
          <span class="font-bold text-primary text-[11px]">${roleLabel} · ${timeStr}</span>
          <p class="text-on-surface truncate text-xs mt-0.5">${textSnippet}</p>
        </div>
        <span class="material-symbols-outlined text-primary text-sm">arrow_forward</span>
      `;
      resultsContainer.appendChild(item);
    });
  }

  function scrollToLatestMessage() {
    const box = document.getElementById('messages');
    if (box) {
      box.scrollTop = box.scrollHeight;
      isUserScrolledUp = false;
      unreadCount = 0;
      const pill = document.getElementById('unreadFloatingPill');
      if (pill) pill.classList.add('hidden');
    }
  }

  // 18. Socket Event Listeners for Realtime Actions
  if (socket) {
    socket.on('chat:message', async (msgPayload) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');

      const isMe = msgPayload.senderRole === user.role;
      if (!isMe && isUserScrolledUp) {
        unreadCount++;
        const pill = document.getElementById('unreadFloatingPill');
        const countText = document.getElementById('unreadCountText');
        if (countText) countText.textContent = `${unreadCount} new message${unreadCount > 1 ? 's' : ''}`;
        if (pill) pill.classList.remove('hidden');
      }

      await ingestMessage(msgPayload);
      emitReadReceipt();
    });

    socket.on('receive-message', async (msgPayload) => {
      const indicator = document.getElementById('typingIndicator');
      if (indicator) indicator.classList.add('hidden');
      await ingestMessage(msgPayload);
      emitReadReceipt();
    });

    socket.on('chat:message:edited', async (payload) => {
      const msg = messageState.get(payload.messageId);
      if (msg) {
        msg.text = await decryptMessageText(payload.newText, roomId);
        msg.isEdited = true;
        msg.editedAt = payload.editedAt;
        renderFromState();
      }
    });

    socket.on('chat:message:deleted', (payload) => {
      const msg = messageState.get(payload.messageId);
      if (msg) {
        msg.isDeleted = true;
        msg.text = '[This message was deleted]';
        msg.deletedAt = payload.deletedAt;
        msg.deletedBy = payload.deletedBy;
        renderFromState();
      }
    });

    socket.on('chat:reaction:updated', (payload) => {
      const msg = messageState.get(payload.messageId);
      if (msg) {
        msg.reactions = payload.reactions;
        renderFromState();
      }
    });

    socket.on('chat:read:update', (payload) => {
      messageState.forEach(msg => {
        if (msg.senderRole === user.role && msg.status !== 'seen') {
          msg.status = 'seen';
        }
      });
      renderFromState();
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

  // 19. UI Event Attachments
  const messagesBox = document.getElementById('messages');
  if (messagesBox) {
    messagesBox.addEventListener('scroll', () => {
      const distFromBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight;
      isUserScrolledUp = distFromBottom > 100;
      if (!isUserScrolledUp) {
        unreadCount = 0;
        const pill = document.getElementById('unreadFloatingPill');
        if (pill) pill.classList.add('hidden');
      }
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
      } else if (e.key === 'Escape') {
        cancelReply();
      }
    });
  }

  // Emoji Picker & Modal Toggles
  function toggleEmojiPicker() {
    const modal = document.getElementById('emojiPickerModal');
    if (modal) modal.classList.toggle('hidden');
  }

  function insertEmoji(emoji) {
    const input = document.getElementById('msgInput');
    if (input) {
      input.value += emoji;
      input.focus();
    }
    toggleEmojiPicker();
  }

  // 20. Session Termination Action
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

  // 21. Voice Audio Recording Logic
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingInterval = null;
  let recordingSeconds = 0;

  async function sendCustomMessage(text) {
    if (!text || isReadOnlyMode) return;
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
    if (isReadOnlyMode) return;
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

  // 22. Session Status & Read-Only Engine
  async function checkSessionStatus() {
    try {
      let target = null;
      if (sessionId) target = `/api/sessions/id/${sessionId}`;
      else if (roomId) target = `/api/sessions/room/${roomId}`;
      if (!target) return;

      const res = await fetch(target, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const s = data.session || data;
        if (s && s.status === 'completed') {
          enableReadOnlyMode();
        }
      }
    } catch (err) {
      console.error('[CHAT-V2] Error checking session status:', err);
    }
  }

  function enableReadOnlyMode() {
    isReadOnlyMode = true;
    console.log('[CHAT-V2] Session is completed. Enabling Read-Only Mode.');
    const banner = document.getElementById('readOnlyBanner');
    if (banner) banner.classList.remove('hidden');

    const msgInput = document.getElementById('msgInput');
    if (msgInput) {
      msgInput.disabled = true;
      msgInput.placeholder = 'This session has ended (Read-only mode).';
      msgInput.classList.add('opacity-50', 'cursor-not-allowed');
    }

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
    }

    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
    }

    const callBtns = document.querySelectorAll('button[onclick*="startCall"]');
    callBtns.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('opacity-50', 'cursor-not-allowed', 'pointer-events-none');
    });

    const endBtn = document.querySelector('button[onclick*="endSession"]');
    if (endBtn) {
      endBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">arrow_back</span> Dashboard`;
      endBtn.onclick = () => window.location.href = 'dashboard.html';
    }
  }

  // Export functions to global window scope for inline event handlers
  window.sendMessage = sendMessage;
  window.sendQuickReply = sendQuickReply;
  window.endSession = endSession;
  window.toggleAudioRecording = toggleAudioRecording;
  window.cancelAudioRecording = cancelAudioRecording;
  window.stopAndSendAudioRecording = stopAndSendAudioRecording;
  window.setReplyTarget = setReplyTarget;
  window.cancelReply = cancelReply;
  window.openActionMenu = openActionMenu;
  window.closeActionMenu = closeActionMenu;
  window.actionReply = actionReply;
  window.actionCopy = actionCopy;
  window.actionEdit = actionEdit;
  window.closeEditModal = closeEditModal;
  window.submitMessageEdit = submitMessageEdit;
  window.actionDelete = actionDelete;
  window.toggleReaction = toggleReaction;
  window.actionReact = actionReact;
  window.actionReport = actionReport;
  window.jumpToMessage = jumpToMessage;
  window.toggleChatSearch = toggleChatSearch;
  window.performChatSearch = performChatSearch;
  window.scrollToLatestMessage = scrollToLatestMessage;
  window.toggleEmojiPicker = toggleEmojiPicker;
  window.insertEmoji = insertEmoji;

  // Initialize data loading
  checkSessionStatus();
  loadHistory();
  loadMentorBriefing();
})();
