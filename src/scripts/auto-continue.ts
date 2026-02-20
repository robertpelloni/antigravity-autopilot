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
     controls: {
         acceptAll: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['accept-all-button', 'keep-button', 'allow-all-button', 'dom-click'], delayMs: 100 },
         continue: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['continue-button', 'keep-button', 'dom-click'], delayMs: 100 },
         run: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['dom-click', 'native-click', 'alt-enter'], delayMs: 100 },
         expand: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['dom-click', 'native-click', 'alt-enter'], delayMs: 50 },
         accept: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['accept-all-first', 'accept-single', 'dom-click'], delayMs: 100 },
         submit: { detectMethods: ['enabled-flag', 'not-generating'], actionMethods: ['click-send', 'enter-key'], delayMs: 100 },
         feedback: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['thumbs-up', 'helpful-button', 'dom-click'], delayMs: 150 }
     },
     bump: {
         detectMethods: ['feedback-visible', 'not-generating', 'last-sender-user', 'network-error-retry', 'waiting-for-input', 'loaded-conversation', 'completed-all-tasks', 'skip-ai-question'],
         typeMethods: ['exec-command', 'native-setter', 'dispatch-events'],
         submitMethods: ['click-send', 'enter-key'],
         userDelayMs: 3000,
         retryDelayMs: 2000,
         typingDelayMs: 50,
         submitDelayMs: 100
     },
     debug: { highlightClicks: false, verboseLogging: false, logAllActions: true, logToExtension: true },
     timing: { 
         pollIntervalMs: 800, 
         actionThrottleMs: 500, 
         cooldownMs: 1500, 
         randomness: 50, 
         autoReplyDelayMs: 7000 
     }
  };

  let lastAction = Date.now(); 
    const lastActionByControl = { run: 0, expand: 0, accept: 0, acceptAll: 0, continue: 0, submit: 0, feedback: 0, bump: 0 };
    let lastStateSignature = '';
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

  function emitBridge(payload) {
      try {
          if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
              window.__ANTIGRAVITY_BRIDGE__(payload);
          } else {
              console.log(payload);
          }
      } catch {}
  }

  function logAction(msg) {
      const cfg = getConfig();
      if (cfg.debug?.verboseLogging || cfg.debug?.logAllActions) {
          console.log('[auto-continue] ' + msg);
      }
      if (cfg.debug?.logToExtension !== false) {
          emitBridge('__ANTIGRAVITY_LOG__:' + msg);
      }
  }

  function emitAction(group, detail) {
      logAction('action=' + group + ' detail=' + detail);
      emitBridge('__ANTIGRAVITY_ACTION__:' + String(group || 'click') + '|' + String(detail || 'triggered'));
  }

  function hasMethod(methods, id) {
      return Array.isArray(methods) && methods.includes(id);
  }

  function getBumpConfig(cfg) {
      const bump = cfg.bump || {};
      return {
          detectMethods: Array.isArray(bump.detectMethods) ? bump.detectMethods : defaults.bump.detectMethods,
          typeMethods: Array.isArray(bump.typeMethods) ? bump.typeMethods : defaults.bump.typeMethods,
          submitMethods: Array.isArray(bump.submitMethods) ? bump.submitMethods : defaults.bump.submitMethods,
          userDelayMs: Number.isFinite(bump.userDelayMs) ? bump.userDelayMs : defaults.bump.userDelayMs,
          retryDelayMs: Number.isFinite(bump.retryDelayMs) ? bump.retryDelayMs : defaults.bump.retryDelayMs,
          typingDelayMs: Number.isFinite(bump.typingDelayMs) ? bump.typingDelayMs : defaults.bump.typingDelayMs,
          submitDelayMs: Number.isFinite(bump.submitDelayMs) ? bump.submitDelayMs : defaults.bump.submitDelayMs
      };
  }

  function getControlConfig(cfg, controlName) {
      const controls = cfg.controls || {};
      const fallback = defaults.controls[controlName] || { detectMethods: [], actionMethods: [], delayMs: 0 };
      const current = controls[controlName] || {};
      return {
          detectMethods: Array.isArray(current.detectMethods) ? current.detectMethods : fallback.detectMethods,
          actionMethods: Array.isArray(current.actionMethods) ? current.actionMethods : fallback.actionMethods,
          delayMs: Number.isFinite(current.delayMs) ? current.delayMs : fallback.delayMs
      };
  }

    function controlGatePass(controlName, cfg, state, now, controlLastActionTime) {
      const control = getControlConfig(cfg, controlName);
      const detect = control.detectMethods || [];
      if (!Array.isArray(detect) || detect.length === 0) return false;

      const enabledByFlag = controlName === 'run'
          ? !!cfg.clickRun
          : controlName === 'continue'
              ? !!cfg.clickContinue
              : controlName === 'acceptAll'
                  ? (!!cfg.clickAccept && !!cfg.clickAcceptAll)
          : controlName === 'expand'
              ? !!cfg.clickExpand
              : controlName === 'accept'
                  ? !!cfg.clickAccept
                  : controlName === 'submit'
                      ? !!cfg.clickSubmit
                      : controlName === 'feedback'
                          ? !!cfg.clickFeedback
                      : true;

      if (hasMethod(detect, 'enabled-flag') && !enabledByFlag) return false;
      if (hasMethod(detect, 'not-generating') && state.isGenerating) return false;
      if (hasMethod(detect, 'action-cooldown') && (now - controlLastActionTime < Math.max(0, control.delayMs || 0))) return false;
      if (hasMethod(detect, 'idle-only') && state.lastSender !== 'ai') return false;
      return true;
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

  function hasUnsafeLabel(el) {
      try {
          const text = ((el?.textContent || '') + ' ' + (el?.getAttribute?.('aria-label') || '') + ' ' + (el?.getAttribute?.('title') || '')).toLowerCase();
          return /(extension|extensions|marketplace|plugin|install|uninstall|enable|disable)/i.test(text);
      } catch {
          return false;
      }
  }

  function isUnsafeContext(el) {
      if (!el || !el.closest) return false;
      const unsafe = el.closest(
          '.extensions-viewlet, [id*="workbench.view.extensions"], [class*="extensions"], [id*="extensions"], [class*="marketplace"], [id*="marketplace"], [data-view-id*="extensions"], .quick-input-widget, .monaco-quick-input-container, .settings-editor'
      );
      return !!unsafe;
  }

  // --- Analysis Helpers ---

  function analyzeChatState() {
      // 1. Check if generating
      const stopBtn = document.querySelector('[title*="Stop"], [aria-label*="Stop"]');
      const isGenerating = !!stopBtn;
      const input = document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
      const hasInputReady = !!input && (input.offsetParent || input.clientWidth > 0 || input.clientHeight > 0);
      const feedbackVisible = !!document.querySelector('.codicon-thumbsup, .codicon-thumbsdown, [title*="Helpful"], [aria-label*="Helpful"], [title*="Good"], [title*="Bad"]');

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

      const rowCount = rows.length;
      const buttonSignals = {
          acceptAll: document.querySelectorAll('[title*="Accept All"], [aria-label*="Accept All"]').length,
          keep: document.querySelectorAll('[title="Keep"], [aria-label="Keep"], button[title*="Keep"], button[aria-label*="Keep"]').length,
          allow: document.querySelectorAll('[title*="Allow"], [aria-label*="Allow"], button[title*="Allow"], button[aria-label*="Allow"]').length,
          run: document.querySelectorAll('[title*="Run in Terminal"], [aria-label*="Run in Terminal"], .codicon-play, .codicon-run').length,
          expand: document.querySelectorAll('[title*="Expand"], [aria-label*="Expand"], .monaco-tl-twistie.collapsed, .codicon-chevron-right').length,
          continue: document.querySelectorAll('a.monaco-button, button.monaco-button, .action-label').length,
          submit: document.querySelectorAll('[title="Send"], [aria-label="Send"], [title*="Submit"], [aria-label*="Submit"], .codicon-send').length,
          feedback: document.querySelectorAll('.codicon-thumbsup, .codicon-thumbsdown, [title*="Helpful"], [aria-label*="Helpful"], [title*="Good"], [title*="Bad"]').length
      };
      return { isGenerating, lastSender, lastText, rowCount, hasInputReady, feedbackVisible, buttonSignals };
  }

  // --- Actions ---

    function tryClick(selector, name, group) {
      const els = Array.from(document.querySelectorAll(selector));
      for (const el of els) {
          if (isUnsafeContext(el) || hasUnsafeLabel(el)) continue;
          if (el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0) {
             if (el.hasAttribute('disabled') || el.classList.contains('disabled')) continue;
             
             highlight(el);
             el.click();
             log('Clicked ' + name);
             emitAction(group || 'click', name);
             return true; 
          }
      }
      return false;
  }

  function dispatchInputEvents(input, text) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, text);
      } else {
          input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function typeAndSubmit(text) {
      const cfg = getConfig();
      const bump = getBumpConfig(cfg);
      const input = document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
      if (!input) return false;

      if (input.value && input.value.trim().length > 0) {
           // Skip typing if something is there
      } else {
          input.focus();

          let typed = false;
          if (hasMethod(bump.typeMethods, 'exec-command')) {
              try {
                  typed = !!document.execCommand('insertText', false, text);
              } catch(e) {}
          }

          if (!typed && hasMethod(bump.typeMethods, 'native-setter')) {
              try {
                  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                  if (nativeInputValueSetter) {
                      nativeInputValueSetter.call(input, text);
                  } else {
                      input.value = text;
                  }
                  typed = true;
              } catch(e) {}
          }

          if (hasMethod(bump.typeMethods, 'dispatch-events')) {
              dispatchInputEvents(input, input.value || text);
              typed = true;
          }

          if (!typed) {
              input.value = text;
              dispatchInputEvents(input, text);
          }

          log('Auto-Replied (Typed): ' + text);
          emitAction('type', 'typed bump text');
      }

      const submitDelay = Math.max(0, bump.submitDelayMs || 0);
      setTimeout(() => {
          const sendSelectors = '[title="Send"], [aria-label="Send"], [title*="Submit"], [aria-label*="Submit"], .codicon-send';
          let submitted = false;

          if (hasMethod(bump.submitMethods, 'click-send')) {
              submitted = tryClick(sendSelectors, 'Submit (Auto-Reply)', 'submit');
          }

          if (!submitted && hasMethod(bump.submitMethods, 'enter-key')) {
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              emitAction('submit', 'keys');
              submitted = true;
          }

          if (!submitted) {
              if (!tryClick(sendSelectors, 'Submit (Auto-Reply fallback)', 'submit')) {
                  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  emitAction('submit', 'keys');
              }
          }
      }, submitDelay);
      return true;
  }

  function runLoop() {
    try {
      const cfg = getConfig();
      const now = Date.now();
    const state = analyzeChatState();
      const stateSignature = [
          state.isGenerating ? '1' : '0',
          state.hasInputReady ? '1' : '0',
          state.feedbackVisible ? '1' : '0',
          state.lastSender,
          state.rowCount,
          state.buttonSignals?.acceptAll || 0,
          state.buttonSignals?.keep || 0,
          state.buttonSignals?.allow || 0,
          state.buttonSignals?.run || 0,
          state.buttonSignals?.expand || 0,
          state.buttonSignals?.submit || 0
      ].join('|');
      if (stateSignature !== lastStateSignature) {
          lastStateSignature = stateSignature;
          logAction('state changed generating=' + state.isGenerating + ' sender=' + state.lastSender + ' rows=' + state.rowCount + ' input=' + state.hasInputReady + ' signals=' + JSON.stringify(state.buttonSignals || {}));
      }
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
    if (controlGatePass('continue', cfg, state, now, lastActionByControl.continue)) {
          const continueControl = getControlConfig(cfg, 'continue');
          const contSel = 'a.monaco-button, button.monaco-button, .action-label';
          const els = Array.from(document.querySelectorAll(contSel));
          const target = els.find(el => {
              if (isUnsafeContext(el) || hasUnsafeLabel(el)) return false;
              const t = (el.textContent || '').trim().toLowerCase();
              const l = (el.getAttribute('aria-label') || '').toLowerCase();
              const continueMatch = hasMethod(continueControl.actionMethods, 'continue-button') && (/continue/i.test(t) || /continue/i.test(l));
              const keepMatch = hasMethod(continueControl.actionMethods, 'keep-button') && /^keep$/i.test(t);
              if (continueMatch) return !/rebase/i.test(l);
              if (keepMatch) return true;
              return false;
          });
          
          if (target && (target.offsetParent || target.clientWidth > 0)) {
               if (hasMethod(continueControl.actionMethods, 'dom-click')) {
                    highlight(target);
                    target.click();
                    actionTaken = true;
                    lastActionByControl.continue = now;
                    log('Clicked Continue/Keep');
                    emitAction('continue', 'clicked continue/keep');
               }
          }
      }

      // 2.5 Auto-Accept-All
    if (!actionTaken && controlGatePass('acceptAll', cfg, state, now, lastActionByControl.acceptAll)) {
          const acceptAllControl = getControlConfig(cfg, 'acceptAll');
          const acceptAllSelectors = [];
          if (hasMethod(acceptAllControl.actionMethods, 'accept-all-button')) {
              acceptAllSelectors.push('[title*="Accept All"]', '[aria-label*="Accept All"]', '.codicon-check-all');
          }
          if (hasMethod(acceptAllControl.actionMethods, 'keep-button')) {
              acceptAllSelectors.push('[title="Keep"]', '[aria-label="Keep"]', 'button[title*="Keep"]', 'button[aria-label*="Keep"]');
          }
          if (hasMethod(acceptAllControl.actionMethods, 'allow-all-button')) {
              acceptAllSelectors.push('[title*="Allow"]', '[aria-label*="Allow"]', 'button[title*="Allow"]', 'button[aria-label*="Allow"]');
          }
          if (hasMethod(acceptAllControl.actionMethods, 'dom-click') && acceptAllSelectors.length === 0) {
              acceptAllSelectors.push('[title*="Accept All"]', '[aria-label*="Accept All"]', '[title="Keep"]', '[aria-label="Keep"]', '[title*="Allow"]', '[aria-label*="Allow"]', '.codicon-check-all');
          }
          if (acceptAllSelectors.length > 0 && tryClick(acceptAllSelectors.join(', '), 'Accept All/Keep', 'accept-all')) {
              actionTaken = true;
              lastActionByControl.acceptAll = now;
          }
      }

      // 2. Auto-Run
    if (!actionTaken && controlGatePass('run', cfg, state, now, lastActionByControl.run)) {
          const runControl = getControlConfig(cfg, 'run');
          const runSelectors = [
              '[title*="Run in Terminal"]',
              '[aria-label*="Run in Terminal"]',
              '.codicon-play',
              '.codicon-run' 
          ].join(',');

          if (hasMethod(runControl.actionMethods, 'dom-click')) {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"], .clickable'));
              const textMatch = buttons.find(el => {
                  if (isUnsafeContext(el) || hasUnsafeLabel(el)) return false;
                  if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return false;
                  if (!(el.offsetParent || el.clientWidth > 0)) return false;
                  const text = (el.textContent || '').trim().toLowerCase();
                  const label = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                  return text === 'run' || label === 'run' || label.includes('run (');
              });
              if (textMatch) {
                  highlight(textMatch);
                  textMatch.click();
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Clicked Run (Text Match)');
                  emitAction('run', 'text-match run');
              }
          }

          if (!actionTaken && hasMethod(runControl.actionMethods, 'dom-click') && tryClick(runSelectors, 'Run', 'run')) {
              actionTaken = true;
              lastActionByControl.run = now;
          }

          if (!actionTaken && hasMethod(runControl.actionMethods, 'native-click')) {
              const candidate = Array.from(document.querySelectorAll(runSelectors)).find(el => el && !isUnsafeContext(el) && !hasUnsafeLabel(el) && (el.offsetParent || el.clientWidth > 0));
              if (candidate) {
                  highlight(candidate);
                  candidate.click();
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Clicked Run (native-click)');
                  emitAction('run', 'native-click run');
              }
          }

          if (!actionTaken && hasMethod(runControl.actionMethods, 'alt-enter')) {
              const target = document.activeElement || document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
              if (target) {
                  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true }));
                  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true }));
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Triggered Run fallback via Alt+Enter');
                  emitAction('alt-enter', 'run fallback alt-enter');
              }
          }
      }

      // 3. Auto-Accept
    if (!actionTaken && controlGatePass('accept', cfg, state, now, lastActionByControl.accept)) {
          const acceptControl = getControlConfig(cfg, 'accept');

          if (!actionTaken && hasMethod(acceptControl.actionMethods, 'accept-single')) {
              if (tryClick('[title="Accept"], [aria-label="Accept"], [title="Apply"], .codicon-check', 'Accept', 'accept')) {
                  actionTaken = true;
                  lastActionByControl.accept = now;
              }
          }

          if (!actionTaken && hasMethod(acceptControl.actionMethods, 'dom-click')) {
              if (tryClick('[title*="Accept"], [aria-label*="Accept"], [title*="Apply"], [aria-label*="Apply"]', 'Accept (DOM)', 'accept')) {
                  actionTaken = true;
                  lastActionByControl.accept = now;
              }
          }
      }

      // 4. Auto-Expand
    if (!actionTaken && controlGatePass('expand', cfg, state, now, lastActionByControl.expand)) {
          const expandControl = getControlConfig(cfg, 'expand');
          const expandSelectors = [
              '[title*="Expand"]',
              '[aria-label*="Expand"]',
              '.monaco-tl-twistie.collapsed',
              '.codicon-chevron-right',
              '.codicon-bell'
          ].join(',');

          if (hasMethod(expandControl.actionMethods, 'dom-click')) {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"], .clickable, .codicon-bell'));
              const textMatch = buttons.find(el => {
                  if (isUnsafeContext(el) || hasUnsafeLabel(el)) return false;
                  if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return false;
                  if (!(el.offsetParent || el.clientWidth > 0)) return false;
                  const text = (el.textContent || '').trim().toLowerCase();
                  const label = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                  if (text.includes('requires input') || (text.includes('step') && text.includes('input')) || text.includes('expand') || label.includes('expand') || el.classList.contains('codicon-bell')) {
                      return !text.includes('explorer') && !label.includes('explorer');
                  }
                  return false;
              });
              if (textMatch) {
                  highlight(textMatch);
                  textMatch.click();
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Clicked Expand (Text Match)');
                  emitAction('expand', 'text-match expand');
              }
          }

          if (!actionTaken && hasMethod(expandControl.actionMethods, 'dom-click') && tryClick(expandSelectors, 'Expand', 'expand')) {
              actionTaken = true;
              lastActionByControl.expand = now;
          }

          if (!actionTaken && hasMethod(expandControl.actionMethods, 'native-click')) {
              const candidate = Array.from(document.querySelectorAll(expandSelectors)).find(el => el && !isUnsafeContext(el) && !hasUnsafeLabel(el) && (el.offsetParent || el.clientWidth > 0));
              if (candidate) {
                  highlight(candidate);
                  candidate.click();
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Clicked Expand (native-click)');
                  emitAction('expand', 'native-click expand');
              }
          }

          if (!actionTaken && hasMethod(expandControl.actionMethods, 'alt-enter')) {
              const target = document.activeElement || document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
              if (target) {
                  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true }));
                  target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true }));
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Triggered Expand fallback via Alt+Enter');
                  emitAction('alt-enter', 'expand fallback alt-enter');
              }
          }
      }
      
      // 5. Auto-Submit
    if (!actionTaken && controlGatePass('submit', cfg, state, now, lastActionByControl.submit)) {
          const submitControl = getControlConfig(cfg, 'submit');
          const submitDelay = Math.max(0, submitControl.delayMs || 0);
          const sendSelectors = '[title="Send"], [aria-label="Send"], [title*="Submit"], [aria-label*="Submit"], .codicon-send';

          if (hasMethod(submitControl.actionMethods, 'click-send') && tryClick(sendSelectors, 'Submit', 'submit')) {
              actionTaken = true;
              lastActionByControl.submit = now;
          }

          if (!actionTaken && hasMethod(submitControl.actionMethods, 'enter-key')) {
              const input = document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea');
              if (input) {
                  setTimeout(() => {
                      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                  }, submitDelay);
                  actionTaken = true;
                  lastActionByControl.submit = now;
                  log('Submitted via Enter key');
                  emitAction('submit', 'submit enter-key');
              }
          }
      }

      // 6. Feedback
    if (!actionTaken && controlGatePass('feedback', cfg, state, now, lastActionByControl.feedback)) {
          const feedbackControl = getControlConfig(cfg, 'feedback');
          const selectors = [];
          if (hasMethod(feedbackControl.actionMethods, 'helpful-button')) selectors.push('[title*="Helpful"]', '[aria-label*="Helpful"]');
          if (hasMethod(feedbackControl.actionMethods, 'thumbs-up')) selectors.push('.codicon-thumbsup');
          if (hasMethod(feedbackControl.actionMethods, 'dom-click')) selectors.push('[title*="Helpful"]', '[aria-label*="Helpful"]', '.codicon-thumbsup');
          const selector = selectors.join(',');
          const els = selector ? Array.from(document.querySelectorAll(selector)) : [];
          const target = els.find(el => !isUnsafeContext(el) && !hasUnsafeLabel(el) && !el.classList.contains('checked') && !el.classList.contains('selected') && (el.offsetParent || el.clientWidth>0));
          if (target) {
               highlight(target);
               target.click();
               actionTaken = true;
               lastActionByControl.feedback = now;
               log('Clicked Feedback');
               emitAction('success', 'clicked positive feedback');
          }
      }

      // 7. SMART RESUME (Actionable Auto-Reply)
      if (!actionTaken && cfg.autoReply) {
          const bump = getBumpConfig(cfg);
          const detectMethods = bump.detectMethods;
          const state = analyzeChatState();

          if (state.isGenerating) {
              // Active generation: Reset idle timer
              lastAction = now; 
          } else {
              // Idle state logic
              let computedDelay = cfg.timing?.autoReplyDelayMs ?? 7000;
              let shouldBump = false;
              let bumpText = cfg.autoReplyText || 'continue';

              if (hasMethod(detectMethods, 'not-generating')) {
                  shouldBump = true;
              }

              if (hasMethod(detectMethods, 'waiting-for-input') && state.hasInputReady && !state.isGenerating) {
                  shouldBump = true;
              }

              if (hasMethod(detectMethods, 'new-conversation') && state.rowCount <= 1 && state.hasInputReady) {
                  shouldBump = true;
              }

              if (hasMethod(detectMethods, 'loaded-conversation') && state.rowCount > 0 && state.hasInputReady) {
                  shouldBump = true;
              }

              if (hasMethod(detectMethods, 'completed-all-tasks') && /(all\s+tasks\s+complete|all\s+tasks\s+completed|task\s+complete|completed|done)/i.test(state.lastText || '')) {
                  shouldBump = true;
              }

              if (hasMethod(detectMethods, 'last-sender-user') && state.lastSender === 'user') {
                  // User waiting for response -> Fast Bump
                  computedDelay = Math.max(250, bump.userDelayMs || 3000);
                  shouldBump = true;
                  bumpText = '...'; // Nudge
              } else if (state.lastSender === 'ai') {
                  // AI finished text
                  const text = state.lastText.trim();
                  if (hasMethod(detectMethods, 'skip-ai-question') && text.endsWith('?')) {
                      // AI asking question -> Do NOT bump
                      shouldBump = false;
                  } else if (hasMethod(detectMethods, 'network-error-retry') && (text.toLowerCase().includes('network error') || text.toLowerCase().includes('connection lost'))) {
                      // Network error -> Retry
                      computedDelay = Math.max(250, bump.retryDelayMs || 2000);
                      shouldBump = true;
                      bumpText = 'retry';
                  } else if (hasMethod(detectMethods, 'feedback-visible')) {
                      shouldBump = state.feedbackVisible || shouldBump;
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
                       lastActionByControl.bump = now;
                       log('Smart Resume: Bumped with "' + bumpText + '" (Delay: ' + computedDelay + 'ms)');
                       emitAction('bump', 'smart resume bump text=' + bumpText);
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
