export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  window.__antigravityAutoContinueRunning = true;

  function emitBridge(payload) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
          window.__AUTOPILOT_BRIDGE__(payload);
      }
      console.log('__AUTOPILOT_STATE_LOG__: ' + payload);
    } catch (e) {}
  }

  let pollTimer = null;

  function isGenerating() {
    return !!document.querySelector(
      '.interactive-input-part .codicon-loading, [role="button"][title*="Stop" i], [role="button"][aria-label*="Stop" i], .typing-indicator'
    );
  }

  function detectButtons() {
    const buttons = [];
    const actionSpecs = [
      { key: 'run', regex: /(^|\\b)(run(\\s+in\\s+terminal|\\s+command)?|execute)(\\b|$)/i },
      { key: 'expand', regex: /(expand|requires\\s*input|step\\s*requires\\s*input)/i },
      { key: 'accept', regex: /(accept\\s*all|apply\\s*all|accept\\s*all\\s*changes|apply\\s*all\\s*changes)/i },
      { key: 'retry', regex: /\\bretry\\b/i },
      { key: 'keep', regex: /\\bkeep\\b/i }
    ];

    const elements = document.querySelectorAll('button, [role="button"], .monaco-button, a[role="button"]');
    for (const el of elements) {
      if (!el.isConnected || el.disabled) continue;
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      
      const text = (el.textContent || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
      for (const spec of actionSpecs) {
         if (spec.regex.test(text)) {
            if (!buttons.includes(spec.key)) buttons.push(spec.key);
         }
      }
    }
    return buttons;
  }

  function poll() {
    const payload = JSON.stringify({
      type: 'state',
      isGenerating: isGenerating(),
      buttons: detectButtons()
    });
    emitBridge(payload);
  }

  pollTimer = setInterval(poll, 1000);

  window.stopAutoContinue = function() {
    if (pollTimer) clearInterval(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  // Initial heartbeat
  poll();
})();
`;
