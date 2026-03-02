export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  const THIS_INSTANCE = Math.random().toString(36).slice(2);
  window.__antigravityActiveInstance = THIS_INSTANCE;
  window.__antigravityAutoContinueRunning = true;
  window.__antigravityHeartbeat = Date.now();

  const DEFAULTS = {
    runtime: { isLeader: false, role: 'follower', windowFocused: true, enforceLeader: true },
    bump: { enabled: true, text: 'Proceed', requireVisible: true, requireFocused: false, submitDelayMs: 150 },
    timing: { pollIntervalMs: 500, actionThrottleMs: 250, stalledMs: 7000, bumpCooldownMs: 12000, submitCooldownMs: 3500 },
    actions: {
      clickRun: true,
      clickExpand: true,
      clickAlwaysAllow: true,
      clickRetry: true,
      clickAcceptAll: true,
      clickAllow: true,
      clickProceed: true,
      clickKeep: true
    }
  };

  const CLICKABLE_SELECTOR = 'button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]';
  const CHAT_INPUT_SELECTOR = [
    '.interactive-input-part textarea',
    '.chat-input-widget textarea',
    '.interactive-editor textarea',
    '.chat-editing-session-container textarea',
    '.aichat-container textarea',
    '[data-testid*="chat" i] textarea',
    '[data-testid*="composer" i] textarea',
    '[class*="chat" i] textarea',
    '[class*="composer" i] textarea',
    '[class*="interactive" i] textarea',
    '.interactive-input-part [contenteditable="true"]',
    '.chat-input-widget [contenteditable="true"]',
    '.interactive-editor [contenteditable="true"]',
    '.chat-editing-session-container [contenteditable="true"]',
    '.aichat-container [contenteditable="true"]',
    '[data-testid*="chat" i] [contenteditable="true"]',
    '[data-testid*="composer" i] [contenteditable="true"]',
    '[class*="chat" i] [contenteditable="true"]',
    '[class*="composer" i] [contenteditable="true"]',
    '[class*="interactive" i] [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]'
  ].join(',');
  const CHAT_SURFACE_SELECTOR = '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i]';
  const GENERATING_SELECTOR = '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator';

  const ACTION_SPECS = [
    { key: 'clickRun', label: 'Run', regex: /(^|\b)(run(\s+in\s+terminal|\s+command)?|execute)(\b|$)/i },
    { key: 'clickExpand', label: 'Expand', regex: /(expand|requires\s*input|step\s*requires\s*input)/i },
    { key: 'clickAlwaysAllow', label: 'Always Allow', regex: /(always\s*allow|always\s*approve)/i },
    { key: 'clickRetry', label: 'Retry', regex: /\bretry\b/i },
    { key: 'clickAcceptAll', label: 'Accept all', regex: /(accept\s*all|apply\s*all|accept\s*all\s*changes|apply\s*all\s*changes)/i },
    { key: 'clickAllow', label: 'Allow', regex: /\ballow\b/i },
    { key: 'clickProceed', label: 'Proceed', regex: /\b(proceed|continue)\b/i },
    { key: 'clickKeep', label: 'Keep', regex: /\bkeep\b/i }
  ];

  let pollTimer = null;
  let lastActionAt = 0;
  let lastBumpAt = 0;
  let submitInFlightUntil = 0;
  let lastProgressAt = Date.now();
  let lastSignalHash = '';

  function getConfig() {
    const cfg = window.__antigravityConfig || {};
    return {
      ...DEFAULTS,
      ...cfg,
      runtime: { ...DEFAULTS.runtime, ...(cfg.runtime || {}) },
      bump: { ...DEFAULTS.bump, ...(cfg.bump || {}) },
      timing: { ...DEFAULTS.timing, ...(cfg.timing || {}) },
      actions: { ...DEFAULTS.actions, ...(cfg.actions || {}) }
    };
  }

  function emitBridge(payload) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
        window.__AUTOPILOT_BRIDGE__(payload);
      } else {
        console.log(payload);
      }
    } catch (e) {}
  }

  function log(msg) { emitBridge('__AUTOPILOT_LOG__:' + String(msg || '')); }
  function emitAction(group, detail) { emitBridge('__AUTOPILOT_ACTION__:' + group + '|' + detail); }

  function detectFork(cfg) {
    const mode = String(cfg.runtime?.mode || '').toLowerCase();
    if (mode === 'antigravity' || mode === 'cursor' || mode === 'vscode') return mode;
    const title = String(document.title || '').toLowerCase();
    const url = String(location.href || '').toLowerCase();
    if (title.includes('antigravity') || url.includes('antigravity')) return 'antigravity';
    if (title.includes('cursor') || url.includes('cursor')) return 'cursor';
    return 'vscode';
  }

  function queryAllDeep(selector, root) {
    const out = [];
    const seen = new Set();
    function visit(node) {
      if (!node || !node.querySelectorAll) return;
      let nodes = [];
      try { nodes = node.querySelectorAll(selector); } catch (e) { nodes = []; }
      for (const el of nodes) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
      let descendants = [];
      try { descendants = node.querySelectorAll('*'); } catch (e) { descendants = []; }
      for (const d of descendants) {
        if (d && d.shadowRoot) visit(d.shadowRoot);
      }
    }
    visit(root || document);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    const s = window.getComputedStyle(el);
    return !(s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none');
  }

  function isBlockedSurface(el) {
    if (!el || !el.closest) return true;
    const blockedChrome = '.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet';
    const terminal = '.terminal-instance, .terminal-wrapper, .xterm, [data-testid*="terminal" i], [class*="terminal" i]';
    try {
      return !!(el.closest(blockedChrome) || el.closest(terminal));
    } catch (e) {
      return true;
    }
  }

  function normalizeText(el) {
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
    const title = String(el.getAttribute('title') || '').toLowerCase();
    const testid = String(el.getAttribute('data-testid') || '').toLowerCase();
    const className = String(el.className || '').toLowerCase();
    return [text, aria, title, testid, className].join(' | ');
  }

  function isLikelyChatInput(input) {
    if (!input || !isVisible(input) || isBlockedSurface(input)) return false;
    const tag = String(input.tagName || '').toLowerCase();
    const editable = tag === 'textarea' || input.isContentEditable || input.getAttribute('contenteditable') === 'true';
    if (!editable) return false;

    const markerText = [
      String(input.getAttribute('placeholder') || ''),
      String(input.getAttribute('aria-label') || ''),
      String(input.getAttribute('data-testid') || ''),
      String(input.className || '')
    ].join(' ').toLowerCase();

    if (/(ask|message|prompt|chat|composer|reply|agent|assistant|continue)/i.test(markerText)) return true;
    try {
      if (input.closest && input.closest(CHAT_SURFACE_SELECTOR)) return true;
    } catch (e) {}
    return false;
  }

  function hasChatSurface() {
    const nodes = queryAllDeep(CHAT_SURFACE_SELECTOR);
    for (const node of nodes) {
      if (isVisible(node) && !isBlockedSurface(node)) return true;
    }
    return false;
  }

  function shouldAct(cfg) {
    if (cfg.bump.requireVisible !== false && document.visibilityState !== 'visible') return false;
    if (cfg.runtime.enforceLeader === true && cfg.runtime.isLeader !== true) return false;
    if (cfg.bump.requireFocused === true) {
      const docFocused = (typeof document.hasFocus !== 'function') || document.hasFocus();
      const hostFocused = cfg.runtime.windowFocused === true;
      if (!docFocused && !hostFocused) return false;
    }
    return true;
  }

  function findChatInput() {
    const inputs = queryAllDeep(CHAT_INPUT_SELECTOR);
    for (const input of inputs) {
      if (isLikelyChatInput(input)) return input;
    }

    const broad = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');
    for (const input of broad) {
      if (isLikelyChatInput(input)) return input;
    }
    return null;
  }

  function findSendButton(input) {
    const selector = '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [title*="Continue" i], [aria-label*="Continue" i], [data-testid*="send" i], [data-testid*="submit" i], button[type="submit"], .codicon-send';
    const roots = [
      input && input.closest && input.closest('form'),
      input && input.closest && input.closest('[class*="chat" i], [class*="composer" i], .chat-editing-session-container, .aichat-container'),
      input && input.parentElement,
      document
    ].filter(Boolean);
    for (const root of roots) {
      const matches = queryAllDeep(selector, root);
      for (const node of matches) {
        const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
        if (!isVisible(el) || isBlockedSurface(el)) continue;
        return el;
      }
    }
    return null;
  }

  function click(el, label, group) {
    if (!el) return false;
    try {
      try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (e) {}
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

  function setInputText(input, text) {
    if (!input) return false;
    try {
      if (typeof input.focus === 'function') input.focus();
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try { document.execCommand('insertText', false, text); } catch (e) { input.textContent = text; }
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter && String(input.tagName || '').toLowerCase() === 'textarea') setter.call(input, text);
        else input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return true;
    } catch (e) {
      return false;
    }
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

  function submitBumpText(mode, input, cfg) {
    const before = readInputText(input);
    if (!before) return false;

    const send = findSendButton(input);
    if (send && click(send, 'Submit bump text', 'submit')) return true;

    try {
      const form = input.closest && input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        if (readInputText(input) !== before) return true;
      }
    } catch (e) {}

    try {
      if (typeof input.focus === 'function') input.focus();
      const combos = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, {}];
      for (const mods of combos) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, ...mods }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, ...mods }));
      }
      if (readInputText(input) !== before) return true;
    } catch (e) {}

    if (mode === 'antigravity') {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + before);
      return true;
    }

    return false;
  }

  function detectActionElements() {
    const out = {};
    for (const spec of ACTION_SPECS) out[spec.key] = null;
    const nodes = queryAllDeep(CLICKABLE_SELECTOR);
    for (const node of nodes) {
      const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
      if (!isVisible(el) || isBlockedSurface(el)) continue;
      try {
        if (!(el.closest && el.closest(CHAT_SURFACE_SELECTOR))) {
          const normalized = normalizeText(el);
          if (!/(run|execute|expand|requires\s*input|retry|accept\s*all|always\s*allow|allow|proceed|continue|keep)/i.test(normalized)) {
            continue;
          }
        }
      } catch (e) {}
      const text = normalizeText(el);
      for (const spec of ACTION_SPECS) {
        if (out[spec.key]) continue;
        if (spec.regex.test(text)) {
          out[spec.key] = el;
        }
      }
    }
    return out;
  }

  function detectStalledConversation(cfg, mode, snapshot) {
    const hasInput = !!snapshot.input;
    const hasSend = !!snapshot.send;
    const isGenerating = snapshot.isGenerating;
    const pendingActions = snapshot.pendingActions;
    const chatSurfaceDetected = snapshot.chatSurfaceDetected;
    const stalledMs = Math.max(1000, Number(cfg.timing.stalledMs || 7000));
    const idleMs = Date.now() - lastProgressAt;
    const stalled = (hasInput || hasSend || chatSurfaceDetected) && !isGenerating && pendingActions === 0 && idleMs >= stalledMs;

    return {
      stalled,
      hasInput,
      hasSend,
      chatSurfaceDetected,
      isGenerating,
      pendingActions,
      idleMs,
      mode
    };
  }

  function buildSnapshot(cfg, mode) {
    const input = findChatInput();
    const send = findSendButton(input);
    const chatSurfaceDetected = hasChatSurface();
    const isGenerating = queryAllDeep(GENERATING_SELECTOR).some(isVisible);
    const actions = detectActionElements();
    const pendingActions = ACTION_SPECS.reduce((sum, spec) => sum + (actions[spec.key] ? 1 : 0), 0);
    return { input, send, chatSurfaceDetected, isGenerating, actions, pendingActions, mode, cfg };
  }

  function updateProgress(snapshot) {
    const hash = [
      snapshot.isGenerating ? '1' : '0',
      snapshot.input ? '1' : '0',
      snapshot.send ? '1' : '0',
      snapshot.chatSurfaceDetected ? '1' : '0',
      ACTION_SPECS.map((s) => snapshot.actions[s.key] ? '1' : '0').join('')
    ].join('|');

    if (hash !== lastSignalHash) {
      lastSignalHash = hash;
      lastProgressAt = Date.now();
    }
  }

  function tryClickActions(snapshot) {
    for (const spec of ACTION_SPECS) {
      if (snapshot.cfg.actions[spec.key] !== true) continue;
      const el = snapshot.actions[spec.key];
      if (!el) continue;
      if (click(el, spec.label, 'click')) {
        lastActionAt = Date.now();
        return true;
      }
    }
    return false;
  }

  function tryBump(snapshot, stallState) {
    const cfg = snapshot.cfg;
    if (!cfg.bump.enabled) return false;
    if (snapshot.isGenerating) return false;
    if (!stallState.stalled && !snapshot.send && !snapshot.input && !snapshot.chatSurfaceDetected) return false;

    const now = Date.now();
    const bumpCooldownMs = Math.max(1000, Number(cfg.timing.bumpCooldownMs || 12000));
    const submitCooldownMs = Math.max(500, Number(cfg.timing.submitCooldownMs || 3500));
    if ((now - lastBumpAt) < bumpCooldownMs) return false;
    if (now < submitInFlightUntil) return false;

    const text = String(cfg.bump.text || 'Proceed').trim();
    if (!text) return false;

    const mode = snapshot.mode;
    const input = snapshot.input;
    if (!input) {
      if (!snapshot.send && !stallState.stalled && !snapshot.chatSurfaceDetected) return false;
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + text);
      emitAction('submit', 'minimal-hybrid');
      log('bump fallback via bridge (no input selector)');
      lastBumpAt = now;
      submitInFlightUntil = now + submitCooldownMs;
      return true;
    }

    if (!setInputText(input, text)) return false;
    const typedNow = readInputText(input).toLowerCase();
    if (!typedNow.includes(text.toLowerCase())) {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + text);
      log('bump typing did not persist; escalated to bridge');
      lastBumpAt = now;
      submitInFlightUntil = now + submitCooldownMs;
      return true;
    }

    log('typed bump text');
    submitInFlightUntil = now + submitCooldownMs;
    const delay = Math.max(40, Number(cfg.bump.submitDelayMs || 150));
    setTimeout(function () {
      submitBumpText(mode, input, cfg);
      log('submitted bump text');
      emitAction('submit', 'minimal');
    }, delay);

    lastBumpAt = now;
    return true;
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
    window.__antigravityHeartbeat = Date.now();

    const cfg = getConfig();
    if (!shouldAct(cfg)) return;

    const now = Date.now();
    if ((now - lastActionAt) < Math.max(50, Number(cfg.timing.actionThrottleMs || 250))) return;

    const mode = detectFork(cfg);
    const snapshot = buildSnapshot(cfg, mode);
    updateProgress(snapshot);
    const stallState = detectStalledConversation(cfg, mode, snapshot);

    window.__antigravityRuntimeState = {
      fork: mode,
      isGenerating: snapshot.isGenerating,
      hasInput: !!snapshot.input,
      hasSend: !!snapshot.send,
      chatSurfaceDetected: snapshot.chatSurfaceDetected,
      pendingActions: snapshot.pendingActions,
      stalled: stallState.stalled,
      idleMs: stallState.idleMs,
      ts: now
    };

    if (tryBump(snapshot, stallState)) {
      lastActionAt = now;
      return;
    }

    if (tryClickActions(snapshot)) {
      lastActionAt = now;
    }
  }

  function schedule() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
    const cfg = getConfig();
    const pollMs = Math.max(150, Number(cfg.timing.pollIntervalMs || 500));
    pollTimer = setTimeout(function () {
      try { runLoop(); } catch (e) {}
      schedule();
    }, pollMs);
  }

  window.__antigravityGetState = function () {
    return window.__antigravityRuntimeState || null;
  };

  window.__antigravityTypeAndSubmit = function (text) {
    const cfg = getConfig();
    if (!shouldAct(cfg)) return false;
    const mode = detectFork(cfg);
    const input = findChatInput();
    const payload = String(text || cfg.bump.text || 'Proceed').trim();
    if (!payload) return false;
    if (!input) {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + payload);
      return true;
    }
    if (!setInputText(input, payload)) return false;
    return submitBumpText(mode, input, cfg);
  };

  window.stopAutoContinue = function () {
    if (pollTimer) clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('auto-continue minimal core started');
  schedule();
})();
`;
