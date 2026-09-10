(function () {
  function triggerPanicExit() {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
    
    // Wipe DOM to prevent visual residual information before redirect
    document.documentElement.innerHTML = '<html><head><title>Wikipedia</title></head><body style="background:#fff;"></body></html>';
    
    // Replace location without leaving browser history entry
    window.location.replace('https://www.wikipedia.org');
  }

  // Keyboard shortcut listener (Esc key)
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      triggerPanicExit();
    }
  });

  // Expose global method for buttons
  window.triggerPanicExit = triggerPanicExit;

  // Auto-inject float Panic Button if body exists and not already injected
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('panic-shield-btn')) return;

    const panicBtn = document.createElement('button');
    panicBtn.id = 'panic-shield-btn';
    panicBtn.setAttribute('title', 'Quick Exit (Press Esc)');
    panicBtn.className = 'fixed bottom-5 right-5 z-[9999] flex items-center gap-2 px-3.5 py-2.5 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full shadow-lg backdrop-blur-md border border-rose-500/30 text-xs font-semibold tracking-wide transition-all active:scale-95 group';
    panicBtn.innerHTML = `
      <span class="material-symbols-outlined text-[18px] group-hover:animate-pulse">shield</span>
      <span class="font-sans">Quick Exit</span>
      <span class="bg-white/20 px-1.5 py-0.5 rounded text-[10px] font-mono">Esc</span>
    `;
    panicBtn.onclick = triggerPanicExit;
    document.body.appendChild(panicBtn);
  });
})();
