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
  var lastProgressAt = Date.now();
  var pollTimer = null;

  function emitBridge(payload) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(payload);
      else console.log(payload);
    } catch (e) {}
  }

  function log(msg) {
    emitBridge('__AUTOPILOT_LOG__:' + String(msg || ''));
  }

  function emitAction(group, detail) {
    emitBridge('__AUTOPILOT_ACTION__:' + String(group || 'click') + '|' + String(detail || ''));
  }

  function getConfig() {
    var c = window.__antigravityConfig || {};
    return {
      bump: {
        enabled: c.bump ? c.bump.enabled !== false : true,
        text: c.bump ? (c.bump.text || 'Proceed') : 'Proceed'
      },
      timing: {
        pollIntervalMs: Math.max(150, Number(c.timing?.pollIntervalMs || 800)),
        actionThrottleMs: Math.max(100, Number(c.timing?.actionThrottleMs || 250)),
        stalledMs: Math.max(1000, Number(c.timing?.stalledMs || 7000)),
        bumpCooldownMs: Math.max(1000, Number(c.timing?.bumpCooldownMs || 30000))
      }
    };
  }

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
        if (!seen.has(list[i])) {
          seen.add(list[i]);
          out.push(list[i]);
        }
      }

      var all = [];
      try { all = node.querySelectorAll('*'); } catch (e) {}
      for (var j = 0; j < all.length; j++) {
        try {
          if (all[j] && all[j].shadowRoot) visit(all[j].shadowRoot);
        } catch (e) {}
      }
    }

    visit(root || document);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    var rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    var style = window.getComputedStyle(el);
    return !(style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none');
  }

  function normalizeText(el) {
    var text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    var aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    var title = String(el.getAttribute('title') || '').toLowerCase();
    return [text, aria, title].join(' | ');
  }

  function isBlockedSurface(el) {
    if (!el || !el.closest) return false;

    var blocked = '.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet';
    var terminal = '.terminal-instance, .terminal-wrapper, .xterm, [class*="terminal" i]';

    try {
      if (el.closest(blocked) || el.closest(terminal)) return true;

      if (el.tagName && el.tagName.toLowerCase() === 'textarea') {
        if (el.closest('.part.editor') && !el.closest('[class*="chat" i], [class*="composer" i], .interactive-input-part, .chat-input-widget')) {
          return true;
        }
      }
    } catch (e) {
      return false;
    }

    return false;
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
    } catch (e) {
      return false;
    }
  }

  var ACTION_SPECS = [
    { label: 'Run', regex: /(^|\b)(run(\s+in\s+terminal|\s+command)?|execute)(\b|$)/i },
    { label: 'Expand', regex: /(\bexpand\b|requires\s*input|step\s*requires\s*input)/i },
    { label: 'Always Allow', regex: /(always\s*allow|always\s*approve)/i },
    { label: 'Retry', regex: /(\bretry\b|\btry\s+again\b)/i },
    { label: 'Accept all', regex: /(accept\s*all|apply\s*all|accept\s*all\s*changes|apply\s*all\s*changes)/i },
    { label: 'Keep', regex: /\bkeep\b/i },
    { label: 'Proceed', regex: /\bproceed\b/i },
    { label: 'Allow', regex: /(^|\b)allow(\b|$)/i }
  ];

  function detectAndClickButtons() {
    var nodes = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]');

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i].closest ? (nodes[i].closest('button, a, [role="button"], .monaco-button') || nodes[i]) : nodes[i];
      if (!isVisible(el) || isBlockedSurface(el)) continue;
      if (el.closest && el.closest('.terminal-instance, .xterm, [class*="terminal"]')) continue;

      var txt = normalizeText(el);
      for (var j = 0; j < ACTION_SPECS.length; j++) {
        var spec = ACTION_SPECS[j];
        if (spec.regex.test(txt)) {
          if (click(el, spec.label, 'click')) return true;
        }
      }
    }

    return false;
  }

  function detectGenerating() {
    var loaders = queryAllDeep('.codicon-loading, .typing-indicator, [title*="Stop" i], [aria-label*="Stop" i]');
    for (var i = 0; i < loaders.length; i++) {
      var el = loaders[i].closest ? (loaders[i].closest('button, [role="button"]') || loaders[i]) : loaders[i];
      if (isVisible(el) && !isBlockedSurface(el)) return true;
    }
    return false;
  }

  function detectWaitingSignal() {
    var fastNodes = queryAllDeep('.codicon-thumbsup, .codicon-thumbsdown, [class*="thumbsup" i], [class*="thumbsdown" i]');
    for (var i = 0; i < fastNodes.length; i++) {
      var el = fastNodes[i].closest ? (fastNodes[i].closest('button, [role="button"]') || fastNodes[i]) : fastNodes[i];
      if (isVisible(el) && !isBlockedSurface(el)) return true;
    }

    var textNodes = queryAllDeep('.chat-body, .message-body, .chat-message, [data-testid*="message" i], .monaco-list-row, p, span.message');
    var completionPattern = /(all tasks completed|task completed|tasks completed|completed|done|finished|need anything else|anything else\?|waiting for input|requires input|thumbs up|thumbs down)/i;

    for (var j = 0; j < textNodes.length; j++) {
      var node = textNodes[j];
      if (!isVisible(node)) continue;
      var txt = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 400 && completionPattern.test(txt)) return true;
    }

    return false;
  }

  function detectStalledConversation(cfg, generating) {
    var now = Date.now();
    if (generating) {
      lastProgressAt = now;
      return false;
    }
    return (now - lastProgressAt) >= cfg.timing.stalledMs;
  }

  function findChatInput() {
    var inputs = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');

    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!isVisible(el) || isBlockedSurface(el)) continue;

      var tag = String(el.tagName || '').toLowerCase();
      var editable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      if (!editable) continue;

      var sig = normalizeText(el) + ' ' + String(el.className || '') + ' ' + String(el.id || '');
      if (/(chat|message|ask|prompt|composer|copilot|assistant)/i.test(sig)) return el;

      if (el.closest && el.closest('[class*="chat" i], [class*="composer" i], .interactive-input-part, .chat-input-widget')) {
        return el;
      }
    }

    return null;
  }

  function typeBumpText(input, bumpText) {
    try {
      if (typeof input.focus === 'function') input.focus();

      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try { document.execCommand('selectAll', false, null); } catch (e) {}
        try { document.execCommand('insertText', false, bumpText); } catch (e) { input.textContent = bumpText; }
      } else {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set && String(input.tagName || '').toLowerCase() === 'textarea') setter.set.call(input, bumpText);
        else input.value = bumpText;

        try { input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: bumpText })); } catch (e) {}
        try { input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch (e) {}
      }

      try { input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch (e) {}
      log('typed bump text: ' + bumpText);
      return true;
    } catch (e) {
      log('failed to type bump text');
      return false;
    }
  }

  function submitBumpText(input, bumpText) {
    var container = (input.closest && input.closest('form, .interactive-input-part, [class*="chat-input" i]')) || document;
    var buttons = queryAllDeep('[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], .codicon-send, button[type="submit"]', container);

    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i].closest ? (buttons[i].closest('button, [role="button"], a') || buttons[i]) : buttons[i];
      if (isVisible(btn) && click(btn, 'Submit', 'submit')) {
        return true;
      }
    }

    try {
      if (typeof input.focus === 'function') input.focus();

      var combos = [
        { altKey: true },
        { ctrlKey: true },
        { metaKey: true },
        {}
      ];

      for (var j = 0; j < combos.length; j++) {
        var mods = combos[j];
        var args = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        for (var k in mods) args[k] = mods[k];
        input.dispatchEvent(new KeyboardEvent('keydown', args));
        input.dispatchEvent(new KeyboardEvent('keyup', args));
      }

      log('submitted bump text via keyboard fallbacks (Alt/Ctrl/Meta/Enter)');
    } catch (e) {}

    emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + bumpText);
    return true;
  }

  function updateRuntimeState(fork, generating, stalled, waiting) {
    window.__antigravityRuntimeState = {
      fork: fork,
      mode: fork,
      status: generating ? 'processing' : (waiting ? 'waiting_for_chat_message' : (stalled ? 'idle' : 'processing')),
      waitingForChatMessage: waiting,
      hasInput: true,
      isGenerating: generating,
      stalled: stalled,
      completeStopSignal: waiting,
      timestamp: Date.now()
    };
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;

    window.__antigravityHeartbeat = Date.now();

    var now = Date.now();
    var cfg = getConfig();
    var fork = detectFork();
    var generating = detectGenerating();
    var stalled = detectStalledConversation(cfg, generating);
    var waitingSignal = detectWaitingSignal();
    var waiting = waitingSignal || stalled;

    updateRuntimeState(fork, generating, stalled, waiting);

    if ((now - lastActionAt) >= cfg.timing.actionThrottleMs) {
      if (detectAndClickButtons()) {
        lastActionAt = now;
        lastProgressAt = now;
        return;
      }
    }

    if (!waiting || generating) return;
    if (!cfg.bump.enabled || !cfg.bump.text) return;
    if ((now - lastBumpAt) < cfg.timing.bumpCooldownMs) return;

    var input = findChatInput();
    if (!input) return;

    typeBumpText(input, cfg.bump.text);
    submitBumpText(input, cfg.bump.text);

    lastBumpAt = now;
    lastActionAt = now;
    lastProgressAt = now;
  }

  function schedule() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;

    var pollMs = getConfig().timing.pollIntervalMs;
    pollTimer = setTimeout(function () {
      try { runLoop(); } catch (e) { log('loop error: ' + String(e.message || e)); }
      schedule();
    }, pollMs);
  }

  window.__antigravityGetState = function () {
    return window.__antigravityRuntimeState || null;
  };

  window.stopAutoContinue = function () {
    if (pollTimer) clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('Autopilot Engine started (minimal core)');
  try { runLoop(); } catch (e) { log('init loop error: ' + String(e.message || e)); }
  schedule();
})();
`;
