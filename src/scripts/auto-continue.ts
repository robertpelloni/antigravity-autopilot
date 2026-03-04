export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning) {
    try { if (typeof window.stopAutoContinue === 'function') window.stopAutoContinue(); } catch (e) {}
  }
  window.__antigravityAutoContinueRunning = true;

  function emit(payload) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(payload);
    } catch (e) {}
  }

  // Find the chat panel container — this is the ONLY place we look for buttons.
  // This prevents matching toolbar items, dropdown menus, settings UI, etc.
  function findChatContainers() {
    var containers = [];
    try {
      // Search through shadow DOMs for chat containers
      var queue = [document];
      while (queue.length > 0) {
        var root = queue.shift();
        try {
          var found = root.querySelectorAll('.interactive-session, .chat-widget, .interactive-input-part, [class*="chat-editor"]');
          for (var i = 0; i < found.length; i++) containers.push(found[i]);
          // Also traverse shadow roots
          var all = root.querySelectorAll('*');
          for (var j = 0; j < all.length; j++) {
            try { if (all[j].shadowRoot) queue.push(all[j].shadowRoot); } catch(e) {}
          }
        } catch(e) {}
      }
    } catch(e) {}
    return containers;
  }

  function isGenerating() {
    try {
      var containers = findChatContainers();
      for (var c = 0; c < containers.length; c++) {
        try {
          var spinners = containers[c].querySelectorAll('.codicon-loading, [class*="typing-indicator"], [class*="progress-indicator"]');
          if (spinners.length > 0) return true;
        } catch(e) {}
      }
      // Also check for Stop button anywhere in chat
      var queue = [document];
      while (queue.length > 0) {
        var root = queue.shift();
        try {
          var btns = root.querySelectorAll('[role="button"][title*="Stop" i], button[aria-label*="Stop" i]');
          if (btns.length > 0) return true;
          var all = root.querySelectorAll('*');
          for (var j = 0; j < all.length; j++) {
            try { if (all[j].shadowRoot) queue.push(all[j].shadowRoot); } catch(e) {}
          }
        } catch(e) {}
      }
    } catch (e) {}
    return false;
  }

  // Exact button text matching — prevents "Always Run" false positive
  function getCleanText(el) {
    try {
      return (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    } catch(e) { return ''; }
  }

  function detectButtons() {
    var buttons = [];
    try {
      var containers = findChatContainers();
      if (containers.length === 0) return buttons;

      for (var c = 0; c < containers.length; c++) {
        try {
          var elems = containers[c].querySelectorAll('button, [role="button"], .monaco-button');
          for (var i = 0; i < elems.length; i++) {
            try {
              var el = elems[i];
              if (!el.isConnected || el.disabled || el.classList.contains('disabled')) continue;
              if (el.clientWidth === 0 && el.clientHeight === 0) continue;

              var text = getCleanText(el);
              var title = (el.getAttribute('title') || '').toLowerCase().trim();
              var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase().trim();

              // EXACT matches only — no substring indexOf that matches "Always Run"
              // "run" must be the WHOLE text or title, not a substring of something else
              if ((text === 'run' || title === 'run' || ariaLabel === 'run' ||
                   text === 'run tool' || title === 'run tool') && buttons.indexOf('run') < 0) {
                buttons.push('run');
              }
              if ((text === 'expand' || title === 'expand' || ariaLabel === 'expand' ||
                   text.indexOf('requires input') >= 0 || title.indexOf('requires input') >= 0) && buttons.indexOf('expand') < 0) {
                buttons.push('expand');
              }
              if ((text === 'accept all' || title === 'accept all' || ariaLabel === 'accept all' ||
                   text === 'apply all' || title === 'apply all') && buttons.indexOf('accept_all') < 0) {
                buttons.push('accept_all');
              }
              if ((text === 'keep' || title === 'keep' || ariaLabel === 'keep') && buttons.indexOf('keep') < 0) {
                buttons.push('keep');
              }
              if ((text === 'retry' || title === 'retry' || ariaLabel === 'retry') && buttons.indexOf('retry') < 0) {
                buttons.push('retry');
              }
              if ((text === 'allow' || title === 'allow' || ariaLabel === 'allow' ||
                   text === 'always allow' || title === 'always allow') && buttons.indexOf('allow') < 0) {
                buttons.push('allow');
              }
              if ((text === 'continue' || title === 'continue' || ariaLabel === 'continue') && buttons.indexOf('continue') < 0) {
                buttons.push('continue');
              }
            } catch(e) {}
          }
        } catch(e) {}
      }
    } catch (e) {}
    return buttons;
  }

  var pollTimer = null;

  function poll() {
    try {
      emit(JSON.stringify({
        type: 'state',
        isGenerating: isGenerating(),
        buttons: detectButtons()
      }));
    } catch (e) {
      try { emit(JSON.stringify({type:'state',isGenerating:false,buttons:[]})); } catch(x) {}
    }
  }

  pollTimer = setInterval(poll, 1500);

  window.stopAutoContinue = function() {
    if (pollTimer) clearInterval(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  poll(); // Initial heartbeat
})();
`;
