(function () {
  // Prevent duplicate injection
  if (document.getElementById('ai-carebot-widget-container')) return;

  function initCareBotUI() {
    // 1. Create main floating wrapper
    const wrapper = document.createElement('div');
    wrapper.id = 'ai-carebot-widget-container';
    wrapper.className = 'fixed bottom-5 right-5 z-[9999] font-body';

    // 2. HTML template for Floating Button & Chat Modal
    wrapper.innerHTML = `
      <!-- Larger 3D Floating Element Icon Button -->
      <button id="carebot-trigger-btn" title="CareBot AI 24/7 Companion" class="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-primary via-[#2f605d] to-[#1a3d3a] text-on-primary shadow-[0_15px_35px_rgba(60,109,105,0.45)] backdrop-blur-xl border-4 border-white/80 flex items-center justify-center hover:scale-110 active:scale-95 transition-all duration-300 group animate-float">
        
        <!-- Outer 3D Rotating Orbit Ring -->
        <span class="absolute inset-[-4px] rounded-full border-2 border-dashed border-primary-container/60 animate-[spin_10s_linear_infinite] pointer-events-none"></span>
        
        <!-- Glowing 3D Core Sphere -->
        <div class="w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-white/25 to-white/5 border border-white/40 flex items-center justify-center shadow-inner group-hover:rotate-12 transition-transform">
          <span class="material-symbols-outlined text-2xl sm:text-3xl drop-shadow-md">smart_toy</span>
        </div>

        <!-- 3D Live Online Pill Badge -->
        <span class="absolute -top-1 -right-1 bg-emerald-500 text-white border-2 border-white px-2 py-0.5 rounded-full text-[9px] font-extrabold flex items-center gap-1 shadow-md animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-white"></span> AI
        </span>
      </button>

      <!-- CareBot AI Chat Modal Window -->
      <div id="carebot-chat-window" class="hidden fixed bottom-20 right-4 sm:right-6 w-[calc(100vw-32px)] sm:w-[380px] max-h-[560px] bg-surface-container-lowest border border-outline-variant/20 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-primary to-primary-dim text-on-primary p-4 flex items-center justify-between shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-on-primary shadow-inner">
              <span class="material-symbols-outlined text-xl">smart_toy</span>
            </div>
            <div>
              <h4 class="font-headline font-bold text-sm leading-tight text-white flex items-center gap-1.5">
                CareBot AI Companion
                <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block" title="Online"></span>
              </h4>
              <span class="text-[10px] text-white/80">Anonymous &amp; Encrypted Support</span>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <button id="carebot-close-btn" class="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white transition-colors">
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        <!-- Chat Messages Area -->
        <div id="carebot-messages-area" class="flex-1 p-4 overflow-y-auto space-y-3 max-h-[380px] text-xs leading-relaxed bg-surface/30">
          
          <!-- Bot Welcome Bubble -->
          <div class="flex items-start gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-primary-container text-primary flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              🤖
            </div>
            <div class="bg-surface-container-low border border-outline-variant/15 p-3 rounded-2xl rounded-tl-none text-on-surface space-y-2 max-w-[85%] shadow-sm">
              <p>Hello! I'm <strong>CareBot</strong>, your 24/7 anonymous emotional support AI. How are you feeling right now?</p>
              <p class="text-[10px] text-on-surface-variant">I can help with quick grounding exercises, ambient soundscapes, or connecting you with a peer mentor.</p>
            </div>
          </div>

        </div>

        <!-- Quick Suggestion Chips -->
        <div class="px-3 py-2 bg-surface-container-low/80 border-t border-outline-variant/10 flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px] font-semibold">
          <button onclick="window.sendCareBotQuickMsg('I am feeling anxious and overwhelmed')" class="whitespace-nowrap bg-surface-container-lowest hover:bg-primary-container/40 text-on-surface px-2.5 py-1 rounded-full border border-outline-variant/15 transition-all">
            🌧️ Anxious
          </button>
          <button onclick="window.sendCareBotQuickMsg('Can we do a 4-7-8 breathing exercise?')" class="whitespace-nowrap bg-surface-container-lowest hover:bg-primary-container/40 text-on-surface px-2.5 py-1 rounded-full border border-outline-variant/15 transition-all">
            🧘 Breathing
          </button>
          <button onclick="window.sendCareBotQuickMsg('Play calming ocean waves soundscape')" class="whitespace-nowrap bg-surface-container-lowest hover:bg-primary-container/40 text-on-surface px-2.5 py-1 rounded-full border border-outline-variant/15 transition-all">
            🌊 Soundscapes
          </button>
          <button onclick="window.sendCareBotQuickMsg('Connect me with a peer mentor')" class="whitespace-nowrap bg-primary/10 text-primary hover:bg-primary/20 px-2.5 py-1 rounded-full border border-primary/20 transition-all font-bold">
            👥 Mentors List
          </button>
        </div>

        <!-- Input Box -->
        <form id="carebot-form" class="p-3 bg-surface-container-lowest border-t border-outline-variant/15 flex items-end gap-2">
          <textarea id="carebot-input" rows="1" placeholder="Share how you feel... (Shift+Enter for new line)" class="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3.5 py-2 text-xs text-on-surface focus:outline-none focus:border-primary resize-none max-h-24 leading-relaxed outline-none"></textarea>
          <button type="submit" class="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:bg-primary-dim transition-colors flex-shrink-0 shadow-sm mb-0.5">
            <span class="material-symbols-outlined text-lg">send</span>
          </button>
        </form>

      </div>
    `;

    document.body.appendChild(wrapper);

    // Event listeners
    const triggerBtn = document.getElementById('carebot-trigger-btn');
    const chatWindow = document.getElementById('carebot-chat-window');
    const closeBtn = document.getElementById('carebot-close-btn');
    const form = document.getElementById('carebot-form');
    const input = document.getElementById('carebot-input');
    const messagesArea = document.getElementById('carebot-messages-area');

    function toggleChat() {
      chatWindow.classList.toggle('hidden');
      if (!chatWindow.classList.contains('hidden')) {
        input.focus();
      }
    }

    triggerBtn.onclick = toggleChat;
    closeBtn.onclick = toggleChat;

    // Load persisted conversation from sessionStorage
    loadHistory();

    // Auto resize textarea & keydown handling
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 96) + 'px';
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const txt = input.value.trim();
      if (!txt) return;

      input.value = '';
      input.style.height = 'auto';
      appendUserMsg(txt);
      saveHistoryItem({ type: 'user', text: txt });

      // Append typing indicator
      const typingId = appendTypingIndicator();

      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: txt })
        });

        removeTypingIndicator(typingId);

        if (res.ok) {
          const data = await res.json();
          appendBotMsg(data.reply, data.isCrisis, data.crisisInfo, data.suggestedAction);
          saveHistoryItem({
            type: 'bot',
            text: data.reply,
            isCrisis: data.isCrisis,
            crisisInfo: data.crisisInfo,
            action: data.suggestedAction
          });
        } else {
          const fallback = "I'm here with you. If you need immediate human peer support, you can open our Peer Mentors directory at any time.";
          appendBotMsg(fallback);
          saveHistoryItem({ type: 'bot', text: fallback });
        }
      } catch (err) {
        removeTypingIndicator(typingId);
        const fallbackErr = "I'm having trouble connecting right now, but please know you are not alone. You can connect with our peer mentors using the top navigation bar!";
        appendBotMsg(fallbackErr);
        saveHistoryItem({ type: 'bot', text: fallbackErr });
      }
    };

    function saveHistoryItem(item) {
      try {
        const history = JSON.parse(sessionStorage.getItem('carebot_history') || '[]');
        history.push(item);
        sessionStorage.setItem('carebot_history', JSON.stringify(history));
      } catch (e) {}
    }

    function loadHistory() {
      try {
        const history = JSON.parse(sessionStorage.getItem('carebot_history') || '[]');
        for (const item of history) {
          if (item.type === 'user') {
            appendUserMsg(item.text, false);
          } else if (item.type === 'bot') {
            appendBotMsg(item.text, item.isCrisis, item.crisisInfo, item.action, false);
          }
        }
      } catch (e) {}
    }

    function formatCareBotText(raw) {
      if (!raw) return '';
      let safe = escapeHtml(raw);
      safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      safe = safe.replace(/\n/g, '<br>');
      return safe;
    }

    function appendUserMsg(text, autoScroll = true) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'flex justify-end mb-2';
      msgDiv.innerHTML = `
        <div class="bg-primary text-on-primary p-3 rounded-2xl rounded-tr-none text-xs max-w-[85%] shadow-sm leading-relaxed break-words">
          ${formatCareBotText(text)}
        </div>
      `;
      messagesArea.appendChild(msgDiv);
      if (autoScroll) messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function appendBotMsg(text, isCrisis = false, crisisInfo = null, action = null, autoScroll = true) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'flex items-start gap-2.5 mb-2';
      
      let crisisHTML = '';
      if (isCrisis && crisisInfo) {
        crisisHTML = `
          <div class="mt-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-700 font-semibold space-y-1 text-[11px]">
            <p><strong>📞 ${crisisInfo.lifeline}</strong></p>
            <p>💬 ${crisisInfo.textLine}</p>
          </div>
        `;
      }

      let actionHTML = '';
      if (action === 'OPEN_REFLECT') {
        actionHTML = `
          <button onclick="if(typeof openIndexReflectModal==='function') openIndexReflectModal();" class="mt-2 text-xs bg-emerald-500/10 text-emerald-700 font-bold px-3 py-1.5 rounded-xl border border-emerald-500/20 flex items-center gap-1 hover:bg-emerald-500/20 transition-all">
            🧘 Open Guided 3D Breathwork Trainer
          </button>
        `;
      } else if (action === 'OPEN_SOUNDSCAPES') {
        actionHTML = `
          <button onclick="if(typeof openIndexSoundscapesModal==='function') openIndexSoundscapesModal();" class="mt-2 text-xs bg-teal-500/10 text-teal-700 font-bold px-3 py-1.5 rounded-xl border border-teal-500/20 flex items-center gap-1 hover:bg-teal-500/20 transition-all">
            🎵 Launch Zen Soundscapes Audio Player
          </button>
        `;
      } else if (action === 'OPEN_MENTORS') {
        actionHTML = `
          <button onclick="if(typeof openIndexMentorsModal==='function') openIndexMentorsModal();" class="mt-2 text-xs bg-primary text-on-primary font-bold px-3 py-1.5 rounded-xl shadow flex items-center gap-1 hover:opacity-90 transition-all">
            👥 Open Peer Mentors Directory
          </button>
        `;
      }

      msgDiv.innerHTML = `
        <div class="w-7 h-7 rounded-lg bg-primary-container text-primary flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
          🤖
        </div>
        <div class="bg-surface-container-low border border-outline-variant/15 p-3 rounded-2xl rounded-tl-none text-on-surface max-w-[85%] shadow-sm space-y-1 leading-relaxed break-words">
          <p>${formatCareBotText(text)}</p>
          ${crisisHTML}
          ${actionHTML}
        </div>
      `;
      messagesArea.appendChild(msgDiv);
      if (autoScroll) messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function appendTypingIndicator() {
      const id = 'typing-' + Date.now();
      const msgDiv = document.createElement('div');
      msgDiv.id = id;
      msgDiv.className = 'flex items-start gap-2.5 mb-2';
      msgDiv.innerHTML = `
        <div class="w-7 h-7 rounded-lg bg-primary-container text-primary flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
          🤖
        </div>
        <div class="bg-surface-container-low border border-outline-variant/15 px-3 py-2 rounded-2xl rounded-tl-none text-on-surface text-xs shadow-sm flex items-center gap-1.5 text-on-surface-variant font-medium">
          <span class="inline-flex gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style="animation-delay: 300ms"></span>
          </span>
          <span class="ml-1 text-[11px]">CareBot is typing...</span>
        </div>
      `;
      messagesArea.appendChild(msgDiv);
      messagesArea.scrollTop = messagesArea.scrollHeight;
      return id;
    }

    function removeTypingIndicator(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }

    function escapeHtml(str) {
      return str.replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
      });
    }

    // Expose quick sender
    window.sendCareBotQuickMsg = function (msg) {
      input.value = msg;
      form.dispatchEvent(new Event('submit'));
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCareBotUI);
  } else {
    initCareBotUI();
  }
})();
