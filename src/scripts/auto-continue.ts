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
    bump: { enabled: true, text: 'Proceed', requireVisible: true, requireFocused: false, submitDelayMs: 120 },
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

  const PROFILES = {
    antigravity: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i]',
      input: 'textarea, [contenteditable="true"], [role="textbox"]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [title*="Continue" i], [aria-label*="Continue" i], [data-testid*="send" i], [data-testid*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    },
    cursor: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i]',
      input: 'textarea, [contenteditable="true"], [role="textbox"]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [title*="Continue" i], [aria-label*="Continue" i], [data-testid*="send" i], [data-testid*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    },
    vscode: {
      root: '.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i]',
      input: 'textarea, [contenteditable="true"], [role="textbox"]',
      send: '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [title*="Continue" i], [aria-label*="Continue" i], [data-testid*="send" i], [data-testid*="submit" i], button[type="submit"], .codicon-send',
      generating: '[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator'
    }
  };

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
  let lastActivityAt = Date.now();
  let lastProgressAt = Date.now();
  let wasGenerating = false;
  let didInitialProbe = false;

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
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(payload);
      else console.log(payload);
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

  function getProfile(fork) {
    return PROFILES[fork] || PROFILES.vscode;
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
    return [text, aria, title, testid].join(' | ');
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

  function findRoot(profile) {
    const roots = queryAllDeep(profile.root);
    for (const root of roots) {
      if (isVisible(root) && !isBlockedSurface(root)) return root;
    }
    return null;
  }

  function isValidInput(input, root, rootSelector) {
    if (!input || !isVisible(input) || isBlockedSurface(input)) return false;
    const tag = String(input.tagName || '').toLowerCase();
    const editable = tag === 'textarea' || input.isContentEditable || input.getAttribute('contenteditable') === 'true' || input.getAttribute('role') === 'textbox';
    if (!editable) return false;
    if (root && input.closest) {
      try {
        if (rootSelector && !input.closest(rootSelector) && !root.contains(input)) return false;
      } catch (e) {}
    }
    return true;
  }

  function findInput(profile, root) {
    const local = root ? queryAllDeep(profile.input, root) : [];
    for (const input of local) {
      if (isValidInput(input, root, profile.root)) return input;
    }
    const global = queryAllDeep(profile.input, document);
    for (const input of global) {
      if (isValidInput(input, root, profile.root)) return input;
    }
    return null;
  }

  function findSend(profile, input, root) {
    const scopes = [
      input && input.closest && input.closest('form'),
      input && input.parentElement,
      root,
      document
    ].filter(Boolean);

    for (const scope of scopes) {
      const nodes = queryAllDeep(profile.send, scope);
      for (const node of nodes) {
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
      lastActivityAt = Date.now();
      lastProgressAt = Date.now();
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
        try { document.execCommand('selectAll', false, null); } catch (e) {}
        try { document.execCommand('insertText', false, text); } catch (e) { input.textContent = text; }
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter && String(input.tagName || '').toLowerCase() === 'textarea') setter.call(input, text);
        else input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      lastActivityAt = Date.now();
      lastProgressAt = Date.now();
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

  function submitText(profile, fork, input, root, text) {
    const before = readInputText(input);
    if (!before) return false;

    const send = findSend(profile, input, root);
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

    if (fork === 'antigravity') {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + text);
      emitAction('submit', 'minimal-hybrid');
      return true;
    }

    return false;
  }

  function isGenerating(profile, root) {
    const scope = root || document;
    const nodes = queryAllDeep(profile.generating, scope);
    return nodes.some(function (node) {
      const el = node.closest ? (node.closest('button, [role="button"], .monaco-button') || node) : node;
      return isVisible(el) && !isBlockedSurface(el);
    });
  }

  function findActionTarget(root, cfg) {
    const scope = root || document;
    const nodes = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]', scope);
    for (const node of nodes) {
      const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
      if (!isVisible(el) || isBlockedSurface(el)) continue;
      const text = normalizeText(el);
      for (const spec of ACTION_SPECS) {
        if (cfg.actions[spec.key] !== true) continue;
        if (spec.regex.test(text)) return spec;
      }
    }
    return null;
  }

  function findElementBySpec(root, spec) {
    if (!spec) return null;
    const nodes = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]', root || document);
    for (const node of nodes) {
      const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
      if (!isVisible(el) || isBlockedSurface(el)) continue;
      const text = normalizeText(el);
      if (spec.regex.test(text)) return el;
    }
    return null;
  }

  function runLoop() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
    window.__antigravityHeartbeat = Date.now();

    const cfg = getConfig();
    if (!shouldAct(cfg)) return;

    const now = Date.now();
    if ((now - lastActionAt) < Math.max(50, Number(cfg.timing.actionThrottleMs || 250))) return;

    const fork = detectFork(cfg);
    const profile = getProfile(fork);
    const root = findRoot(profile);

    const generating = isGenerating(profile, root);
    if (generating) {
      lastProgressAt = now;
    } else if (wasGenerating) {
      lastProgressAt = now;
    }
    wasGenerating = generating;

    const input = findInput(profile, root);
    const send = findSend(profile, input, root);
    const idleMs = now - lastActivityAt;
    const progressIdleMs = now - lastProgressAt;
    const hasConversationSurface = !!root || !!input || !!send || document.visibilityState === 'visible';
    const stalled = hasConversationSurface && !generating && progressIdleMs >= Math.max(1000, Number(cfg.timing.stalledMs || 7000));

    if (!didInitialProbe) {
      didInitialProbe = true;
      log('probe fork=' + fork + ' root=' + (!!root) + ' input=' + (!!input) + ' send=' + (!!send) + ' generating=' + generating + ' role=' + String(cfg.runtime?.role || 'unknown'));
    }

    window.__antigravityRuntimeState = {
      fork,
      isGenerating: generating,
      hasRoot: !!root,
      hasInput: !!input,
      hasSend: !!send,
      stalled,
      idleMs,
      progressIdleMs,
      ts: now
    };

    const actionSpec = findActionTarget(root, cfg);
    if (actionSpec) {
      const actionEl = findElementBySpec(root, actionSpec);
      if (actionEl && click(actionEl, actionSpec.label, 'click')) {
        lastActionAt = now;
        return;
      }
    }

    if (!cfg.bump.enabled || generating) return;

    const bumpCooldownMs = Math.max(1000, Number(cfg.timing.bumpCooldownMs || 12000));
    const submitCooldownMs = Math.max(500, Number(cfg.timing.submitCooldownMs || 3500));
    if ((now - lastBumpAt) < bumpCooldownMs) return;
    if (now < submitInFlightUntil) return;
    if (!stalled) return;

    const bumpText = String(cfg.bump.text || 'Proceed').trim();
    if (!bumpText) return;

    if (!input) {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + bumpText);
      emitAction('submit', 'minimal-hybrid');
      log('bump fallback: no input detected');
      lastBumpAt = now;
      submitInFlightUntil = now + submitCooldownMs;
      lastActionAt = now;
      lastProgressAt = now;
      return;
    }

    const typed = setInputText(input, bumpText);
    if (!typed) return;

    log('typed bump text');
    submitInFlightUntil = now + submitCooldownMs;
    const submitDelay = Math.max(40, Number(cfg.bump.submitDelayMs || 120));
    setTimeout(function () {
      submitText(profile, fork, input, root, bumpText);
      log('submitted bump text');
      emitAction('submit', 'minimal');
    }, submitDelay);

    lastBumpAt = now;
    lastActionAt = now;
    lastProgressAt = now;
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

    const fork = detectFork(cfg);
    const profile = getProfile(fork);
    const root = findRoot(profile);
    const input = findInput(profile, root);
    const payload = String(text || cfg.bump.text || 'Proceed').trim();
    if (!payload) return false;

    if (!input) {
      emitBridge('__AUTOPILOT_HYBRID_BUMP__:' + payload);
      emitAction('submit', 'manual-hybrid');
      return true;
    }

    if (!setInputText(input, payload)) return false;
    return submitText(profile, fork, input, root, payload);
  };

  window.stopAutoContinue = function () {
    if (pollTimer) clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('auto-continue minimal core started');
  schedule();
})();
`;
