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
    runtime: { isLeader: false, role: 'follower', windowFocused: true, enforceLeader: false },
    bump: {
      text: 'Proceed',
      enabled: true,
      requireFocused: false,
      requireVisible: true,
      submitDelayMs: 180,
      sessionOpenGraceMs: 12000
    },
    timing: {
      pollIntervalMs: 450,
      actionThrottleMs: 220,
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
      clickKeep: true,
      clickSubmit: true
    }
  };

  let pollTimer = null;
  let lastActionAt = 0;
  let lastBumpAt = 0;
  let submitInFlightUntil = 0;
  let lastUserVisibleChangeAt = Date.now();
  const scriptStartedAt = Date.now();
  let lastStateHash = '';
  const lastButtonActionAt = Object.create(null);

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

  function detectFork(cfg) {
    const configuredMode = String(cfg?.runtime?.mode || '').toLowerCase();
    if (configuredMode === 'antigravity' || configuredMode === 'cursor' || configuredMode === 'vscode') {
      return configuredMode;
    }

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
      '.chat-editing-session-container',
      '.aichat-container',
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

  function isEditorLikeSurface(el) {
    if (!el || !el.closest) return false;
    const editorRoots = [
      '.monaco-editor',
      '.view-lines',
      '.inputarea',
      '.code-editor',
      '[data-testid*="editor" i]',
      '[class*="editor" i]'
    ].join(',');
    try {
      return !!el.closest(editorRoots);
    } catch (e) {
      return false;
    }
  }

  function hasNearbySubmitControl(input, fork) {
    if (!input) return false;
    const submitSelectors = targetSelectorsForFork(fork).submit.join(',');
    const roots = [
      input.closest && input.closest('form'),
      input.closest && input.closest('[class*="chat" i], [class*="composer" i], .chat-editing-session-container, .aichat-container'),
      input.parentElement,
      input
    ].filter(Boolean);

    for (const root of roots) {
      const matches = queryAllDeep(submitSelectors, root);
      for (const el of matches) {
        const node = el.closest ? (el.closest('button, a, [role="button"], .monaco-button') || el) : el;
        if (!isVisible(node) || !isSafeSurface(node)) continue;
        if (isTerminalSurface(node)) continue;
        return true;
      }
    }

    return false;
  }

  function findSubmitNearInput(input, fork) {
    if (!input) return null;
    const submitSelectors = targetSelectorsForFork(fork).submit;
    const roots = [
      input.closest && input.closest('form'),
      input.closest && input.closest('[class*="chat" i], [class*="composer" i], .chat-editing-session-container, .aichat-container'),
      input.parentElement,
      input
    ].filter(Boolean);

    for (const root of roots) {
      const joined = submitSelectors.join(',');
      const matches = queryAllDeep(joined, root);
      for (const el of matches) {
        const node = el.closest ? (el.closest('button, a, [role="button"], .monaco-button') || el) : el;
        if (!isVisible(node) || !isSafeSurface(node)) continue;
        if (isTerminalSurface(node)) continue;
        return node;
      }
    }

    return null;
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
        '[title*="Run" i]', '[aria-label*="Run" i]',
        '[title*="Execute" i]', '[aria-label*="Execute" i]',
        '[data-testid*="run" i]', '[data-testid*="execute" i]',
        '[class*="run-action" i]',
        '.codicon-play', '.codicon-run'
      ],
      expand: [
        '[title*="Expand" i]', '[aria-label*="Expand" i]',
        '[title*="requires input" i]', '[aria-label*="requires input" i]',
        '[title*="1 Step Requires Input" i]', '[aria-label*="1 Step Requires Input" i]',
        '[data-testid*="expand" i]', '[data-testid*="requires-input" i]'
        , '.codicon-chevron-right', '.monaco-tl-twistie'
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
      keep: [
        '[title="Keep" i]', '[aria-label="Keep" i]',
        '[title*="Keep" i]', '[aria-label*="Keep" i]',
        '[data-testid*="keep" i]'
      ],
      submit: [
        '[title*="Send" i]', '[aria-label*="Send" i]',
        '[aria-label*="Send message" i]',
        '[title*="Submit" i]', '[aria-label*="Submit" i]',
        '[data-testid*="send" i]', '[data-testid*="submit" i]',
        'button[type="submit"]', '.codicon-send'
      ],
      feedback: [
        '[aria-label*="thumbs up" i]', '[title*="thumbs up" i]',
        '[aria-label*="thumbs down" i]', '[title*="thumbs down" i]',
        '[aria-label*="good response" i]', '[title*="good response" i]',
        '[aria-label*="bad response" i]', '[title*="bad response" i]',
        '[data-testid*="thumbs-up" i]', '[data-testid*="thumbs-down" i]',
        '[data-icon*="thumb" i]', '.codicon-thumbsup', '.codicon-thumbsdown'
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

  function findClickables(selectors, semanticRegex, options, maxResults) {
    const opts = options || {};
    const joined = selectors.join(',');
    const candidates = queryAllDeep(joined);
    const out = [];
    const seen = new Set();
    const limit = Math.max(1, Number(maxResults || 6));

    const pushCandidate = function (el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      out.push(el);
    };

    const matchesSemantic = function (el) {
      if (!semanticRegex) return true;
      const text = normalizeText(el);
      return semanticRegex.test(text);
    };

    const findSemanticFallback = function (requireChat) {
      const pool = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]');
      for (const node of pool) {
        const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
        if (!isVisible(el) || !isSafeSurface(el)) continue;
        if (requireChat && !isChatSurface(el)) continue;
        if (isTerminalSurface(el)) continue;
        if (!matchesSemantic(el)) continue;
        pushCandidate(el);
        if (out.length >= limit) return;
      }
    };

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
        if (!matchesSemantic(el)) continue;
        pushCandidate(el);
        if (out.length >= limit) return out;
      }

      findSemanticFallback(requireChat);
      if (out.length >= limit) return out;
    }
    return out;
  }

  function findClickable(selectors, semanticRegex, options) {
    const all = findClickables(selectors, semanticRegex, options, 1);
    return all.length > 0 ? all[0] : null;
  }

  function expandStateSnapshot(el) {
    if (!el) return { visible: false, expanded: null, text: '' };
    const expandedAttr = (el.getAttribute && el.getAttribute('aria-expanded')) || null;
    return {
      visible: isVisible(el),
      expanded: expandedAttr,
      text: normalizeText(el)
    };
  }

  function didExpandStateAdvance(before, after) {
    if (!after.visible) return true;
    if (before.expanded === 'false' && after.expanded === 'true') return true;
    if (/\bexpand\b|requires\s*input|step\s*requires\s*input/i.test(before.text) && /\bcollapse\b|expanded|show\s*less/i.test(after.text)) return true;
    if (/\bexpand\b|requires\s*input|step\s*requires\s*input/i.test(before.text) && !/\bexpand\b|requires\s*input|step\s*requires\s*input/i.test(after.text)) return true;
    return false;
  }

  function clickElement(el, label, group, actionKey) {
    if (!el) return false;
    try {
      const beforeExpand = actionKey === 'clickExpand' ? expandStateSnapshot(el) : null;
      if (typeof el.focus === 'function') {
        try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
      }
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true }));
      } catch (e) {}
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      if (typeof el.click === 'function') {
        try { el.click(); } catch (e) {}
      }

      if (actionKey === 'clickExpand') {
        const afterExpand = expandStateSnapshot(el);
        if (!didExpandStateAdvance(beforeExpand, afterExpand)) {
          log('expand click had no visible effect; trying next candidate');
          return false;
        }
      }

      log('clicked ' + label);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getActionCooldownMs(actionKey) {
    switch (String(actionKey || '')) {
      case 'clickExpand':
        return 8000;
      case 'clickRun':
        return 5000;
      case 'clickAcceptAll':
      case 'clickKeep':
      case 'clickAlwaysAllow':
      case 'clickRetry':
        return 2500;
      default:
        return 1200;
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
      if (isTerminalSurface(el)) continue;
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      if (!isEditable) continue;
      if (isChatSurface(el) || hasNearbySubmitControl(el, fork)) {
        return el;
      }
    }

    const all = queryAllDeep(broadSelectors);
    for (const el of all) {
      if (!isVisible(el) || !isSafeSurface(el)) continue;
      if (isTerminalSurface(el)) continue;
      const normalized = normalizeText(el);
      if (/(terminal|shell|debug console)/i.test(normalized)) continue;
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      if (!isEditable) continue;
      if (isChatSurface(el) || hasNearbySubmitControl(el, fork)) {
        return el;
      }
    }

    // Cross-fork safe fallback: allow visible editable with a nearby submit control,
    // even when host-specific chat-root heuristics fail.
    for (const el of all) {
      if (!isVisible(el) || !isSafeSurface(el)) continue;
      if (isTerminalSurface(el)) continue;
      const normalized = normalizeText(el);
      if (/(terminal|shell|debug console)/i.test(normalized)) continue;
      const tag = (el.tagName || '').toLowerCase();
      const isEditable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      if (!isEditable) continue;
      if (hasNearbySubmitControl(el, fork)) return el;
    }

    // Last-resort fallback remains Antigravity-only to avoid unsafe typing in other hosts.
    if (fork === 'antigravity') {
      for (const el of all) {
        if (!isVisible(el) || !isSafeSurface(el)) continue;
        if (isTerminalSurface(el)) continue;
        const normalized = normalizeText(el);
        if (/(terminal|shell|debug console)/i.test(normalized)) continue;
        const tag = (el.tagName || '').toLowerCase();
        const isEditable = tag === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        if (isEditable) return el;
      }
    }

    return null;
  }

  function findActionByLabel(labelRegex, requireChatSurface) {
    const pool = queryAllDeep('button, [role="button"], a, .monaco-button, [aria-label], [title], [data-testid]');
    for (const node of pool) {
      const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
      if (!isVisible(el) || !isSafeSurface(el)) continue;
      if (isTerminalSurface(el)) continue;
      if (requireChatSurface && !isChatSurface(el)) continue;
      const text = normalizeText(el);
      if (!labelRegex.test(text)) continue;
      return el;
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
    if (!isChatSurface(input) && !hasNearbySubmitControl(input, fork)) return false;
    try {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        altKey: true,
        bubbles: true,
        cancelable: true
      }));
      input.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        altKey: true,
        bubbles: true,
        cancelable: true
      }));
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
    const runVisible = !!findClickable(actionSignals.run, /(run|execute)/i, { requireChatSurface: true, allowNonChatFallback: true });
    const expandVisible = !!findClickable(actionSignals.expand, /(expand|requires input)/i, { requireChatSurface: true, allowNonChatFallback: true });
    const submitVisible = !!findClickable(actionSignals.submit, /(send|submit|continue)/i, { requireChatSurface: true, allowNonChatFallback: false });
    const feedbackVisible = queryAllDeep(actionSignals.feedback.join(',')).some(function (node) {
      const el = node.closest ? (node.closest('button, a, [role="button"], .monaco-button') || node) : node;
      return isVisible(el) && isSafeSurface(el) && !isTerminalSurface(el);
    });

    const completionTextSeen = queryAllDeep('[role="article"], .chat-turn, .message, .markdown-body, [data-testid*="message" i], [class*="chat" i], [class*="message" i], [class*="response" i]').some(function (el) {
      if (!isVisible(el)) return false;
      const text = normalizeText(el);
      return /(all tasks? (are )?completed|completed all tasks|task(s)? completed|implementation (is )?complete|done for now|ready for next task|waiting for (your|user) input|waiting for your next message|ready when you are|task complete|completed)/i.test(text);
    });

    const bodyText = ((document.body && document.body.innerText) ? document.body.innerText : '').toLowerCase();
    const waitingTextSeen = /(waiting for your message|waiting for user message|reactivate|start a new message|chat session (is )?complete|task complete|resume conversation|send a message|continue the conversation|ready for your next request)/i.test(bodyText);

    const sessionJustOpened = (Date.now() - scriptStartedAt) <= Math.max(2000, Number((getConfig().bump || {}).sessionOpenGraceMs || 12000));
    const chatNotActive = !isGenerating;
    const bumpEligibleSignal = chatNotActive && (feedbackVisible || completionTextSeen || waitingTextSeen || submitVisible || sessionJustOpened);

    const hash = [isGenerating ? '1' : '0', !!input ? '1' : '0', runVisible ? '1' : '0', expandVisible ? '1' : '0', submitVisible ? '1' : '0', feedbackVisible ? '1' : '0', completionTextSeen ? '1' : '0', waitingTextSeen ? '1' : '0'].join('|');
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
      feedbackVisible,
      completionTextSeen,
      waitingTextSeen,
      sessionJustOpened,
      chatNotActive,
      bumpEligibleSignal,
      stalledMs: Date.now() - lastUserVisibleChangeAt
    };
  }

  function shouldAct(cfg) {
    if (cfg.bump?.requireVisible !== false && document.visibilityState !== 'visible') return false;
    if (cfg.runtime?.enforceLeader === true && cfg.runtime?.isLeader !== true) return false;
    if (cfg.bump?.requireFocused === true) {
      const docFocused = (typeof document.hasFocus !== 'function') || document.hasFocus();
      const hostFocused = cfg.runtime?.windowFocused === true;
      if (!docFocused && !hostFocused) {
        return false;
      }
    }
    return true;
  }

  function tryButtons(cfg, fork, state) {
    const actions = targetSelectorsForFork(fork);
    const enabled = cfg.actions || {};
    const now = Date.now();

    const ordered = [
      { key: 'clickAcceptAll', label: 'Accept All', group: 'accept-all', selectors: actions.acceptAll, re: /(accept\s*all|apply\s*all|allow\s*all|keep\s*all)/i, allowNonChatFallback: true },
      { key: 'clickKeep', label: 'Keep', group: 'continue', selectors: actions.keep, re: /\bkeep\b/i, allowNonChatFallback: true },
      { key: 'clickAlwaysAllow', label: 'Always Allow', group: 'accept', selectors: actions.alwaysAllow, re: /(always\s*allow|always\s*approve)/i, allowNonChatFallback: true },
      { key: 'clickRetry', label: 'Retry', group: 'continue', selectors: actions.retry, re: /\bretry\b/i, allowNonChatFallback: true }
      ,{ key: 'clickExpand', label: 'Expand', group: 'expand', selectors: actions.expand, re: /(expand|requires\s*input|step\s*requires\s*input)/i, allowNonChatFallback: true }
      ,{ key: 'clickRun', label: 'Run', group: 'run', selectors: actions.run, re: /(^|\b)(run(\s+in\s+terminal|\s+command)?|execute)(\b|$)/i, allowNonChatFallback: true }
    ];

    for (const a of ordered) {
      if (!enabled[a.key]) continue;
      const lastAt = Number(lastButtonActionAt[a.key] || 0);
      const cooldownMs = getActionCooldownMs(a.key);
      if (lastAt > 0 && (now - lastAt) < cooldownMs) {
        continue;
      }
      const candidates = [];
      const labelFirst = findActionByLabel(a.re, true) || (a.allowNonChatFallback ? findActionByLabel(a.re, false) : null);
      if (labelFirst) candidates.push(labelFirst);
      const discovered = findClickables(a.selectors, a.re, { requireChatSurface: true, allowNonChatFallback: !!a.allowNonChatFallback }, 8);
      for (const c of discovered) {
        if (!candidates.includes(c)) candidates.push(c);
      }

      for (const el of candidates) {
        if (clickElement(el, a.label, a.group, a.key)) {
          lastButtonActionAt[a.key] = now;
          return true;
        }
      }
    }
    return false;
  }

  function tryBump(cfg, fork, state) {
    if (!cfg.bump?.enabled) return false;
    if (state.isGenerating) return false;
    if (!state.hasInput) return false;
    if (!state.bumpEligibleSignal) return false;

    const stalledThreshold = Math.max(1000, cfg.timing?.stalledMs || 7000);
    const shouldBumpNow = !!(state.sessionJustOpened || state.feedbackVisible || state.completionTextSeen || state.waitingTextSeen || state.submitVisible || state.stalledMs >= stalledThreshold);
    if (!shouldBumpNow) return false;

    const bumpCooldownMs = Math.max(1000, cfg.timing?.bumpCooldownMs || 12000);
    if ((Date.now() - lastBumpAt) < bumpCooldownMs) return false;
    const submitCooldownMs = Math.max(500, cfg.timing?.submitCooldownMs || 4000);
    if (Date.now() < submitInFlightUntil) return false;

    const text = String(cfg.bump?.text || 'Proceed').trim();
    if (!text) return false;

    const input = getInput(fork);
    if (!input) return false;

    const currentValue = (function () {
      try {
        if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
          return String(input.textContent || '').trim();
        }
        return String(input.value || '').trim();
      } catch (e) {
        return '';
      }
    })();

    if (currentValue && currentValue !== text) {
      return false;
    }

    if (!typeText(input, text)) return false;

    submitInFlightUntil = Date.now() + submitCooldownMs;

    const submit = () => {
      const send = findSubmitNearInput(input, fork)
        || findClickable(targetSelectorsForFork(fork).submit, /(send|submit|continue)/i, { requireChatSurface: true, allowNonChatFallback: false });
      if (send && clickElement(send, 'Submit bump text', 'submit')) {
        return;
      }
      const form = input.closest && input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit();
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

      const fork = detectFork(cfg);
      const state = readState(fork);
      window.__antigravityRuntimeState = { fork, ...state, ts: now };

      const bumped = tryBump(cfg, fork, state);
      if (bumped) {
        lastActionAt = now;
        return;
      }

      const clicked = tryButtons(cfg, fork, state);
      if (clicked) {
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
    const fork = detectFork(cfg);
    const input = getInput(fork);
    if (!input) return false;
    const typed = typeText(input, String(text || cfg.bump?.text || 'Proceed'));
    if (!typed) return false;
    submitInFlightUntil = Date.now() + submitCooldownMs;
    setTimeout(function () {
      const send = findSubmitNearInput(input, fork)
        || findClickable(targetSelectorsForFork(fork).submit, /(send|submit|continue)/i, { requireChatSurface: true, allowNonChatFallback: false });
      if (send && clickElement(send, 'Submit bump text', 'submit')) return;
      const form = input.closest && input.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit();
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
