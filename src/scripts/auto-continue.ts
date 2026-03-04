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
    } catch (e) {}
  }

  function queryShadowDOMAll(selector, root) {
      root = root || document;
      let results = [];
      if (root.querySelectorAll) {
          try { results = Array.from(root.querySelectorAll(selector)); } catch(e) {}
      }
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (let i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) {
              results = results.concat(queryShadowDOMAll(selector, all[i].shadowRoot));
          }
      }
      return results;
  }

  let pollTimer = null;

  function isGenerating() {
    const spinners = queryShadowDOMAll('.interactive-input-part .codicon-loading, [role="button"][title*="Stop" i], [role="button"][aria-label*="Stop" i], .typing-indicator');
    return spinners.length > 0;
  }

  function detectButtons() {
    const buttons = [];
    const actionSpecs = [
      { key: 'run', regex: /(^|\\b)(run(\\s+in\\s+terminal|\\s+command)?|execute)(\\b|$)/i },
      { key: 'expand', regex: /(expand|requires\\s*input|step\\s*requires\\s*input)/i },
      { key: 'accept', regex: /(accept\\s*all|apply\\s*all|accept\\s*all\\s*changes|apply\\s*all\\s*changes)/i },
      { key: 'accept', regex: /^accept$/i },
      { key: 'retry', regex: /\\bretry\\b/i },
      { key: 'keep', regex: /\\bkeep\\b/i }
    ];

    const elements = queryShadowDOMAll('button, [role="button"], .monaco-button, a[role="button"]');
    for (const el of elements) {
      if (!el.isConnected || el.disabled || el.classList.contains('disabled')) continue;
      
      const width = el.clientWidth || 0;
      const height = el.clientHeight || 0;
      if (width === 0 && height === 0 && !el.offsetParent) continue;
      
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
