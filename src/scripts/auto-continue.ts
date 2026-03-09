export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  var INSTANCE = Math.random().toString(36).slice(2);
  window.__antigravityActiveInstance = INSTANCE;
  window.__antigravityAutoContinueRunning = true;
  window.__antigravityHeartbeat = Date.now();

  var lastActionAt = 0;
  var lastBumpAt = 0;
  var submitInFlightUntil = 0;
  var lastProgressAt = Date.now();
  var wasGenerating = false;
  var didInitialProbe = false;
  var pollTimer = null;

  function getConfig() {
    var c = window.__antigravityConfig || {};
    return {
      bump: { enabled: c.bump ? c.bump.enabled : true, text: c.bump ? (c.bump.text || 'Proceed') : 'Proceed' },
      actions: c.actions || { clickRun: false, clickExpand: true, clickAlwaysAllow: true, clickRetry: true, clickAcceptAll: true, clickKeep: true, clickProceed: true, clickAllow: true }
    };
  }

  function emitBridge(payload) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(payload);
      else console.log(payload);
    } catch (e) {}
  }
  function log(msg) { emitBridge('__AUTOPILOT_LOG__:' + String(msg || '')); }
  function emitAction(group, detail) { emitBridge('__AUTOPILOT_ACTION__:' + String(group || 'click') + '|' + String(detail || '')); }

  function detectFork() {
    var title = String(document.title || '').toLowerCase();
    var href = String(location.href || '').toLowerCase();
    if (title.indexOf('antigravity') >= 0 || href.indexOf('antigravity') >= 0) return 'antigravity';
    if (title.indexOf('cursor') >= 0 || href.indexOf('cursor') >= 0) return 'cursor';
    return 'vscode';
  }

  function queryAllDeep(selector, root) {
    var out = [];
    var seen = new Set();
    function visit(node) {
      if (!node || !node.querySelectorAll) return;
      var list = [];
      try { list = node.querySelectorAll(selector); } catch (e) {}
      for (var i = 0; i < list.length; i++) {
        if (!seen.has(list[i])) { seen.add(list[i]); out.push(list[i]); }
      }
      var all = [];
      try { all = node.querySelectorAll('*'); } catch (e) {}
      for (var j = 0; j < all.length; j++) {
        try { if (all[j] && all[j].shadowRoot) visit(all[j].shadowRoot); } catch (e) {}
      }
    }
    visit(root || document);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    var s = window.getComputedStyle(el);
    return !(s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none');
  }

  function normalizeText(el) {
    var text = String(el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    var aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    var title = String(el.getAttribute('title') || '').toLowerCase();
    return [text, aria, title].join(' | ');
  }

  function click(el, label, group) {
    if (!el) return false;
    try {
      try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true })); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
      try { if (typeof el.click === 'function') el.click(); } catch (e) {}
      log('clicked ' + label);
      emitAction(group || 'click', String(label || 'clicked').toLowerCase());
      return true;
    } catch (e) { return false; }
  }

  // -------------------------------------------------------------------------------- //
  //  CORE AUTOMATION 																  //
  // -------------------------------------------------------------------------------- //

  var ACTION_SPECS = [
    { key: 'clickRun', label: 'Run', regex: /(^|\b)(run(\s+in\s+terminal|\s+command)?|execute)(\b|$)/i },
    { key: 'clickExpand', label: 'Expand', regex: /(expand|requires\s*input|step\s*requires\s*input)/i },
    { key: 'clickAlwaysAllow', label: 'Always Allow', regex: /(always\s*allow|always\s*approve)/i },
    { key: 'clickRetry', label: 'Retry', regex: /(\bretry\b|\btry\s+again\b)/i },
    { key: 'clickAcceptAll', label: 'Accept all', regex: /(accept\s*all|apply\s*all|accept\s*all\s*changes|apply\s*all\s*changes)/i },
    { key: 'clickKeep', label: 'Keep', regex: /\bkeep\b/i },
    { key: 'clickProceed', label: 'Proceed', regex: /\bproceed\b/i },
    { key: 'clickAllow', label: 'Allow', regex: /^allow$/i } 
  ];

  function isBlockedSurface(el) {
    if (!el || !el.closest) return false;
    var blocked = '.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet';
    var terminal = '.terminal-instance, .terminal-wrapper, .xterm, [class*="terminal" i]';
    try {
        if (el.closest(blocked) || el.closest(terminal)) return true;
        // Strict guard against interacting with main text editors instead of chat
        if (el.tagName && el.tagName.toLowerCase() === 'textarea') {
            if (el.closest('.part.editor') && !el.closest('[class*="chat" i], [class*="composer" i], .interactive-input-part')) {
                return true;
            }
        }
    } catch (e) {
        return false;
    }
    return false;
  }

  function tryClickButtons(cfg, isWaitingForInput) {
    var nodes = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]');
    for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i].closest ? (nodes[i].closest('button, a, [role="button"], .monaco-button') || nodes[i]) : nodes[i];
        if (!isVisible(el) || isBlockedSurface(el)) continue;
        
        // Prevent clicking runaway terminal buttons or irrelevant background toolbars
        if (el.closest && el.closest('.terminal-instance, .xterm, [class*="terminal"]')) continue;

        var txt = normalizeText(el);

        for (var j = 0; j < ACTION_SPECS.length; j++) {
            var spec = ACTION_SPECS[j];
            if (cfg.actions[spec.key] === false) continue; // Skip if disabled in config
          if (spec.key === 'clickRun' && !isWaitingForInput) continue;
            if (spec.regex.test(txt)) {
                if (click(el, spec.label, 'click')) return true;
            }
        }
    }
    return false;
  }

  function isGenerating() {
    var loaders = queryAllDeep('.codicon-loading, .typing-indicator, [title*="Stop" i], [aria-label*="Stop" i]');
    for (var i = 0; i < loaders.length; i++) {
        var el = loaders[i].closest ? (loaders[i].closest('button, [role="button"]') || loaders[i]) : loaders[i];
        if (isVisible(el) && !isBlockedSurface(el)) return true;
    }
    return false;
  }

  function checkStalledAndWaiting(fork) {
    // 1. Fast check for thumbs up / down (Roo Code / Cline)
    var fastNodes = queryAllDeep('.codicon-thumbsup, .codicon-thumbsdown, [class*="thumbsup" i], [class*="thumbsdown" i]');
    for(var i = 0; i < fastNodes.length; i++) {
        var el = fastNodes[i].closest ? (fastNodes[i].closest('button, [role="button"]') || fastNodes[i]) : fastNodes[i];
        if (isVisible(el) && !isBlockedSurface(el)) return true;
    }
    
    // 2. Check for completion phrases strictly in likely message containers (not globally on all elements)
    var textNodes = queryAllDeep('.chat-body, .message-body, .chat-message, [data-testid*="message" i], .monaco-list-row, p, span.message');
    var completionPattern = /(all tasks completed|task completed|tasks completed|completed|done|finished|need anything else|anything else\?|waiting for input|requires input|thumbs up|thumbs down)/i;
    for (var j = 0; j < textNodes.length; j++) {
        var el = textNodes[j];
        if (!isVisible(el)) continue;
        var txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length < 300 && completionPattern.test(txt)) {
            return true;
        }
    }
    return false;
  }

  function findChatInput() {
    var inputs = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');
    for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (!isVisible(el) || isBlockedSurface(el)) continue;
        var tag = String(el.tagName || '').toLowerCase();
        var editable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        if (!editable) continue;
        
        var sig = normalizeText(el) + " " + String(el.className || '') + " " + String(el.id || '');
        // We match basic keywords to ensure it's a chat AI box
        if (/(chat|message|ask|prompt|composer|copilot|assistant)/i.test(sig)) return el;
        
        if (el.closest && el.closest('[class*="chat" i], [class*="composer" i], .interactive-input-part, .chat-input-widget')) {
            return el;
        }
    }
    return null;
  }

  function typeAndSubmitBump(input, bumpText, fork) {
    // Type Text
    try {
        if (typeof input.focus === 'function') input.focus();
        
        if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
            try { document.execCommand('selectAll', false, null); } catch(e){}
            try { document.execCommand('insertText', false, bumpText); } catch(e) { input.textContent = bumpText; }
        } else {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            if (setter && setter.set && String(input.tagName || '').toLowerCase() === 'textarea') {
                setter.set.call(input, bumpText);
            } else {
                input.value = bumpText;
            }
            try { input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: bumpText })); } catch(e){}
            try { input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: bumpText })); } catch(e){}
            try { input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch(e){}
        }
        try { input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch(e){}
        log('typed bump text: ' + bumpText);
    } catch(e) {
        log('failed to type text');
        // Let hybrid bump take over
    }
    
    // Always dispatch a hybrid bump just in case DOM typing was blocked by React
    emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + bumpText);

    // Give it a tiny delay to register the input value before pressing Send in DOM
    setTimeout(function() {
        if (window.__antigravityActiveInstance !== INSTANCE) return;
        
        // Find Send Button closest to input
        var container = (input.closest && input.closest('form, .interactive-input-part, [class*="chat-input" i]')) || document;
        var buttons = queryAllDeep('[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], .codicon-send, button[type="submit"]', container);
        var clickedSend = false;
        
        for (var b = 0; b < buttons.length; b++) {
            var btn = buttons[b].closest ? (buttons[b].closest('button, [role="button"], a') || buttons[b]) : buttons[b];
            if (isVisible(btn)) {
                if (click(btn, 'Submit', 'submit')) {
                    clickedSend = true;
                    break;
                }
            }
        }

        // Fallback to Enter Key
        if (!clickedSend) {
            try {
                var modsList = [{}, { ctrlKey: true }, { metaKey: true }];
                for(var m=0; m<modsList.length; m++) {
                    var margs = modsList[m];
                    margs.key = 'Enter'; margs.code = 'Enter'; margs.keyCode = 13; margs.which = 13; margs.bubbles = true; margs.cancelable = true;
                    input.dispatchEvent(new KeyboardEvent('keydown', margs));
                    input.dispatchEvent(new KeyboardEvent('keyup', margs));
                }
                log('submitted bump text via Enter key');
            } catch(e) {}
        }
    }, 250);

    return true;
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;
    window.__antigravityHeartbeat = Date.now();
    var now = Date.now();
    var cfg = getConfig();
    var fork = detectFork();

    if (!didInitialProbe) {
        didInitialProbe = true;
        log('probe fork=' + fork);
    }

    if ((now - lastActionAt) < 300) return; // Action Throttle

    // 1. Track AI Generation state
    var generating = isGenerating();
    if (generating || wasGenerating) {
        lastProgressAt = now;
    }
    wasGenerating = generating;

    var stalledMs = Math.max(1000, Number(window.__antigravityConfig?.timing?.stalledMs || 7000));
    var stalled = !generating && (now - lastProgressAt) >= stalledMs;
    var isWaiting = checkStalledAndWaiting(fork);
    
    // If we have passed 1.5x the stalled time and we have an input available, bump it as a fallback
    // This handles cases where the LLM stops generating but didn't output specific "completed" text.
    var effectiveWaiting = isWaiting || (!generating && (now - lastProgressAt) >= (stalledMs * 1.5));

    // 2. Attempt action clicks only after intent/state checks.
    //    Run clicks are additionally gated to waiting-for-input state.
    if (tryClickButtons(cfg, effectiveWaiting)) {
      lastActionAt = now;
      lastProgressAt = now;
      return;
    }

    // Update state payload for upstream (used by cdp-strategy.ts)
    window.__antigravityRuntimeState = {
        fork: fork,
        mode: fork,
        status: generating ? 'processing' : (stalled && effectiveWaiting ? 'waiting_for_chat_message' : 'idle'),
        waitingForChatMessage: stalled && effectiveWaiting,
        hasInput: true,
        isGenerating: generating,
        stalled: stalled,
        completeStopSignal: isWaiting,
        timestamp: now
    };

    // 3. Automated Bumping (Only if nothing is generating and we are stuck on "Waiting for input")
    if (!stalled || !effectiveWaiting || generating) return;
    if (!cfg.bump.enabled || !cfg.bump.text) return;

    var bumpCooldownMs = Math.max(1000, Number(window.__antigravityConfig?.timing?.bumpCooldownMs || 30000));
    if ((now - lastBumpAt) < bumpCooldownMs) return; 
    if (now < submitInFlightUntil) return;

    var input = findChatInput();
    if (!input) return;

    if (typeAndSubmitBump(input, cfg.bump.text, fork)) {
        var submitCooldownMs = Math.max(500, Number(window.__antigravityConfig?.timing?.submitCooldownMs || 3000));
        submitInFlightUntil = now + submitCooldownMs;
        lastBumpAt = now;
        lastActionAt = now;
        lastProgressAt = now;
    }
  }

  function schedule() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;
    var pollMs = Math.max(150, Number(window.__antigravityConfig?.timing?.pollIntervalMs || 800));
    pollTimer = setTimeout(function () {
      try { runLoop(); } catch (e) { log('loop error: ' + String(e.message || e)); }
      schedule();
    }, pollMs);
  }

  window.stopAutoContinue = function () {
    if (pollTimer) clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('Autopilot Engine started');
  try { runLoop(); } catch (e) { log('init loop error: ' + String(e.message || e)); }
  schedule();
})();
`;
