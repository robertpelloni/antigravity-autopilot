export const AUTO_CONTINUE_SCRIPT = `
(function() {
  if (window.__antigravityAutoContinueRunning && !window.stopAutoContinue) {
      console.log('Auto-Continue already running.');
      return;
  }

  // 1. ZOMBIE SLAYER: Unique Instance ID to kill old closure loops
  const THIS_INSTANCE = Math.random();
  window.__antigravityActiveInstance = THIS_INSTANCE;

  // 2. Kill any existing visible timers on the window object
  if (window.stopAutoContinue) {
      window.stopAutoContinue();
  }
  if (window.__antigravityPollTimer) {
      clearTimeout(window.__antigravityPollTimer);
  }

  // 3. LEGACY ZOMBIE KILLER: Neutralize the legacy frontend loop
  // Now that our extension uses __autopilotState, we can safely kill __autoAllState
  // to permanently terminate the legacy google.antigravity ghost loops.
  setInterval(() => {
      window.__antigravityHeartbeat = Date.now();
      if (window.__autoAllState) {
          window.__autoAllState.isRunning = false;
          window.__autoAllState.sessionID = -1;
      }
  }, 100);

  // 4. BRIDGE INTERCEPTOR (The Ultimate Ghost Click Defense)
  // The legacy frontend script defines 'sendCommandToBridge' within a closure and attaches permanent DOM listeners.
  // Because it runs concurrently, it WILL intercept valid clicks and send 'workbench.action.terminal.chat.accept'.
  // We cannot kill its closures, but we CAN hijack the global bridge it uses to communicate with the legacy backend.
  if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function' && !window.__ANTIGRAVITY_BRIDGE__isHijacked) {
      const originalBridge = window.__ANTIGRAVITY_BRIDGE__;
      window.__ANTIGRAVITY_BRIDGE__ = function(payload) {
          if (typeof payload === 'string') {
              // Block legacy execution payloads: native VS Code commands, scaled coordinate clicks, and global keyboard dispatches
              if (/^__ANTIGRAVITY_(COMMAND|CLICK|TYPE)__/.test(payload)) {
                  // WARNING: DO NOT LOG THE RAW PAYLOAD TO CONSOLE!
                  // The legacy extension uses Runtime.consoleAPICalled as a fallback bridge 
                  // and parses ALL console arguments for "__ANTIGRAVITY_COMMAND__"!
                  // Logging the payload here literally hands the execution trigger back to the legacy backend!
                  console.warn('[ZOMBIE KILLER] Blocked legacy extension bridge payload: ', payload.replace(/__ANTIGRAVITY_(COMMAND|CLICK|TYPE)__/g, 'BLOCKED'));
                  return; // Silently drop it into the void. The legacy backend will never receive it.
              }
          }
          return originalBridge.apply(this, arguments);
      };
      window.__ANTIGRAVITY_BRIDGE__isHijacked = true;
  }

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
     autoReplyText: 'Proceed',
     controls: {
         acceptAll: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['accept-all-button', 'keep-button', 'allow-all-button', 'dom-click'], delayMs: 100 },
         continue: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['continue-button', 'keep-button', 'dom-click'], delayMs: 100 },
         run: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['dom-click', 'native-click'], delayMs: 100 },
         expand: { detectMethods: ['enabled-flag', 'not-generating', 'action-cooldown'], actionMethods: ['dom-click', 'native-click'], delayMs: 50 },
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
  let pollTimer;

  function getSafetyStats() {
      if (!window.__antigravitySafetyStats || typeof window.__antigravitySafetyStats !== 'object') {
          window.__antigravitySafetyStats = {
              blockedNonChatTargetClicks: 0,
              blockedRunExpandInAgRuntime: 0,
              blockedSubmitKeyDispatches: 0,
              blockedFocusLostKeyDispatches: 0
          };
      }
      return window.__antigravitySafetyStats;
  }

  function bumpSafetyCounter(key) {
      const stats = getSafetyStats();
      stats[key] = (stats[key] || 0) + 1;
  }

  // --- Configuration Helpers ---
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
          if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
              window.__AUTOPILOT_BRIDGE__(payload);
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
          emitBridge('__AUTOPILOT_LOG__:' + msg);
      }
  }

  function emitAction(group, detail) {
      logAction('action=' + group + ' detail=' + detail);
      emitBridge('__AUTOPILOT_ACTION__:' + String(group || 'click') + '|' + String(detail || 'triggered'));
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
            if ((controlName === 'run' || controlName === 'expand') && isAntigravityRuntime()) {
                bumpSafetyCounter('blockedRunExpandInAgRuntime');
                    return false;
            }

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

  const bannedCache = new WeakSet();
    function isNodeBanned(node) {
      if (!node || node.nodeType !== 1) return false;
      if (bannedCache.has(node)) return true;

      const bannedIcons = '.codicon-plus, .codicon-attach, .codicon-paperclip, .codicon-add, [class*="codicon-layout"], .codicon-settings-gear, .codicon-gear';

      // Instantly ban dangerous context nodes
      if (node.matches(bannedIcons)) {
          bannedCache.add(node);
          return true;
      }

      // Check if it HAS dangerous children
      if (node.querySelector && node.querySelector(bannedIcons)) {
          bannedCache.add(node);
          return true;
      }

      // Text / Label checks (Extremely strict)
      const attrs = ((node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '') + ' ' + (node.textContent || '')).toLowerCase();
      if (/(customize layout|layout control|add context|attach context|attach a file|new chat|clear chat|clear session)/i.test(attrs)) {
          bannedCache.add(node);
          return true;
      }

      return false;
  }

  function queryShadowDOMAll(selector, root) {
      root = root || document;
      let results = [];
      if (root.querySelectorAll) {
          const raw = Array.from(root.querySelectorAll(selector));
          for (const node of raw) {
              if (!isNodeBanned(node)) {
                  results.push(node);
              }
          }
      }
      const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (let i = 0; i < all.length; i++) {
          if (all[i].shadowRoot) {
              results = results.concat(queryShadowDOMAll(selector, all[i].shadowRoot));
          }
      }
      return results;
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

  function shadowClosest(el, selector) {
      let current = el;
      while (current) {
          if (current.nodeType === 1 && current.matches(selector)) return current;
          current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }
      return null;
  }

  function isUnsafeContext(el) {
    if (!el) return false;

    // 1. Check the element itself for unsafe text
    try {
        const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
        if (/(extension|marketplace|plugin|install|uninstall|customize layout|layout control|add context|attach context|attach a file|new chat|clear chat|clear session|view as|open in)/i.test(text)) {
            return true;
        }
    } catch(e) {}

    // 2. Descendant check for banned icons
    try {
        const bannedIcons = '[class*="codicon-settings-gear"], [class*="codicon-gear"], [class*="codicon-attach"], [class*="codicon-paperclip"], [class*="codicon-link"], [class*="codicon-layout"], [class*="codicon-clear-all"], [class*="codicon-trash"], [class*="codicon-add"], [class*="codicon-plus"], [class*="codicon-more"], [class*="codicon-history"]';
        if (el.matches(bannedIcons) || el.querySelector(bannedIcons)) {
            return true;
        }
    } catch(e) {}
    // 3. Walk up the tree and check all ancestors for unsafe attributes and banned classes
    let current = el;
    while (current) {
        if (current.nodeType === 1) { // ELEMENT_NODE
            // Text/Attribute bans on parents
            const attrs = ((current.getAttribute('aria-label') || '') + ' ' + (current.getAttribute('title') || '')).toLowerCase();
            if (/(customize layout|layout control|add context|attach context|new chat|clear chat|clear session)/i.test(attrs)) {
                return true;
            }

            // Workbench Chrome Bans + Menus
            if (current.matches('.quick-input-widget, .monaco-quick-input-container, .suggest-widget, .rename-box, .settings-editor, .extensions-viewlet, [id*="workbench.view.extensions"], .pane-header, .panel-header, .view-pane-header, .title-actions, .tabs-and-actions-container, .part.activitybar, .part.statusbar, .part.titlebar, .panel-switcher-container, .monaco-panel .composite.title, .dialog-container, .notifications-toasts, .monaco-dialog-box, .monaco-menu, .monaco-menu-container, .menubar, .menubar-menu-button, [role="menu"], [role="menuitem"], [role="menubar"]')) {
                return true;
            }
            if (current.getAttribute('role') === 'tab' || current.getAttribute('role') === 'tablist') {
                return true;
            }
            
            // Icon Class Bans
            if (current.matches('.codicon-settings-gear, .codicon-attach, [class*="codicon-layout"], .codicon-clear-all, .codicon-trash, .codicon-add, .codicon-plus, .codicon-more, .codicon-history')) {
                return true;
            }
        }
        current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }

    // 3. Global Workbench safety lock (Prevent clicking native IDE elements)
    if (window === window.top) {
        if (shadowClosest(el, '.monaco-workbench') && !shadowClosest(el, 'iframe, webview, .webview, #webview')) {
            return true;
        }
    }

    return false;
  }

  function hasUnsafeLabel(el) {
      return false; // Deprecated - replaced by isUnsafeContext's deep check
  }

  function isChatActionSurface(el) {
      if (!el) return false;

      const blockedShell = '.title-actions, .tabs-and-actions-container, .part.titlebar, .part.activitybar, .part.statusbar, .menubar, .menubar-menu-button, .monaco-menu, .monaco-menu-container, [role="menu"], [role="menuitem"], [role="menubar"]';
      const chatContainers = '.interactive-input-part, .chat-input-widget, .chat-row, .chat-list, [data-testid*="chat" i], [class*="chat" i], [class*="interactive" i], .monaco-list-row';

      let hasBlockedAncestor = false;
      let current = el;
      while (current) {
          if (current.nodeType === 1) {
              try {
                  if (current.matches(blockedShell)) {
                      hasBlockedAncestor = true;
                      break;
                  }
              } catch (e) {}
          }
          current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }

      if (hasBlockedAncestor) return false;

      current = el;
      while (current) {
          if (current.nodeType === 1) {
              try {
                  if (current.matches(chatContainers)) return true;
              } catch (e) {}
          }
          current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
      }

      return false;
  }

  function isAntigravityRuntime() {
      try {
          return !!(
              document.querySelector('#antigravity\\.agentPanel') ||
              document.querySelector('[id*="antigravity" i], [class*="antigravity" i]') ||
              /antigravity/i.test(String(navigator.userAgent || ''))
          );
      } catch (e) {
          return false;
      }
  }

  // --- Analysis Helpers ---

  function analyzeChatState() {
      // 1. Check if generating
      const stopBtn = queryShadowDOMAll('[title*="Stop" i], [aria-label*="Stop" i]')[0];
      const isGenerating = !!stopBtn;
      const input = queryShadowDOMAll('vscode-text-area, [id*="chat-input" i], [aria-label*="Chat Input" i], .interactive-input-part textarea, .chat-input-widget textarea')[0];
      const hasInputReady = !!input && (input.offsetParent || input.clientWidth > 0 || input.clientHeight > 0);

      // 2. Find last message
      // Selectors depend on VS Code version, but usually .monaco-list-row or .chat-row
      const rows = queryShadowDOMAll('.monaco-list-row, .chat-row, [role="listitem"]');
      const lastRow = rows[rows.length - 1];
      
      let lastSender = 'unknown';
      let lastText = '';

      if (lastRow) {
          lastText = lastRow.innerText || '';
          // Heuristic for sender:
          // User messages often have specific avatars or class names
          const html = lastRow.innerHTML.toLowerCase();
          const cx = lastRow.className.toLowerCase();
          if (html.includes('codicon-account') || html.includes('user-avatar') || cx.includes('user')) {
              lastSender = 'user';
          } else if (html.includes('codicon-copilot') || html.includes('ai-avatar') || html.includes('antigravity') || cx.includes('assistant')) {
              lastSender = 'ai';
          } else {
              // Text based fallback
              if (lastText.startsWith('You:')) lastSender = 'user';
              if (lastText.startsWith('Copilot:') || lastText.startsWith('Antigravity:')) lastSender = 'ai';
          }
      }

      // Text checks for signals
      const allBtns = queryShadowDOMAll('button, a, [role="button"], .monaco-button');
      let extExpand = 0, extAcceptAll = 0, extAccept = 0, extRun = 0, extFeedback = 0;
      for (const b of allBtns) {
          if (isUnsafeContext(b) || hasUnsafeLabel(b)) continue;
          if (b.hasAttribute('disabled') || b.classList.contains('disabled')) continue;
          if (!(b.offsetParent || b.clientWidth > 0 || b.clientHeight > 0)) continue;
          
          const t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const attr = (b.getAttribute('title') || b.getAttribute('aria-label') || '').toLowerCase();
          
          if (t.includes('expand') || t.includes('requires input') || (t.includes('step') && t.includes('input'))) {
              if (!t.includes('explorer') && !attr.includes('explorer')) extExpand++;
          }
          if (t.includes('accept all')) extAcceptAll++;
          if (t === 'accept' || t === 'apply') extAccept++;
          if (t === 'run' || (t.includes('run') && t.includes('terminal'))) extRun++;
          if (t === 'good' || t === 'bad' || t === 'helpful' || t === 'unhelpful') extFeedback++;
      }

      const rowCount = rows.length;
      const buttonSignals = {
          acceptAll: extAcceptAll + queryShadowDOMAll('[title*="Accept All" i], [aria-label*="Accept All" i], button:has(.codicon-check-all)').length,
          keep: queryShadowDOMAll('[title="Keep" i], [aria-label="Keep" i], button[title*="Keep" i], button[aria-label*="Keep" i]').length,
          allow: queryShadowDOMAll('[title*="Allow" i], [aria-label*="Allow" i], button[title*="Allow" i], button[aria-label*="Allow" i]').length,
          run: extRun + queryShadowDOMAll('[title*="Run in Terminal" i], [aria-label*="Run in Terminal" i], [title*="Run command" i], [aria-label*="Run command" i], [title*="Execute command" i], [aria-label*="Execute command" i]').length,
          expand: extExpand + queryShadowDOMAll('[title*="Expand" i], [aria-label*="Expand" i], .monaco-tl-twistie.collapsed, .expand-indicator.collapsed').length,
          continue: queryShadowDOMAll('a.monaco-button, button.monaco-button, [role="button"]').length,
          submit: queryShadowDOMAll('[title="Send" i], [aria-label="Send" i], [title*="Submit" i], [aria-label*="Submit" i], button[type="submit"], .codicon-send').length,
          feedback: extFeedback + queryShadowDOMAll('.codicon-thumbsup, .codicon-thumbsdown, [title*="Helpful" i], [aria-label*="Helpful" i], [title*="Good" i], [title*="Bad" i], .feedback-button').length
      };

      const feedbackVisible = buttonSignals.feedback > 0;

      return { isGenerating, lastSender, lastText, rowCount, hasInputReady, feedbackVisible, buttonSignals, safetyStats: getSafetyStats() };
  }

  // --- Actions ---

    function tryClick(selector, name, group) {
      const els = queryShadowDOMAll(selector);
      for (const el of els) {
          if (isUnsafeContext(el) || hasUnsafeLabel(el)) continue;
          if (el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0) {
             const targetToClick = el.closest('button, a') || el;
             if (targetToClick.hasAttribute('disabled') || targetToClick.classList.contains('disabled')) continue;
             if (isUnsafeContext(targetToClick) || isNodeBanned(targetToClick)) continue;
                 if (!isChatActionSurface(targetToClick)) {
                     bumpSafetyCounter('blockedNonChatTargetClicks');
                     logAction('[SafetyGate] Blocked non-chat click target for ' + name);
                     continue;
                 }
             
             highlight(targetToClick);
             targetToClick.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
             targetToClick.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
             targetToClick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
             log('Clicked ' + name);
             emitAction(group || 'click', name);
             return true; 
          }
      }
      return false;
  }

  function dispatchInputEvents(input, text) {
      input.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, text);
      } else {
          input.value = text;
      }
      
      // Some React apps need this exact sequence to register
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function getSafeChatInput() {
      const selectors = [
          '[id*="chat-input" i]',
          '[aria-label*="Chat Input" i]',
          '.interactive-input-part textarea',
          '.chat-input-widget textarea',
          'textarea[placeholder*="Ask" i]',
          'textarea[placeholder*="Message" i]',
          'vscode-text-area',
          '[contenteditable="true"]'
      ].join(',');

      const candidates = queryShadowDOMAll(selectors);
      for (const el of candidates) {
          if (!el) continue;
          if (isUnsafeContext(el) || hasUnsafeLabel(el) || isNodeBanned(el)) continue;
          if (!(el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0)) continue;

          const tag = (el.tagName || '').toUpperCase();
          if (tag === 'TEXTAREA' || tag === 'VSCODE-TEXT-AREA' || el.isContentEditable || el.hasAttribute('contenteditable')) {
              return el;
          }

          const inner = el.querySelector && el.querySelector('textarea, [contenteditable="true"]');
          if (inner && !isUnsafeContext(inner) && !isNodeBanned(inner) && (inner.offsetParent || inner.clientWidth > 0 || inner.clientHeight > 0)) {
              return inner;
          }
      }

      return null;
  }

  function typeAndSubmit(text) {
      const cfg = getConfig();
      const bump = getBumpConfig(cfg);
    const rawInputs = queryShadowDOMAll('[id*="chat-input" i], [aria-label*="Chat Input" i], .interactive-input-part, .chat-input-widget, textarea[placeholder*="Ask" i], textarea[placeholder*="Message" i], vscode-text-area');
      
      let input = null;
      for (const el of rawInputs) {
          if (isUnsafeContext(el) || hasUnsafeLabel(el) || isNodeBanned(el)) continue;
          if (!(el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0)) continue;
          if (el.tagName === 'TEXTAREA' || el.tagName === 'VSCODE-TEXT-AREA' || el.isContentEditable || el.hasAttribute('contenteditable')) {
              input = el;
              break;
          }
          const inner = el.querySelector('textarea, [contenteditable]');
          if (inner && !isUnsafeContext(inner) && !isNodeBanned(inner) && (inner.offsetParent || inner.clientWidth > 0 || inner.clientHeight > 0)) {
              input = inner;
              break;
          }
      }
      
      // Fallback: just find the first visible textarea on the screen if we couldn't find a widget
      if (!input) {
          const fallbackInputs = queryShadowDOMAll('textarea, vscode-text-area');
          input = fallbackInputs.find(el => !isUnsafeContext(el) && !isNodeBanned(el) && (el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0));
      }
      
      if (!input) return false;

      // 1. Check if ANY text exists
      let hasText = false;
      if (input.value !== undefined && input.value !== null) {
          hasText = input.value.trim().length > 0;
      }
      if (!hasText) {
          const tc = (input.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
          if (tc.length > 0) hasText = true;
      }
      if (!hasText) {
          const container = input.closest('.monaco-editor, .prosemirror, .chat-input-widget, .interactive-input-part, form') || input.parentElement;
          if (container) {
              const tc = (container.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
              if (tc.length > 0) hasText = true;
          }
      }

      if (hasText) {
           log('Skipping typeAndSubmit because text already detected in input container.');
      } else {
          input.focus();

          let typed = false;
          if (hasMethod(bump.typeMethods, 'exec-command')) {
              try { typed = !!document.execCommand('insertText', false, text); } catch(e) {}
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

          if (!typed && hasMethod(bump.typeMethods, 'dispatch-events')) {
              input.value = input.value || text;
              typed = true;
          }

          if (!typed) {
              input.value = text;
          }

          // Force sync React state
          input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));

          log('Auto-Replied (Typed): ' + text);
          emitAction('type', 'typed bump text');
      }

      const submitDelay = Math.max(150, bump.submitDelayMs || 150);
      setTimeout(() => {
          const sendSelectors = '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], button[type="submit"], .codicon-send, .send-button';
          let submitted = false;
          const form = input.closest('form');

          if (hasMethod(bump.submitMethods, 'click-send')) {
              submitted = tryClick(sendSelectors, 'Submit (Auto-Reply)', 'submit');
          }

          const dispatchEnters = () => {
              if (document.activeElement !== input) {
                  try { input.focus(); } catch(e) {}
              }
              
              // NUCLEAR OPTION: If active element STILL isn't our target textarea, ATB (Abort The Board)
              // Never blindly fire KeyboardEvents if focus is captured by '.monaco-workbench'
              const activeEl = window.document.activeElement;
              const isShadowMatch = activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement === input;
              if (activeEl !== input && !isShadowMatch) {
                  bumpSafetyCounter('blockedFocusLostKeyDispatches');
                  logAction('[SubmitGuard] ABORT: Focus lost to <' + (activeEl?.tagName || 'unknown') + '>. Suppressing rogue Enter key dispatch.');
                  return;
              }

              const combos = [
                  { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
                  { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
                  { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }
              ];
              for (const c of combos) {
                  // Re-verify focus every loop iteration
                  const currentActive = window.document.activeElement;
                  const currentIsShadowMatch = currentActive && currentActive.shadowRoot && currentActive.shadowRoot.activeElement === input;
                  if (currentActive !== input && !currentIsShadowMatch) break;
                  
                  try {
                      const opts = { bubbles: true, cancelable: true, composed: true, ...c };
                      input.dispatchEvent(new KeyboardEvent('keydown', opts));
                      input.dispatchEvent(new KeyboardEvent('keypress', opts));
                      input.dispatchEvent(new KeyboardEvent('keyup', opts));
                  } catch (e) { }
              }
          };

          if (!submitted && hasMethod(bump.submitMethods, 'enter-key')) {
              if (isAntigravityRuntime()) {
                  bumpSafetyCounter('blockedSubmitKeyDispatches');
                  logAction('[SubmitGuard] AG runtime: typeAndSubmit enter-key fallback disabled for safety.');
              } else if (form && typeof form.requestSubmit === 'function') {
                   try { form.requestSubmit(); submitted = true; emitAction('submit', 'form.requestSubmit'); } catch(e) {}
              }
              if (!submitted) {
                  dispatchEnters();
                  emitAction('submit', 'keys');
                  submitted = true;
              }
          }

          if (!submitted) {
              if (form && typeof form.requestSubmit === 'function') {
                   try { form.requestSubmit(); submitted = true; emitAction('submit', 'form.requestSubmit-fallback'); } catch(e) {}
              }
              if (!submitted && !tryClick(sendSelectors, 'Submit (Auto-Reply fallback)', 'submit')) {
                  if (isAntigravityRuntime()) {
                      bumpSafetyCounter('blockedSubmitKeyDispatches');
                      logAction('[SubmitGuard] AG runtime: suppressed keys-fallback dispatch in typeAndSubmit.');
                      return;
                  }
                  dispatchEnters();
                  emitAction('submit', 'keys-fallback');
              }
          }
          
          setTimeout(() => {
              if (input.value === text) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); } 
              else if (input.isContentEditable && input.textContent === text) { input.textContent = ''; }
          }, 300);

      }, submitDelay);
      return true;
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
    // 3. SUICIDE PILL: If we are not the active instance, immediately terminate the recursion.
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) {
        return;
    }

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
          const containers = queryShadowDOMAll('.monaco-list-rows, .chat-list, [role="log"]');
          for (const c of containers) {
             if (c.scrollTop + c.clientHeight >= c.scrollHeight - 150) {
                 c.scrollTop = c.scrollHeight;
             }
          }
      }

      // 1. Continue / Keep (Priority)
    if (controlGatePass('continue', cfg, state, now, lastActionByControl.continue)) {
          const continueControl = getControlConfig(cfg, 'continue');
          const contSel = 'a.monaco-button, button.monaco-button, [role="button"]';
          const els = queryShadowDOMAll(contSel);
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
          
        if (target && (target.offsetParent || target.clientWidth > 0) && isChatActionSurface(target)) {
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
              '[title*="Run command"]',
              '[aria-label*="Run command"]',
              '[title*="Execute command"]',
              '[aria-label*="Execute command"]'
          ].join(',');

          if (hasMethod(runControl.actionMethods, 'dom-click')) {
              const buttons = queryShadowDOMAll('button, [role="button"], .clickable');
              const textMatch = buttons.find(el => {
                  if (isUnsafeContext(el) || hasUnsafeLabel(el)) return false;
                  if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return false;
                  if (!(el.offsetParent || el.clientWidth > 0)) return false;
                  const text = (el.textContent || '').trim().toLowerCase();
                  const label = (el.getAttribute('title') || el.getAttribute('aria-label') || '').toLowerCase();
                  return text === 'run in terminal'
                      || label.includes('run in terminal')
                      || label.includes('run command')
                      || label.includes('execute command');
              });
              if (textMatch && isChatActionSurface(textMatch)) {
                  highlight(textMatch);
                  textMatch.click();
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Clicked Run (Text Match)');
                  emitAction('run', 'text-match run');
              }
          }

          if (!actionTaken && hasMethod(runControl.actionMethods, 'dom-click')) {
              const runCandidates = queryShadowDOMAll(runSelectors);
              const runTarget = runCandidates.find(el => {
                  if (!el) return false;
                  if (isUnsafeContext(el) || hasUnsafeLabel(el) || isNodeBanned(el)) return false;
                  if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return false;
                  if (!(el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0)) return false;
                  return isChatActionSurface(el);
              });

              if (runTarget) {
                  highlight(runTarget);
                  runTarget.click();
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Clicked Run (Scoped Selector Match)');
                  emitAction('run', 'scoped selector run');
              }
          }

          if (!actionTaken && hasMethod(runControl.actionMethods, 'native-click')) {
              const candidate = Array.from(document.querySelectorAll(runSelectors)).find(el => el && !isUnsafeContext(el) && !hasUnsafeLabel(el) && (el.offsetParent || el.clientWidth > 0));
              if (candidate && isChatActionSurface(candidate)) {
                  highlight(candidate);
                  candidate.click();
                  actionTaken = true;
                  lastActionByControl.run = now;
                  log('Clicked Run (native-click)');
                  emitAction('run', 'native-click run');
              }
          }

          // (alt-enter fallback removed: simulated Alt events trigger Windows Native Menu bar focusing)
      }

      // 3. Auto-Accept
    if (!actionTaken && controlGatePass('accept', cfg, state, now, lastActionByControl.accept)) {
          const acceptControl = getControlConfig(cfg, 'accept');

          if (!actionTaken && hasMethod(acceptControl.actionMethods, 'accept-single')) {
              // Strict matches only to avoid Layout Apply buttons
              if (tryClick('[title="Accept"], [aria-label="Accept"], .codicon-check', 'Accept', 'accept')) {
                  actionTaken = true;
                  lastActionByControl.accept = now;
              }
      }

      // 4. Auto-Expand
    if (!actionTaken && controlGatePass('expand', cfg, state, now, lastActionByControl.expand)) {
          const expandControl = getControlConfig(cfg, 'expand');
          const expandSelectors = [
              '[title*="Expand"]',
              '[aria-label*="Expand"]'
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
              if (textMatch && isChatActionSurface(textMatch)) {
                  highlight(textMatch);
                  textMatch.click();
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Clicked Expand (Text Match)');
                  emitAction('expand', 'text-match expand');
              }
          }

          if (!actionTaken && hasMethod(expandControl.actionMethods, 'dom-click')) {
              const expandCandidates = queryShadowDOMAll(expandSelectors);
              const expandTarget = expandCandidates.find(el => {
                  if (!el) return false;
                  if (isUnsafeContext(el) || hasUnsafeLabel(el) || isNodeBanned(el)) return false;
                  if (el.hasAttribute('disabled') || el.classList.contains('disabled')) return false;
                  if (!(el.offsetParent || el.clientWidth > 0 || el.clientHeight > 0)) return false;
                  return isChatActionSurface(el);
              });

              if (expandTarget) {
                  highlight(expandTarget);
                  expandTarget.click();
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Clicked Expand (Scoped Selector Match)');
                  emitAction('expand', 'scoped selector expand');
              }
          }

          if (!actionTaken && hasMethod(expandControl.actionMethods, 'native-click')) {
              const candidate = Array.from(document.querySelectorAll(expandSelectors)).find(el => el && !isUnsafeContext(el) && !hasUnsafeLabel(el) && (el.offsetParent || el.clientWidth > 0));
              if (candidate && isChatActionSurface(candidate)) {
                  highlight(candidate);
                  candidate.click();
                  actionTaken = true;
                  lastActionByControl.expand = now;
                  log('Clicked Expand (native-click)');
                  emitAction('expand', 'native-click expand');
              }
          }

          // (alt-enter fallback removed: simulated Alt events trigger Windows Native Menu bar focusing)
      }
      
      // 5. Auto-Submit
    if (!actionTaken && controlGatePass('submit', cfg, state, now, lastActionByControl.submit)) {
          const submitControl = getControlConfig(cfg, 'submit');
          const submitDelay = Math.max(0, submitControl.delayMs || 0);
          const sendSelectors = '[title*="Send"], [aria-label*="Send"], [title*="Submit"], [aria-label*="Submit"], button[type="submit"], .codicon-send';

          if (hasMethod(submitControl.actionMethods, 'click-send') && tryClick(sendSelectors, 'Submit', 'submit')) {
              actionTaken = true;
              lastActionByControl.submit = now;
          }

          if (!actionTaken && hasMethod(submitControl.actionMethods, 'enter-key')) {
              if (isAntigravityRuntime()) {
                  bumpSafetyCounter('blockedSubmitKeyDispatches');
                  logAction('[SubmitGuard] AG runtime: enter-key submit fallback disabled for safety.');
              } else {
                  const input = getSafeChatInput();
                  if (input) {
                      setTimeout(() => {
                          const textValue = (input.value !== undefined && input.value !== null)
                              ? String(input.value || '').trim()
                              : String(input.textContent || '').trim();
                          if (!textValue) {
                              logAction('[SubmitGuard] ABORT: Composer is empty. Suppressing submit key dispatch.');
                              return;
                          }

                          if (document.activeElement !== input) {
                              try { input.focus(); } catch (e) {}
                          }
                          
                          const activeEl = window.document.activeElement;
                          const isShadowMatch = activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement === input;
                          if (activeEl !== input && !isShadowMatch) {
                              bumpSafetyCounter('blockedFocusLostKeyDispatches');
                              logAction('[SubmitGuard] ABORT: Focus lost to <' + (activeEl?.tagName || 'unknown') + '>. Suppressing rogue Enter key dispatch.');
                              return;
                          }

                          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                          input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                      }, submitDelay);
                      actionTaken = true;
                      lastActionByControl.submit = now;
                      log('Submitted via Enter key');
                      emitAction('submit', 'submit enter-key');
                  }
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
        const target = els.find(el => !isUnsafeContext(el) && !hasUnsafeLabel(el) && !el.classList.contains('checked') && !el.classList.contains('selected') && (el.offsetParent || el.clientWidth>0) && isChatActionSurface(el));
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
              let bumpText = bump.text || 'bump';

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
                  } else if (state.feedbackVisible || hasMethod(detectMethods, 'feedback-visible')) {
                      shouldBump = true;
                      computedDelay = Math.max(250, bump.retryDelayMs || 2000);
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
                  // Only bump if the tab is visible to avoid ghost typing in every open tab (unless configured otherwise)
                  if (!bump.requireVisible || document.visibilityState === 'visible') {
                      if (typeAndSubmit(bumpText)) {
                           actionTaken = true;
                           lastActionByControl.bump = now;
                           log('Smart Resume: Bumped with "' + bumpText + '" (Delay: ' + computedDelay + 'ms)');
                           emitAction('bump', 'smart resume bump text=' + bumpText);
                      }
                  } else {
                      // Skip bump because tab is invisible and requireVisible is true. Check again later.
                      lastAction = now;
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
      if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
      // 4. SUICIDE PILL: Do not schedule next if a newer script has taken over
      if (window.__antigravityActiveInstance !== THIS_INSTANCE) {
          return;
      }

      const cfg = getConfig();
      const interval = cfg.timing?.pollIntervalMs ?? 800;
      window.__antigravityPollTimer = setTimeout(() => {
          runLoop();
          scheduleNext();
      }, interval);
      pollTimer = window.__antigravityPollTimer; // Keep local ref just in case
  }

  scheduleNext();
  
  // Expose state for CDP
  window.__antigravityGetState = analyzeChatState;

  window.stopAutoContinue = () => {
    if (pollTimer) clearTimeout(pollTimer);
    if (window.__antigravityPollTimer) clearTimeout(window.__antigravityPollTimer);
    window.__antigravityAutoContinueRunning = false;
    log('stopped.');
  };
})();
`;
