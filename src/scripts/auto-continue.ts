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
      var results = [];
      try {
        if (root.querySelectorAll) {
            results = Array.from(root.querySelectorAll(selector));
        }
        var all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (var i = 0; i < all.length; i++) {
            try {
              if (all[i].shadowRoot) {
                  results = results.concat(queryShadowDOMAll(selector, all[i].shadowRoot));
              }
            } catch (innerErr) {}
        }
      } catch (outerErr) {}
      return results;
  }

  var pollTimer = null;

  function isGenerating() {
    try {
      var spinners = queryShadowDOMAll('.interactive-input-part .codicon-loading, [role="button"][title*="Stop" i], [role="button"][aria-label*="Stop" i], .typing-indicator');
      return spinners.length > 0;
    } catch (e) { return false; }
  }

  function detectButtons() {
    var buttons = [];
    try {
      var elements = queryShadowDOMAll('button, [role="button"], .monaco-button, a[role="button"]');
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        try {
          if (!el.isConnected || el.disabled || el.classList.contains('disabled')) continue;
          var width = el.clientWidth || 0;
          var height = el.clientHeight || 0;
          if (width === 0 && height === 0 && !el.offsetParent) continue;

          var text = (el.textContent || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '');
          var lower = text.toLowerCase();

          if (lower.indexOf('run') >= 0 && buttons.indexOf('run') < 0) buttons.push('run');
          if ((lower.indexOf('expand') >= 0 || lower.indexOf('requires input') >= 0) && buttons.indexOf('expand') < 0) buttons.push('expand');
          if ((lower.indexOf('accept') >= 0 || lower.indexOf('apply') >= 0) && buttons.indexOf('accept') < 0) buttons.push('accept');
          if (lower.indexOf('retry') >= 0 && buttons.indexOf('retry') < 0) buttons.push('retry');
          if (lower.indexOf('keep') >= 0 && buttons.indexOf('keep') < 0) buttons.push('keep');
        } catch (elErr) {}
      }
    } catch (e) {}
    return buttons;
  }

  function poll() {
    try {
      var payload = JSON.stringify({
        type: 'state',
        isGenerating: isGenerating(),
        buttons: detectButtons()
      });
      emitBridge(payload);
    } catch (e) {
      // Catch everything so setInterval survives
      try { emitBridge(JSON.stringify({type:'state',isGenerating:false,buttons:[]})); } catch(x) {}
    }
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
