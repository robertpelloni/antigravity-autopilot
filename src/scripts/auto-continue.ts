export const AUTO_CONTINUE_SCRIPT = `
(function(){
  if (window.__antigravityAutoContinueRunning) return;
  window.__antigravityAutoContinueRunning = true;

  // Defaults
  const defaults = {
     clickRun: true,
     clickExpand: true,
     clickAccept: true,
     clickAcceptAll: true,
     clickContinue: true,
     clickSubmit: true,
     clickFeedback: false,
     autoScroll: true,
     autoReply: true,
     autoReplyText: 'continue',
     debug: { highlightClicks: false, verboseLogging: false },
     timing: { 
         pollIntervalMs: 800, 
         actionThrottleMs: 500, 
         cooldownMs: 1500, 
         randomness: 50, 
         autoReplyDelayMs: 7000 
     }
  };

  let lastAction = Date.now(); 
  let pollTimer = null;

  function getConfig() {
    return window.__antigravityConfig || defaults;
  }

  function log(msg) {
    const cfg = getConfig();
    if (cfg.debug?.verboseLogging) {
      console.log('[auto-continue] ' + msg);
    }
  }

  function highlight(el) {
    const cfg = getConfig();
    if (!cfg.debug?.highlightClicks) return;
    try {
        const original = el.style.outline;
        el.style.outline = '3px solid red';
        el.style.boxShadow = '0 0 10px red';
        setTimeout(() => { 
            el.style.outline = original; 
            el.style.boxShadow = '';
        }, 500);
    } catch(e) {}
  }

  // --- Analysis Helpers ---

  function analyzeChatState() {
      // 1. Check if generating
      const stopBtn = document.querySelector('[title*="Stop"], [aria-label*="Stop"]');
      const isGenerating = !!stopBtn;

      // 2. Find last message
      // Selectors depend on VS Code version, but usually .monaco-list-row or .chat-row
      const rows = Array.from(document.querySelectorAll('.monaco-list-row, .chat-row, [role="listitem"]'));
      const lastRow = rows[rows.length - 1];
      
      let lastSender = 'unknown';
      let lastText = '';

      if (lastRow) {
          lastText = lastRow.innerText || '';
          // Heuristic for sender:
          // User messages often have specific avatars or class names
          const html = lastRow.innerHTML.toLowerCase();
          if (html.includes('codicon-account') || html.includes('user-avatar')) {
              lastSender = 'user';
          } else if (html.includes('codicon-copilot') || html.includes('ai-avatar')) {
              lastSender = 'ai';
          } else {
              // Text based fallback
              if (lastText.startsWith('You:')) lastSender = 'user';
              if (lastText.startsWith('Copilot:')) lastSender = 'ai';
          }
      }

      return { isGenerating, lastSender, lastText };
  }

  // --- Actions ---

  function tryClick(selector, name) {
      const els = Array.from(document.querySelectorAll(selector));
      for (const el of els) {
          if (el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0) {
             if (el.hasAttribute('disabled') || el.classList.contains('disabled')) continue;
             
             highlight(el);
             el.click();
             log('Clicked ' + name);
             return true; 
          }
      }
      return false;
  }

  function dispatchInputEvents(input, text) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeInputValueSetter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeAndSubmit(text) {
      const input = document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
      if (!input) return false;

      if (input.value && input.value.trim().length > 0) {
           // Skip typing if something is there
      } else {
          input.focus();
          try { document.execCommand('insertText', false, text); } catch(e) {}
          if (input.value !== text) dispatchInputEvents(input, text);
          log('Auto-Replied (Typed): ' + text);
      }
      
      setTimeout(() => {
          const sendSelectors = '[title="Send"], [aria-label="Send"], [title*="Submit"], [aria-label*="Submit"], .codicon-send';
          if (!tryClick(sendSelectors, 'Submit (Auto-Reply)')) {
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }
      }, 500);
      return true;
  }

  function runLoop() {
    try {
      const cfg = getConfig();
      const now = Date.now();
      const baseThrottle = cfg.timing?.actionThrottleMs ?? 500;
      const jitter = cfg.timing?.randomness ?? 50;
      if (now - lastAction < (baseThrottle + Math.random() * jitter)) return;

      let actionTaken = false;

      // 0. Auto-Scroll
      if (cfg.autoScroll) {
          const containers = document.querySelectorAll('.monaco-list-rows, .chat-list, [role="log"]');
          for (const c of containers) {
             if (c.scrollTop + c.clientHeight >= c.scrollHeight - 150) {
                 c.scrollTop = c.scrollHeight;
             }
          }
      }

      // 1. Continue / Keep (Priority)
      if (cfg.clickContinue) {
          const contSel = 'a.monaco-button, button.monaco-button, .action-label';
          const els = Array.from(document.querySelectorAll(contSel));
          const target = els.find(el => {
              const t = (el.textContent || '').trim().toLowerCase();
              const l = (el.getAttribute('aria-label') || '').toLowerCase();
              if (/continue/i.test(t) || /continue/i.test(l)) return !/rebase/i.test(l);
              if (/^keep$/i.test(t)) return true;
              return false;
          });
          
          if (target && (target.offsetParent || target.clientWidth > 0)) {
               highlight(target);
               target.click();
               actionTaken = true;
               log('Clicked Continue/Keep');
          }
      }

      // 2. Auto-Run
      if (!actionTaken && cfg.clickRun) {
          const runSelectors = [
              '[title*="Run in Terminal"]',
              '[aria-label*="Run in Terminal"]',
              '.codicon-play',
              '.codicon-run' 
          ].join(',');
          if (tryClick(runSelectors, 'Run')) actionTaken = true;
      }

      // 3. Auto-Accept
      if (!actionTaken && cfg.clickAccept) {
          if (cfg.clickAcceptAll) {
              if (tryClick('[title*="Accept All"], [aria-label*="Accept All"], .codicon-check-all', 'Accept All')) actionTaken = true;
          }
          if (!actionTaken) {
              if (tryClick('[title="Accept"], [aria-label="Accept"], [title="Apply"], .codicon-check', 'Accept')) actionTaken = true;
          }
      }

      // 4. Auto-Expand
      if (!actionTaken && cfg.clickExpand) {
          const expandSelectors = [
              '[title*="Expand"]',
              '[aria-label*="Expand"]',
              '.monaco-tl-twistie.collapsed',
              '.codicon-chevron-right'
          ].join(',');
          if (tryClick(expandSelectors, 'Expand')) actionTaken = true;
      }
      
      // 5. Auto-Submit
      if (!actionTaken && cfg.clickSubmit) {
          const sendSelectors = '[title="Send"], [aria-label="Send"], [title*="Submit"], [aria-label*="Submit"], .codicon-send';
          if (tryClick(sendSelectors, 'Submit')) actionTaken = true;
      }

      // 6. Feedback
      if (!actionTaken && cfg.clickFeedback) {
          const els = Array.from(document.querySelectorAll('[title*="Helpful"], [aria-label*="Helpful"], .codicon-thumbsup'));
          const target = els.find(el => !el.classList.contains('checked') && !el.classList.contains('selected') && (el.offsetParent || el.clientWidth>0));
          if (target) {
               highlight(target);
               target.click();
               actionTaken = true;
               log('Clicked Feedback');
          }
      }

      // 7. SMART RESUME (Actionable Auto-Reply)
      if (!actionTaken && cfg.autoReply) {
          const state = analyzeChatState();

          if (state.isGenerating) {
              // Active generation: Reset idle timer
              lastAction = now; 
          } else {
              // Idle state logic
              let computedDelay = cfg.timing?.autoReplyDelayMs ?? 7000;
              let shouldBump = false;
              let bumpText = cfg.autoReplyText || 'continue';

              if (state.lastSender === 'user') {
                  // User waiting for response -> Fast Bump
                  computedDelay = 3000;
                  shouldBump = true;
                  bumpText = '...'; // Nudge
              } else if (state.lastSender === 'ai') {
                  // AI finished text
                  const text = state.lastText.trim();
                  if (text.endsWith('?')) {
                      // AI asking question -> Do NOT bump
                      shouldBump = false;
                  } else if (text.toLowerCase().includes('network error') || text.toLowerCase().includes('connection lost')) {
                      // Network error -> Retry
                      computedDelay = 2000;
                      shouldBump = true;
                      bumpText = 'retry';
                  } else {
                      // Standard completion -> Standard Bump
                      // Heuristic: If it looks incomplete (no period, or code block open), bump.
                      // For now, assume simple "continue" loop
                      shouldBump = true;
                  }
              } else {
                  // Unknown sender -> Standard Bump
                  shouldBump = true;
              }

              if (shouldBump && (now - lastAction > computedDelay)) {
                  if (typeAndSubmit(bumpText)) {
                       actionTaken = true;
                       log('Smart Resume: Bumped with "' + bumpText + '" (Delay: ' + computedDelay + 'ms)');
                  }
              }
          }
      }

      if (actionTaken) lastAction = now;

    } catch (e) {
      // console.error(e);
    }
  }

  function scheduleNext() {
      const cfg = getConfig();
      const interval = cfg.timing?.pollIntervalMs ?? 800;
      pollTimer = setTimeout(() => {
          runLoop();
          scheduleNext();
      }, interval);
  }

  scheduleNext();
  
  // Expose state for CDP
  window.__antigravityGetState = analyzeChatState;

  window.stopAutoContinue = () => {
    clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
    log('stopped.');
  };
})();
`;
