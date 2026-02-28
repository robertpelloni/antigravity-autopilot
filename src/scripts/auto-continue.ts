export const AUTO_CONTINUE_SCRIPT = `
(function () {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  const THIS_INSTANCE = Math.random().toString(36).slice(2);
  window.__antigravityActiveInstance = THIS_INSTANCE;
  window.__antigravityAutoContinueRunning = true;
  window.__antigravityHeartbeat = Date.now();

  const defaults = {
    runtime: { isLeader: false, role: 'follower', windowFocused: true },
    bump: {
      text: 'Proceed',
      enabled: true,
      requireFocused: true,
      requireVisible: true,
      submitDelayMs: 180
    },
    timing: {
      pollIntervalMs: 700,
      actionThrottleMs: 350,
      stalledMs: 7000,
      bumpCooldownMs: 12000,
      submitCooldownMs: 4000
    },
    actions: {
      clickRun: true,
      clickExpand: true,
      clickAlwaysAllow: true,
      clickRetry: true,
      clickAcceptAll: true,
      clickAccept: true,
      clickKeep: true,
      clickEdit: true,
      clickSubmit: true
    }
  };

  let pollTimer = null;
  let lastActionAt = 0;
  let lastBumpAt = 0;
  let submitInFlightUntil = 0;
  let lastUserVisibleChangeAt = Date.now();
  let lastStateHash = '';

  function getConfig() {
    const cfg = window.__antigravityConfig || {};
    return {
      ...defaults,
      ...cfg,
      runtime: { ...defaults.runtime, ...(cfg.runtime || {}) },
      bump: { ...defaults.bump, ...(cfg.bump || {}) },
      timing: { ...defaults.timing, ...(cfg.timing || {}) },
      actions: { ...defaults.actions, ...(cfg.actions || {}) }
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

  function log(msg) {
    emitBridge('__AUTOPILOT_LOG__:' + msg);
  }

  function emitAction(group, detail) {
    emitBridge('__AUTOPILOT_ACTION__:' + String(group || 'click') + '|' + String(detail || 'triggered'));
  }

  function detectFork() {
    const title = (document.title || '').toLowerCase();
    const url = String(location.href || '').toLowerCase();
    const bodyClass = (document.body && document.body.className ? document.body.className : '').toLowerCase();

    if (title.includes('antigravity') || url.includes('antigravity') || bodyClass.includes('antigravity')) {
      return 'antigravity';
    }
    if (title.includes('cursor') || url.includes('cursor')) {
      return 'cursor';
    }
    return 'vscode';
  }

  function queryAllDeep(selector, root) {
    const out = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node) return;
      try {
        if (node.querySelectorAll) {
          const nodes = node.querySelectorAll(selector);
          for (const el of nodes) {
            if (!seen.has(el)) {
              seen.add(el);
              out.push(el);
            }
          }
          const descendants = node.querySelectorAll('*');
          for (const d of descendants) {
            if (d && d.shadowRoot) visit(d.shadowRoot);
          }
        }
      } catch (e) {}
    };
    visit(root || document);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
    return true;
  }

  function isSafeSurface(el) {
    if (!el) return false;
    const blocked = '.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet';
    try {
      if (el.closest && el.closest(blocked)) return false;
    } catch (e) {}
    return true;
  }

  function isTerminalSurface(el) {
    if (!el || !el.closest) return false;
    const terminalRoots = [
      '.terminal-instance', '.terminal-wrapper', '.xterm',
      '[data-testid*="terminal" i]', '[class*="terminal" i]'
    ].join(',');
    try {
      return !!el.closest(terminalRoots);
    } catch (e) {
      return false;
    }
  }

  function isChatSurface(el) {
    if (!el || !el.closest) return false;
    const chatRoots = [
      '.interactive-input-part',
      '.chat-input-widget',
      '.interactive-editor',
      '[data-testid*="chat" i]',
      '[data-testid*="composer" i]',
      '[class*="chat" i]',
      '[class*="composer" i]',
      '[class*="interactive" i]'
    ].join(',');
    try {
      return !!el.closest(chatRoots);
    } catch (e) {
      return false;
    }
  }

  function normalizeText(el) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const testid = (el.getAttribute('data-testid') || '').toLowerCase();
    const className = (el.className || '').toString().toLowerCase();
    const shortcut = (el.getAttribute('aria-keyshortcuts') || '').toLowerCase();
    const hints = [];
    if (className.includes('codicon-play') || className.includes('codicon-run') || className.includes('codicon-debug-start')) {
      hints.push('run execute');
    }
    if (className.includes('codicon-chevron-right') || className.includes('twistie')) {
      hints.push('expand requires input');
    }
    if (className.includes('codicon-send')) {
      hints.push('send submit continue');
    }
    if (shortcut.includes('alt+enter') || shortcut.includes('opt+enter')) {
      hints.push('run');
    }
    return [text, aria, title, testid, className, shortcut, hints.join(' ')].join(' | ');
  }

  function targetSelectorsForFork(fork) {
    const shared = {
      run: [
        '[title*="Run in Terminal" i]', '[aria-label*="Run in Terminal" i]',
        '[title*="Run command" i]', '[aria-label*="Run command" i]',
        '[title*="Execute" i]', '[aria-label*="Execute" i]',
        '[data-testid*="run" i]', '[data-testid*="execute" i]',
        '.codicon-play', '.codicon-run'
      ],
      expand: [
        '[title*="Expand" i]', '[aria-label*="Expand" i]',
        '[title*="requires input" i]', '[aria-label*="requires input" i]',
        '[data-testid*="expand" i]', '[data-testid*="requires-input" i]'
      ],
      alwaysAllow: [
        '[title*="Always Allow" i]', '[aria-label*="Always Allow" i]',
        '[title*="Always Approve" i]', '[aria-label*="Always Approve" i]',
        '[data-testid*="always-allow" i]', '[data-testid*="always-approve" i]'
      ],
      retry: [
        '[title*="Retry" i]', '[aria-label*="Retry" i]', '[data-testid*="retry" i]'
      ],
      acceptAll: [
        '[title*="Accept All" i]', '[aria-label*="Accept All" i]',
        '[title*="Apply All" i]', '[aria-label*="Apply All" i]',
        '[data-testid*="accept-all" i]', '.codicon-check-all'
      ],
      accept: [
        '[title="Accept" i]', '[aria-label="Accept" i]', '[data-testid*="accept" i]'
      ],
      keep: [
        '[title="Keep" i]', '[aria-label="Keep" i]',
        '[title*="Keep" i]', '[aria-label*="Keep" i]',
        '[data-testid*="keep" i]'
      ],
      edit: [
        '[title*="Edit" i]', '[aria-label*="Edit" i]', '[data-testid*="edit" i]', '.codicon-edit'
      ],
      submit: [
        '[title*="Send" i]', '[aria-label*="Send" i]',
        '[title*="Submit" i]', '[aria-label*="Submit" i]',
        '[data-testid*="send" i]', '[data-testid*="submit" i]',
        'button[type="submit"]', '.codicon-send'
      ]
    };

    if (fork === 'cursor') {
      return shared;
    }
    if (fork === 'antigravity') {
      return shared;
    }
    return shared;
  }

  function findClickable(selectors, semanticRegex, options) {
    const opts = options || {};
    const joined = selectors.join(',');
    const candidates = queryAllDeep(joined);
    const passes = opts.requireChatSurface ? [true, false] : [false];
    for (const requireChat of passes) {
      if (!requireChat && opts.requireChatSurface && !opts.allowNonChatFallback) {
        continue;
      }
      for (const node of candidates) {
        const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
        if (!isVisible(el) || !isSafeSurface(el)) continue;
        if (requireChat && !isChatSurface(el)) continue;
        if (isTerminalSurface(el)) continue;
        const text = normalizeText(el);
        if (semanticRegex && !semanticRegex.test(text)) continue;
        return el;
      }
    }
    return null;
  }

  function clickElement(el, label, group) {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      log('clicked ' + label);
      emitAction(group || 'click', label);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getInput(fork) {
    const strictSelectors = [
      '.interactive-input-part textarea',
      '.chat-input-widget textarea',
      '[data-testid*="chat" i] textarea',
      '[data-testid*="composer" i] textarea',
      '[class*="composer" i] textarea',
      '.interactive-input-part [contenteditable="true"]',
      '.chat-input-widget [contenteditable="true"]',
      '[data-testid*="chat" i] [contenteditable="true"]',
      '[data-testid*="composer" i] [contenteditable="true"]',
      '[class*="composer" i] [contenteditable="true"]'
    ].join(',');

    const broadSelectors = [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
      'textarea',
      '[contenteditable="true"]'
    ].join(',');

    const strictMatches = queryAllDeep(strictSelectors);
    for (const el of strictMatches) {
      if (!isVisible(el) || !isSafeSurface(el)) continue;
      if (!isChatSurface(el) || isTerminalSurface(el)) continue;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        return el;
      }
    }

    const all = queryAllDeep(broadSelectors);
    for (const el of all) {
      if (!isVisible(el) || !isSafeSurface(el)) continue;
      if (!isChatSurface(el) || isTerminalSurface(el)) continue;
      const normalized = normalizeText(el);
      if (/(terminal|shell|debug console)/i.test(normalized)) continue;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
        return el;
      }
    }

    if (fork === 'antigravity') {
      for (const el of all) {
        if (!isVisible(el) || !isSafeSurface(el)) continue;
        if (isTerminalSurface(el)) continue;
        const normalized = normalizeText(el);
        if (/(terminal|shell|debug console)/i.test(normalized)) continue;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          return el;
        }
      }
    }

    return null;
  }

  function typeText(input, text) {
    if (!input) return false;
    try {
      input.focus();
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try {
          document.execCommand('insertText', false, text);
        } catch (e) {
          input.textContent = text;
        }
      } else {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter && (input.tagName || '').toLowerCase() === 'textarea') {
          setter.call(input, text);
        } else {
          input.value = text;
        }
      }
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      // Intentionally do not emit backend 'type' fallback actions here.
      // The frontend typed successfully already; emitting fallback signals can
      // trigger noisy/unsafe backend handling loops.
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeSubmitFromInput(input, fork) {
    if (!input) return false;
    if (isTerminalSurface(input)) return false;
    if (fork !== 'antigravity' && !isChatSurface(input)) return false;
    try {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      emitAction('submit', 'enter key');
      return true;
    } catch (e) {
      return false;
    }
  }

  function readState(fork) {
    const stopIndicators = queryAllDeep('[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator');
    const isGenerating = stopIndicators.some(isVisible);
    const input = getInput(fork);

    const actionSignals = targetSelectorsForFork(fork);
    const requireChatSurface = fork !== 'antigravity';
    const runVisible = !!findClickable(actionSignals.run, /(run|execute)/i, { requireChatSurface, allowNonChatFallback: true });
    const expandVisible = !!findClickable(actionSignals.expand, /(expand|requires input)/i, { requireChatSurface, allowNonChatFallback: true });
    const submitVisible = !!findClickable(actionSignals.submit, /(send|submit|continue)/i, { requireChatSurface, allowNonChatFallback: true });

    const hash = [isGenerating ? '1' : '0', !!input ? '1' : '0', runVisible ? '1' : '0', expandVisible ? '1' : '0', submitVisible ? '1' : '0'].join('|');
    if (hash !== lastStateHash) {
      lastStateHash = hash;
      lastUserVisibleChangeAt = Date.now();
    }

    return {
      isGenerating,
      hasInput: !!input,
      runVisible,
      expandVisible,
      submitVisible,
      stalledMs: Date.now() - lastUserVisibleChangeAt
    };
  }

  function shouldAct(cfg) {
    if (cfg.runtime?.isLeader !== true) return false;
    if (cfg.bump?.requireVisible !== false && document.visibilityState !== 'visible') return false;
    if (cfg.bump?.requireFocused !== false) {
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
        return false;
      }
    }
    return true;
  }

  function tryButtons(cfg, fork) {
    const actions = targetSelectorsForFork(fork);
    const enabled = cfg.actions || {};

    const ordered = [
      { key: 'clickExpand', label: 'Expand', group: 'expand', selectors: actions.expand, re: /(expand|requires input)/i },
      { key: 'clickRun', label: 'Run', group: 'run', selectors: actions.run, re: /(run|execute|run in terminal)/i },
      { key: 'clickAcceptAll', label: 'Accept All', group: 'accept-all', selectors: actions.acceptAll, re: /(accept all|apply all|keep all)/i },
      { key: 'clickKeep', label: 'Keep', group: 'continue', selectors: actions.keep, re: /\bkeep\b/i },
      { key: 'clickAlwaysAllow', label: 'Always Allow', group: 'accept', selectors: actions.alwaysAllow, re: /(always allow|always approve)/i },
      { key: 'clickRetry', label: 'Retry', group: 'continue', selectors: actions.retry, re: /\bretry\b/i },
      { key: 'clickAccept', label: 'Accept', group: 'accept', selectors: actions.accept, re: /\baccept\b/i },
      { key: 'clickEdit', label: 'Edit', group: 'click', selectors: actions.edit, re: /\bedit\b/i }
    ];

    const requireChatSurface = fork !== 'antigravity';
    for (const a of ordered) {
      if (!enabled[a.key]) continue;
      const el = findClickable(a.selectors, a.re, { requireChatSurface, allowNonChatFallback: true });
      if (el && clickElement(el, a.label, a.group)) return true;
    }
    return false;
  }

  function tryBump(cfg, fork, state) {
    if (!cfg.bump?.enabled) return false;
    if (state.isGenerating) return false;
    if (!state.hasInput) return false;
    if (state.stalledMs < Math.max(1000, cfg.timing?.stalledMs || 7000)) return false;
    const bumpCooldownMs = Math.max(1000, cfg.timing?.bumpCooldownMs || 12000);
    if ((Date.now() - lastBumpAt) < bumpCooldownMs) return false;
    const submitCooldownMs = Math.max(500, cfg.timing?.submitCooldownMs || 4000);
    if (Date.now() < submitInFlightUntil) return false;

    const text = String(cfg.bump?.text || 'Proceed').trim();
    if (!text) return false;

    const input = getInput(fork);
    if (!input) return false;
    if (!typeText(input, text)) return false;

    submitInFlightUntil = Date.now() + submitCooldownMs;

    const submit = () => {
      const submitSelectors = targetSelectorsForFork(fork).submit;
      const send = findClickable(submitSelectors, /(send|submit|continue)/i, { requireChatSurface: fork !== 'antigravity', allowNonChatFallback: true });
      if (send && clickElement(send, 'Submit bump text', 'submit')) {
        return;
      }
      const form = input.closest && input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit();
          emitAction('submit', 'form submit');
          return;
        } catch (e) {}
      }
      safeSubmitFromInput(input, fork);
    };

    setTimeout(submit, Math.max(60, cfg.bump?.submitDelayMs || 180));
    lastBumpAt = Date.now();
    return true;
  }

  function loop() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;

    try {
      window.__antigravityHeartbeat = Date.now();

      const cfg = getConfig();
      if (!shouldAct(cfg)) return;

      const now = Date.now();
      if ((now - lastActionAt) < Math.max(50, cfg.timing?.actionThrottleMs || 350)) return;

      const fork = detectFork();
      const state = readState(fork);
      window.__antigravityRuntimeState = { fork, ...state, ts: now };

      const clicked = tryButtons(cfg, fork);
      if (clicked) {
        lastActionAt = now;
        return;
      }

      const bumped = tryBump(cfg, fork, state);
      if (bumped) {
        lastActionAt = now;
      }
    } catch (e) {}
  }

  function schedule() {
    if (window.__antigravityActiveInstance !== THIS_INSTANCE) return;
    const cfg = getConfig();
    const pollMs = Math.max(150, cfg.timing?.pollIntervalMs || 700);
    pollTimer = setTimeout(function () {
      loop();
      schedule();
    }, pollMs);
  }

  window.__antigravityGetState = function () {
    return window.__antigravityRuntimeState || null;
  };

  window.__antigravityTypeAndSubmit = function (text) {
    const cfg = getConfig();
    if (!shouldAct(cfg)) return false;
    const submitCooldownMs = Math.max(500, cfg.timing?.submitCooldownMs || 4000);
    if (Date.now() < submitInFlightUntil) return false;
    const fork = detectFork();
    const input = getInput(fork);
    if (!input) return false;
    const typed = typeText(input, String(text || cfg.bump?.text || 'Proceed'));
    if (!typed) return false;
    submitInFlightUntil = Date.now() + submitCooldownMs;
    setTimeout(function () {
      const submitSelectors = targetSelectorsForFork(fork).submit;
      const send = findClickable(submitSelectors, /(send|submit|continue)/i, { requireChatSurface: fork !== 'antigravity', allowNonChatFallback: true });
      if (send && clickElement(send, 'Submit bump text', 'submit')) return;
      const form = input.closest && input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit();
          emitAction('submit', 'form submit');
          return;
        } catch (e) {}
      }
      safeSubmitFromInput(input, fork);
    }, Math.max(60, cfg.bump?.submitDelayMs || 180));
    return true;
  };

  window.stopAutoContinue = function () {
    if (pollTimer) clearTimeout(pollTimer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('auto-continue minimal core started');
  schedule();
})();
`;
