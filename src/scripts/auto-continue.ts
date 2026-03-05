export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  var INSTANCE = Math.random().toString(36).slice(2);
  window.__antigravityActiveInstance = INSTANCE;
  window.__antigravityAutoContinueRunning = true;
  window.__antigravityHeartbeat = Date.now();

  var DEFAULTS = {
    runtime: { isLeader: false, role: 'follower', windowFocused: true, enforceLeader: true, mode: 'auto' },
    bump: { enabled: true, text: 'Proceed', submitDelayMs: 120 },
    timing: { pollIntervalMs: 800, actionThrottleMs: 300, stalledMs: 7000, bumpCooldownMs: 30000, submitCooldownMs: 3000 },
    actions: {
      clickRun: true,
      clickExpand: true,
      clickAlwaysAllow: true,
      clickRetry: true,
      clickAcceptAll: true,
      clickKeep: true
    }
  };

  var PROFILES = {
    antigravity: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i], .chat-input-container, .monaco-editor',
      input: 'textarea, .monaco-editor textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i], [placeholder*="message" i], [placeholder*="ask" i], [id*="chat-input" i]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [data-testid*="send" i], [data-testid*="submit" i], [class*="send" i], [class*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    },
    cursor: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i], .chat-input-container, .monaco-editor',
      input: 'textarea, .monaco-editor textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i], [placeholder*="message" i], [placeholder*="ask" i], [id*="chat-input" i]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [data-testid*="send" i], [data-testid*="submit" i], [class*="send" i], [class*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    },
    vscode: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i], .chat-input-container, .monaco-editor',
      input: 'textarea, .monaco-editor textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i], [placeholder*="message" i], [placeholder*="ask" i], [id*="chat-input" i]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [data-testid*="send" i], [data-testid*="submit" i], [class*="send" i], [class*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    }
  };

  var ACTION_SPECS = [
    { key: 'clickRun', label: 'Run', regex: /(^|\\b)(run(\\s+in\\s+terminal|\\s+command)?|execute)(\\b|$)/i },
    { key: 'clickExpand', label: 'Expand', regex: /(expand|requires\\s*input|step\\s*requires\\s*input)/i },
    { key: 'clickAlwaysAllow', label: 'Always Allow', regex: /(always\\s*allow|always\\s*approve)/i },
    { key: 'clickRetry', label: 'Retry', regex: /\\bretry\\b/i },
    { key: 'clickAcceptAll', label: 'Accept all', regex: /(accept\\s*all|apply\\s*all|accept\\s*all\\s*changes|apply\\s*all\\s*changes)/i },
    { key: 'clickKeep', label: 'Keep', regex: /\\bkeep\\b/i }
  ];

  var pollTimer = null;
  var lastActionAt = 0;
  var lastBumpAt = 0;
  var submitInFlightUntil = 0;
  var lastProgressAt = Date.now();
  var lastProgressSignature = '';
  var wasGenerating = false;
  var didInitialProbe = false;
  var lastStopSignalLogAt = 0;

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
    var cfg = window.__antigravityConfig || {};
    return {
      runtime: Object.assign({}, DEFAULTS.runtime, cfg.runtime || {}),
      bump: Object.assign({}, DEFAULTS.bump, cfg.bump || {}),
      timing: Object.assign({}, DEFAULTS.timing, cfg.timing || {}),
      actions: Object.assign({}, DEFAULTS.actions, cfg.actions || {})
    };
  }

  function detectFork(cfg) {
    var mode = String((cfg.runtime && cfg.runtime.mode) || '').toLowerCase();
    if (mode === 'antigravity' || mode === 'cursor' || mode === 'vscode') return mode;
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
      try { list = node.querySelectorAll(selector); } catch (e) { list = []; }
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
      var all = [];
      try { all = node.querySelectorAll('*'); } catch (e) { all = []; }
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
    var r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    var s = window.getComputedStyle(el);
    return !(s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none');
  }

  function isBlockedSurface(el) {
    if (!el || !el.closest) return true;
    var blockedChrome = '.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet';
    var terminal = '.terminal-instance, .terminal-wrapper, .xterm, [data-testid*="terminal" i], [class*="terminal" i]';
    try {
      return !!(el.closest(blockedChrome) || el.closest(terminal));
    } catch (e) {
      return true;
    }
  }

  function normalizeText(el) {
    var text = String(el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    var aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    var title = String(el.getAttribute('title') || '').toLowerCase();
    var testid = String(el.getAttribute('data-testid') || '').toLowerCase();
    return [text, aria, title, testid].join(' | ');
  }

  function isLikelyChatInput(input, root) {
    if (!input) return false;
    try {
      if (root && typeof root.contains === 'function' && root.contains(input)) return true;
    } catch (e) {}
    var signature = [
      String(input.getAttribute && input.getAttribute('aria-label') || ''),
      String(input.getAttribute && input.getAttribute('placeholder') || ''),
      String(input.getAttribute && input.getAttribute('id') || ''),
      String(input.className || ''),
      String(input.getAttribute && input.getAttribute('data-testid') || '')
    ].join(' ').toLowerCase();
    if (/(chat|message|ask|prompt|composer|copilot|assistant)/i.test(signature)) return true;
    try {
      var chatContainer = input.closest('.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i], .chat-input-container');
      if (chatContainer) return true;
    } catch (e) {}
    return false;
  }

  function isValidInput(input, root) {
    if (!input || !isVisible(input) || isBlockedSurface(input)) return false;
    var tag = String(input.tagName || '').toLowerCase();
    var editable = tag === 'textarea' || input.isContentEditable || input.getAttribute('contenteditable') === 'true' || input.getAttribute('role') === 'textbox';
    if (!editable) return false;
    if (!isLikelyChatInput(input, root)) return false;
    return true;
  }

  function findRoot(profile) {
    var roots = queryAllDeep(profile.root, document);
    for (var i = 0; i < roots.length; i++) {
      if (isVisible(roots[i]) && !isBlockedSurface(roots[i])) return roots[i];
    }
    return null;
  }

  function findInput(profile, root) {
    var local = root ? queryAllDeep(profile.input, root) : [];
    for (var i = 0; i < local.length; i++) {
      if (isValidInput(local[i], root)) return local[i];
    }
    var global = queryAllDeep(profile.input, document);
    for (var j = 0; j < global.length; j++) {
      if (isValidInput(global[j], root)) return global[j];
    }
    return null;
  }

  function findSend(profile, input, root) {
    var scopes = [
      input && input.closest && input.closest('form'),
      input && input.parentElement,
      root,
      document
    ];
    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      if (!scope) continue;
      var nodes = queryAllDeep(profile.send, scope);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
        if (!isVisible(el) || isBlockedSurface(el)) continue;
        return el;
      }
    }
    return null;
  }

  function readInputText(input) {
    if (!input) return '';
    try {
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') return String(input.textContent || '').trim();
      return String(input.value || '').trim();
    } catch (e) {
      return '';
    }
  }

  function normalizeForVerify(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function verifyInputText(input, text, loose) {
    var readBack = normalizeForVerify(readInputText(input));
    var expected = normalizeForVerify(text);
    if (!readBack || !expected) return false;
    if (readBack === expected) return true;
    if (loose === true && (readBack.indexOf(expected) >= 0 || expected.indexOf(readBack) >= 0)) return true;
    return false;
  }

  function setInputText(input, text, opts) {
    var options = opts || {};
    var looseVerify = options.looseVerify === true;
    if (!input) return false;
    try {
      if (typeof input.focus === 'function') input.focus();
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try { document.execCommand('selectAll', false, null); } catch (e) {}
        try { document.execCommand('insertText', false, text); } catch (e) { input.textContent = text; }
      } else {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        var tag = String(input.tagName || '').toLowerCase();
        if (setter && setter.set && tag === 'textarea') setter.set.call(input, text);
        else input.value = text;

        if (!verifyInputText(input, text, looseVerify)) {
          try {
            if (typeof input.setSelectionRange === 'function') {
              input.setSelectionRange(0, String(input.value || '').length);
            }
          } catch (e) {}
          try { input.setRangeText(String(text || ''), 0, String(input.value || '').length, 'end'); } catch (e) {}
        }
      }
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return verifyInputText(input, text, looseVerify);
    } catch (e) {
      return false;
    }
  }

  function setInputTextVscodeFallback(input, text) {
    if (!input) return false;
    try {
      if (typeof input.focus === 'function') input.focus();
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try { document.execCommand('selectAll', false, null); } catch (e) {}
        try { document.execCommand('insertText', false, text); } catch (e) { input.textContent = text; }
      } else {
        input.value = '';
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(text || '') }));
        input.value = String(text || '');
      }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: String(text || '') }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return verifyInputText(input, text, true);
    } catch (e) {
      return false;
    }
  }

  function computeProgressSignature(root) {
    var scope = root || document;
    var selectors = '[data-testid*="message" i], [class*="message" i], .interactive-response, .chat-turn, .response, [data-testid*="response" i]';
    var nodes = queryAllDeep(selectors, scope);
    var samples = [];
    for (var i = nodes.length - 1; i >= 0 && samples.length < 3; i--) {
      var node = nodes[i];
      if (!node || !isVisible(node) || isBlockedSurface(node)) continue;
      var text = normalizeForVerify(node.textContent || '');
      if (!text) continue;
      samples.unshift(text.slice(0, 120));
    }
    if (samples.length === 0) return '';
    return String(samples.length) + '|' + samples.join('||');
  }

  function click(el, label, group, opts) {
    var options = opts || {};
    if (!el) return false;
    try {
      try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true })); } catch (e) {}
      try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true })); } catch (e) {}
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) {}
      try { if (typeof el.click === 'function') el.click(); } catch (e) {}

      if (!options.silentLog) log('clicked ' + label);
      if (!options.silentAction) emitAction(group || 'click', String(label || 'clicked').toLowerCase());
      return true;
    } catch (e) {
      return false;
    }
  }

  function isGenerating(profile, root) {
    var scope = root || document;
    var nodes = queryAllDeep(profile.generating, scope);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var el = node.closest ? (node.closest('button, [role="button"], .monaco-button') || node) : node;
      if (isVisible(el) && !isBlockedSurface(el)) return true;
    }
    return false;
  }

  function hasCompleteStopSignal(fork, root) {
    var scope = root || document;

    function visibleMatch(selector) {
      var nodes = queryAllDeep(selector, scope);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var el = node.closest ? (node.closest('button, [role="button"], a, span, div') || node) : node;
        if (isVisible(el) && !isBlockedSurface(el)) return true;
      }
      return false;
    }

    var thumbsSelectors = [
      '.codicon-thumbsup',
      '.codicon-thumbsdown',
      '[class*="thumbsup" i]',
      '[class*="thumbsdown" i]',
      'button[title*="Helpful" i]',
      'button[aria-label*="Helpful" i]',
      'button[title*="Not Helpful" i]',
      'button[aria-label*="Not Helpful" i]',
      '[title*="thumbs up" i]',
      '[title*="thumbs down" i]',
      '[aria-label*="thumbs up" i]',
      '[aria-label*="thumbs down" i]'
    ];

    var hasThumbSignal = false;
    for (var t = 0; t < thumbsSelectors.length; t++) {
      if (visibleMatch(thumbsSelectors[t])) {
        hasThumbSignal = true;
        break;
      }
    }

    var wordNodes = queryAllDeep('button, [role="button"], span, div, p, [aria-label], [title], [data-testid]', scope);
    var feedbackWordPattern = /(^|\b)(good|bad|helpful|not helpful|thumbs up|thumbs down)(\b|$)/i;
    var completionWordPattern = /(all tasks completed|task completed|completed|done|finished|need anything else|anything else\?|waiting for input|requires input)/i;
    var hasWordSignal = false;

    for (var w = 0; w < wordNodes.length; w++) {
      var n = wordNodes[w];
      var e = n.closest ? (n.closest('button, [role="button"], span, div, p') || n) : n;
      if (!isVisible(e) || isBlockedSurface(e)) continue;
      var text = normalizeText(e);
      if (feedbackWordPattern.test(text) || completionWordPattern.test(text)) {
        hasWordSignal = true;
        break;
      }
    }

    if (fork === 'vscode') {
      return hasThumbSignal;
    }

    if (fork === 'antigravity' || fork === 'cursor') {
      return hasWordSignal;
    }

    return hasThumbSignal || hasWordSignal;
  }

  function submitText(profile, input, root) {
    var before = readInputText(input);
    if (!before) return false;

    var preferred = profile === 'vscode' ? 'enter' : 'send';

    if (preferred === 'send') {
      var sendBtn = findSend(profile, input, root);
      if (sendBtn && click(sendBtn, 'Submit bump text', 'submit', { silentLog: true, silentAction: true })) {
        var afterSend = readInputText(input);
        if (!afterSend || afterSend !== before || isGenerating(profile, root)) {
          emitAction('submit', 'submit bump text');
          return true;
        }
      }
      return false;
    }

    try {
      if (typeof input.focus === 'function') input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (readInputText(input) !== before || isGenerating(profile, root)) {
        emitAction('submit', 'submit bump text');
        return true;
      }
    } catch (e) {}

    return false;
  }

  function findActionElement(root, spec) {
    var scopes = [];
    if (root) scopes.push(root);
    scopes.push(document);

    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      var nodes = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]', scope);
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
        if (!isVisible(el) || isBlockedSurface(el)) continue;
        if (spec.regex.test(normalizeText(el))) return el;
      }
    }
    return null;
  }

  function shouldAct(cfg) {
    if (document.visibilityState !== 'visible') return false;
    if (cfg.runtime.enforceLeader === true && cfg.runtime.isLeader !== true) return false;
    var docFocused = (typeof document.hasFocus !== 'function') || document.hasFocus();
    var hostFocused = cfg.runtime.windowFocused === true;
    if (!docFocused && !hostFocused) return false;
    return true;
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;
    window.__antigravityHeartbeat = Date.now();

    var cfg = getConfig();
    var fork = detectFork(cfg);
    var profile = PROFILES[fork] || PROFILES.vscode;

    if (!shouldAct(cfg)) return;

    var now = Date.now();
    if ((now - lastActionAt) < Math.max(50, Number(cfg.timing.actionThrottleMs || 300))) return;

    var root = findRoot(profile);
    var input = findInput(profile, root);
    var send = findSend(profile, input, root);

    var generating = isGenerating(profile, root);
    if (generating || wasGenerating) {
      lastProgressAt = now;
    }
    wasGenerating = generating;

    var progressSignature = computeProgressSignature(root);
    if (progressSignature && progressSignature !== lastProgressSignature) {
      lastProgressSignature = progressSignature;
      lastProgressAt = now;
    }

    var stalledMs = Math.max(1000, Number(cfg.timing.stalledMs || 7000));
    var stalled = !generating && (now - lastProgressAt) >= stalledMs;
    var completeStopSignal = hasCompleteStopSignal(fork, root || document);

    if (!didInitialProbe) {
      didInitialProbe = true;
      log('probe fork=' + fork + ' root=' + (!!root) + ' input=' + (!!input) + ' send=' + (!!send) + ' generating=' + generating + ' role=' + String(cfg.runtime.role || 'unknown'));
    }

    window.__antigravityRuntimeState = {
      fork: fork,
      mode: fork,
      status: generating ? 'processing' : (stalled && completeStopSignal ? 'waiting_for_chat_message' : 'idle'),
      waitingForChatMessage: stalled && completeStopSignal,
      completionWaiting: {
        readyToResume: stalled && completeStopSignal,
        confidence: stalled && completeStopSignal ? 90 : (stalled ? 55 : 35),
        confidenceLabel: stalled && completeStopSignal ? 'high' : (stalled ? 'medium' : 'low'),
        reasons: stalled
          ? (completeStopSignal
            ? ['not generating', 'stall timeout reached', 'complete-stop signal detected']
            : ['not generating', 'stall timeout reached', 'waiting for complete-stop signal'])
          : ['generation active or recently active']
      },
      hasRoot: !!root,
      hasInput: !!input,
      hasSend: !!send,
      isGenerating: generating,
      stalled: stalled,
      completeStopSignal: completeStopSignal,
      timestamp: now
    };

    for (var i = 0; i < ACTION_SPECS.length; i++) {
      var spec = ACTION_SPECS[i];
      if (cfg.actions[spec.key] !== true) continue;
      if (spec.key === 'clickRetry' && fork === 'vscode') continue;
      var actionEl = findActionElement(root, spec);
      if (actionEl && click(actionEl, spec.label, 'click')) {
        lastActionAt = now;
        lastProgressAt = now;
        return;
      }
    }

    if (!cfg.bump.enabled || generating || !stalled) return;

    if (!completeStopSignal) {
      if ((now - lastStopSignalLogAt) > 5000) {
        lastStopSignalLogAt = now;
        log('stall detected but complete-stop signal missing; skipping bump');
      }
      return;
    }

    var bumpCooldownMs = Math.max(1000, Number(cfg.timing.bumpCooldownMs || 30000));
    var submitCooldownMs = Math.max(500, Number(cfg.timing.submitCooldownMs || 3000));
    if ((now - lastBumpAt) < bumpCooldownMs) return;
    if (now < submitInFlightUntil) return;

    var bumpText = String(cfg.bump.text || 'Proceed').trim();
    if (!bumpText || !input) return;

    var typed = setInputText(input, bumpText, { looseVerify: fork === 'vscode' });
    if (!typed && fork === 'vscode') {
      typed = setInputTextVscodeFallback(input, bumpText);
    }

    if (!typed) {
      log('type verify failed');
      lastActionAt = now;
      return;
    }

    log('typed bump text');
    submitInFlightUntil = now + submitCooldownMs;
    var submitDelay = Math.max(40, Number(cfg.bump.submitDelayMs || 120));
    setTimeout(function () {
      if (window.__antigravityActiveInstance !== INSTANCE) return;
      var ok = submitText(profile, input, root);
      if (ok) log('submitted bump text');
      else log('submit attempt failed');
    }, submitDelay);

    lastBumpAt = now;
    lastActionAt = now;
    lastProgressAt = now;
  }

  function schedule() {
    if (window.__antigravityActiveInstance !== INSTANCE) return;
    var cfg = getConfig();
    var pollMs = Math.max(150, Number(cfg.timing.pollIntervalMs || 800));
    pollTimer = setTimeout(function () {
      try { runLoop(); } catch (e) { log('loop error: ' + String((e && e.message) || e || 'unknown')); }
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

  log('auto-continue minimal core started');
  try { runLoop(); } catch (e) { log('loop error: ' + String((e && e.message) || e || 'unknown')); }
  schedule();
})();
`;
