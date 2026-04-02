export const AUTO_CONTINUE_SCRIPT = `
(function() {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch (e) {}
  }

  var ID = Math.random().toString(36).slice(2);
  window.__antigravityActiveInstance = ID;
  window.__antigravityAutoContinueRunning = true;
  window.__antigravityHeartbeat = Date.now();

  var lastClickAt = 0;
  var lastBumpAt = 0;
  var lastProgressAt = Date.now();
  var wasGenerating = false;
  var timer = null;
  var lastDiagAt = 0;
  var diagIntervalMs = 10000;

  var FORK_PROFILES = {
    antigravity: {
      chatSelectors: '.interactive-input-part,.chat-input-widget,.interactive-editor,.chat-editing-session-container,.aichat-container,[data-testid*="chat" i],[data-testid*="composer" i],[class*="chat" i],[class*="composer" i],[class*="interactive" i],[class*="agent" i],[class*="launchpad" i]',
      waitPattern: /(waiting for input|requires input|continue generating|all tasks completed|task completed|done|finished|anything else\?|review changes|ready to continue)/i,
      actionAllow: {
        clickRun: true,
        clickExpand: true,
        clickRetry: true,
        clickProceed: true,
        clickAcceptAll: true,
        clickAllow: true,
        clickAlwaysAllow: true
      }
    },
    cursor: {
      chatSelectors: '.interactive-input-part,.chat-input-widget,[data-testid*="chat" i],[data-testid*="composer" i],[class*="chat" i],[class*="composer" i],[class*="interactive" i],[class*="anysphere" i]',
      waitPattern: /(waiting for input|requires input|done|finished|anything else\?|ready to continue)/i,
      actionAllow: {
        clickKeep: true,
        clickProceed: true,
        clickRetry: true,
        clickAcceptAll: true,
        clickAllow: true,
        clickAlwaysAllow: true,
        clickExpand: true,
        clickRun: true
      }
    },
    vscode: {
      chatSelectors: '.interactive-input-part,.chat-input-widget,.interactive-editor,.chat-editing-session-container,.aichat-container,[data-testid*="chat" i],[data-testid*="composer" i],[class*="chat" i],[class*="composer" i],[class*="interactive" i],[class*="copilot" i]',
      waitPattern: /(waiting for input|requires input|done|finished|anything else\?|ready to continue)/i,
      actionAllow: {
        clickKeep: true,
        clickAllow: true,
        clickAlwaysAllow: true
      }
    }
  };

  var ACTIONS = [
    ['clickAlwaysAllow', ['always allow', 'always approve']],
    ['clickAcceptAll', ['accept all changes', 'apply all changes', 'accept all', 'apply all', 'accept']],
    ['clickExpand', ['step requires input', 'requires input', 'expand']],
    ['clickRun', ['run in terminal', 'run command', 'execute command', 'execute', 'run', 'run this']],
    ['clickRetry', ['retry', 'try again']],
    ['clickKeep', ['keep']],
    ['clickProceed', ['proceed', 'continue']],
    ['clickAllow', ['allow once', 'allow']]
  ];

  function emit(s) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(s);
      else console.log(s);
    } catch (e) {}
  }

  function log(m) { emit('__AUTOPILOT_LOG__:' + m); }
  function emitAction(group, detail) { emit('__AUTOPILOT_ACTION__:' + group + '|' + detail); }

  function detectFork() {
    var cfgMode = String(window.__antigravityConfig && window.__antigravityConfig.runtime && window.__antigravityConfig.runtime.mode || '').toLowerCase();
    if (cfgMode === 'antigravity' || cfgMode === 'cursor' || cfgMode === 'vscode') return cfgMode;

    var t = String(document.title || '').toLowerCase();
    var u = String(location.href || '').toLowerCase();
    if (t.indexOf('antigravity') >= 0 || u.indexOf('antigravity') >= 0 || t.indexOf('launchpad') >= 0) return 'antigravity';
    if (t.indexOf('cursor') >= 0 || u.indexOf('cursor') >= 0 || t.indexOf('anysphere') >= 0) return 'cursor';
    return 'vscode';
  }

  function profileFor(fork) {
    return FORK_PROFILES[fork] || FORK_PROFILES.vscode;
  }

  function q(sel, root) {
    var out = [], seen = new Set();
    (function visit(n) {
      if (!n || !n.querySelectorAll) return;
      try {
        var ls = n.querySelectorAll(sel);
        for (var i = 0; i < ls.length; i++) if (!seen.has(ls[i])) { seen.add(ls[i]); out.push(ls[i]); }
      } catch (e) {}
      try {
        var all = n.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) try { if (all[j].shadowRoot) visit(all[j].shadowRoot); } catch (e) {}
      } catch (e) {}
    })(root || document);
    return out;
  }

  function vis(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
  }

  function blocked(el) {
    if (!el || !el.closest) return false;
    try {
      return !!el.closest('.part.titlebar,.part.activitybar,.part.statusbar,.part.sidebar,.pane-header,.panel-header,.view-pane-header,.tabs-and-actions-container,.menubar,.terminal-instance,.xterm,[class*="terminal" i],.settings-editor,.extensions-viewlet,.search-view,.search-widget,.search-editor,.quick-input-widget,[role="menu"],[role="menuitem"],[role="tab"],[role="tablist"]');
    } catch (e) { return false; }
  }

  function buttonish(el) {
    if (!el || !el.getAttribute) return false;
    var tag = String(el.tagName || '').toLowerCase();
    var role = String(el.getAttribute('role') || '').toLowerCase();
    var cls = String(el.className || '').toLowerCase();
    return tag === 'button' || role === 'button' || cls.indexOf('monaco-button') >= 0;
  }

  function cleanText(text) {
    return String(text || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function controlText(el) {
    if (!el) return '';
    return cleanText([el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || ''].join(' '));
  }

  function controlLabel(el) {
    if (!el) return '';
    var attrs = [el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.innerText || el.textContent || ''];
    for (var i = 0; i < attrs.length; i++) {
      var text = cleanText(attrs[i]);
      if (text && text.length <= 80) return text;
    }
    return '';
  }

  function chatSurface(el, fork) {
    if (!el || blocked(el)) return false;
    var profile = profileFor(fork);
    try {
      if (el.closest(profile.chatSelectors)) return true;
    } catch (e) {}

    var owner = null;
    try { owner = el.closest('[id],[class],[data-testid],[aria-label],[title]'); } catch (e) {}
    var hint = cleanText([
      el.id || '',
      el.className || '',
      el.getAttribute && el.getAttribute('data-testid') || '',
      el.getAttribute && el.getAttribute('aria-label') || '',
      el.getAttribute && el.getAttribute('title') || '',
      el.getAttribute && el.getAttribute('placeholder') || '',
      owner ? (owner.outerHTML || '') : ''
    ].join(' '));

    if (/extensions?-viewlet|marketplace|extension search|search extensions|quick input|command palette|output panel|debug console|problems panel/.test(hint)) return false;
    return true; // Broader acceptance of any visible button not explicitly blocked
  }

  function domClick(el, label) {
    if (!el) return false;
    try {
      try { if (typeof el.click === 'function') el.click(); } catch (e) {}
      log('clicked ' + label);
      emitAction('click', label);
      return true;
    } catch (e) { return false; }
  }

  function hasWord(text, word) {
    var i = text.indexOf(word);
    while (i >= 0) {
      var before = i > 0 ? text[i - 1] : ' ';
      var after = i + word.length < text.length ? text[i + word.length] : ' ';
      if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
      i = text.indexOf(word, i + 1);
    }
    return false;
  }

  function exactActionLabel(action, label) {
    if (!label) return false;
    if (action === 'clickKeep') return /^keep(?:\s*[!.?])?$/.test(label);
    if (action === 'clickRun') return /^(run|run in terminal|run command|execute|execute command|run this)$/.test(label);
    if (action === 'clickExpand') return /^(expand|requires input|step requires input)$/.test(label);
    if (action === 'clickRetry') return /^(retry|try again)$/.test(label);
    if (action === 'clickProceed') return /^(proceed|continue)$/.test(label);
    if (action === 'clickAllow') return /^(allow|allow once)$/.test(label);
    if (action === 'clickAlwaysAllow') return /^(always allow|always approve)$/.test(label);
    if (action === 'clickAcceptAll') return /^(accept all changes|apply all changes|accept all|apply all|accept)$/.test(label);
    return false;
  }

  function allowAction(el, action, label, text, fork) {
    var profile = profileFor(fork);
    if (!el || !action || !profile.actionAllow[action]) return false;
    if (blocked(el) || !buttonish(el) || !chatSurface(el, fork)) return false;

    if (action === 'clickKeep') {
      try {
        if (el.closest('.search-view,.search-widget,.quick-input-widget,.extensions-viewlet,[role="menu"],[role="menuitem"]')) return false;
      } catch (e) {}
      return exactActionLabel(action, label);
    }

    if (exactActionLabel(action, label)) return true;
    if ((action === 'clickRun' || action === 'clickExpand') && text.length > 80) return false;
    return false;
  }

  function matchAction(el, text, label, fork) {
    for (var i = 0; i < ACTIONS.length; i++) {
      var action = ACTIONS[i][0];
      var words = ACTIONS[i][1];
      for (var j = 0; j < words.length; j++) {
        if (hasWord(text, words[j]) && allowAction(el, action, label, text, fork)) return action;
      }
    }
    return null;
  }

  function visibleActionNames(fork) {
    var names = [];
    var btns = q('button,[role="button"],.monaco-button,a');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (!vis(btn) || blocked(btn)) continue;
      var text = controlText(btn);
      var label = controlLabel(btn);
      if (!text || text.length > 120) continue;
      var action = matchAction(btn, text, label, fork);
      if (action && names.indexOf(action) < 0) names.push(action);
    }
    return names;
  }

  function isGenerating(fork) {
    var els = q('.codicon-loading,.typing-indicator,[title*="Stop" i],[aria-label*="Stop" i]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i].closest ? (els[i].closest('button,[role="button"]') || els[i]) : els[i];
      if (vis(el) && !blocked(el) && chatSurface(el, fork)) return true;
    }
    return false;
  }

  function thumbsSignal(fork) {
    var thumbs = q('.codicon-thumbsup,.codicon-thumbsdown,[class*="thumbsup" i],[class*="thumbsdown" i],[aria-label*="thumbs up" i],[aria-label*="thumbs down" i]');
    for (var i = 0; i < thumbs.length; i++) {
      var el = thumbs[i].closest ? (thumbs[i].closest('button,[role="button"]') || thumbs[i]) : thumbs[i];
      if (vis(el) && !blocked(el) && chatSurface(el, fork)) return true;
    }
    return false;
  }

  function proceedSignal(fork) {
    var btns = q('button,[role="button"],.monaco-button,a');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (!vis(btn) || blocked(btn) || !buttonish(btn) || !chatSurface(btn, fork)) continue;
      var label = controlLabel(btn);
      if (exactActionLabel('clickProceed', label)) return true;
    }
    return false;
  }

  function textWaitingSignal(fork) {
    var profile = profileFor(fork);
    var texts = q('.chat-body,.message-body,.chat-message,[data-testid*="message" i],.monaco-list-row,p,span.message,[class*="message" i]');
    for (var i = 0; i < texts.length; i++) {
      var n = texts[i];
      if (!vis(n) || !chatSurface(n, fork)) continue;
      var txt = cleanText(n.textContent || '');
      if (txt.length > 0 && txt.length < 400 && profile.waitPattern.test(txt)) return true;
    }
    return false;
  }

  function stalledSignal(fork) {
    var actions = visibleActionNames(fork);
    var hasThumbs = thumbsSignal(fork);
    var hasProceed = proceedSignal(fork);
    var hasText = textWaitingSignal(fork);

    return actions.indexOf('clickExpand') >= 0
      || actions.indexOf('clickRun') >= 0
      || actions.indexOf('clickRetry') >= 0
      || actions.indexOf('clickProceed') >= 0
      || actions.indexOf('clickAcceptAll') >= 0
      || actions.indexOf('clickAllow') >= 0
      || actions.indexOf('clickAlwaysAllow') >= 0
      || actions.indexOf('clickKeep') >= 0
      || hasText
      || hasThumbs
      || hasProceed;
  }

  function shouldRunAutomation(cfg) {
    var runtime = cfg.runtime || {};
    if (runtime.enforceLeader && runtime.isLeader !== true) return false;
    return true;
  }

  function findChatInput(fork) {
    var els = q('textarea,[contenteditable="true"],[role="textbox"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!vis(el) || blocked(el)) continue;
      if (chatSurface(el, fork)) return el;
    }
    for (var j = 0; j < els.length; j++) {
      if (vis(els[j]) && !blocked(els[j]) && (els[j].tagName||'').toLowerCase()==='textarea') {
        return els[j];
      }
    }
    return null;
  }

  function run() {
    if (window.__antigravityActiveInstance !== ID) return;
    window.__antigravityHeartbeat = Date.now();

    var now = Date.now();
    var cfg = window.__antigravityConfig || {};
    var timing = cfg.timing || {};
    var fork = detectFork();
    var actionThrottleMs = Math.max(1500, Number(timing.actionThrottleMs) || 2500);
    var stalledMs = Math.max(4000, Number(timing.stalledMs) || 7000);
    var waiting = stalledSignal(fork);
    var gen = isGenerating(fork);
    var stalled = !gen && ((now - lastProgressAt) >= stalledMs || waiting);
    var actions = visibleActionNames(fork);

    if (gen || !waiting) lastProgressAt = now;
    wasGenerating = gen;

    if (shouldRunAutomation(cfg) && actions.length > 0 && (now - lastClickAt) >= actionThrottleMs) {
      var btns = q('button,[role="button"],.monaco-button,a');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        if (!vis(btn) || blocked(btn)) continue;
        var text = controlText(btn);
        var label = controlLabel(btn);
        if (!text || text.length > 120) continue;
        var action = matchAction(btn, text, label, fork);
        if (!action) continue;
        if (domClick(btn, action)) {
          lastClickAt = now;
          break;
        }
      }
    }

    window.__antigravityRuntimeState = {
      fork: fork,
      mode: fork,
      status: gen ? 'processing' : (stalled && waiting ? 'waiting_for_chat_message' : 'idle'),
      waitingForChatMessage: stalled && waiting,
      completeStopSignal: waiting,
      hasInput: true,
      isGenerating: gen,
      stalled: stalled,
      visibleActions: actions,
      hasThumbsStopSignal: thumbsSignal(fork),
      hasProceedStopSignal: proceedSignal(fork),
      timestamp: now
    };

    // === BUMP TEXT (REMOVED) ===
    // We no longer send typed "Proceed" messages since typing via CDP Input steals focus 
    // and causes the "Ghost Typing" and "ProceedProceed" bugs.
    // Automation now purely relies on DOM button clicking (Run, Continue, Expand, etc).

    // === DIAGNOSTIC DUMP (every 10s) ===
    if ((now - lastDiagAt) >= diagIntervalMs) {
      lastDiagAt = now;
      var canAct = shouldRunAutomation(cfg);
      var runtime = cfg.runtime || {};
      log('DIAG fork=' + fork
        + ' gen=' + gen
        + ' stalled=' + stalled
        + ' waiting=' + waiting
        + ' actions=[' + actions.join(',') + ']'
        + ' canAct=' + canAct
        + ' isLeader=' + (runtime.isLeader === true)
        + ' enforceLeader=' + (!!runtime.enforceLeader)
        + ' throttleOk=' + ((now - lastClickAt) >= actionThrottleMs)
        + ' bumpCooldownOk=' + ((now - lastBumpAt) >= Math.max(5000, Number(timing.bumpCooldownMs) || 30000))
        + ' progressAge=' + (now - lastProgressAt) + 'ms'
      );
    }
  }

  function loop() {
    if (window.__antigravityActiveInstance !== ID) return;
    var ms = Math.max(500, Number((window.__antigravityConfig || {}).timing && (window.__antigravityConfig || {}).timing.pollIntervalMs) || 1000);
    timer = setTimeout(function() {
      try { run(); } catch (e) { log('err:' + (e.message || e)); }
      loop();
    }, ms);
  }

  window.__antigravityGetState = function() { return window.__antigravityRuntimeState || null; };
  window.stopAutoContinue = function() {
    if (timer) clearTimeout(timer);
    window.__antigravityAutoContinueRunning = false;
  };

  log('sensor started fork=' + detectFork());
  try { run(); } catch (e) { log('init:' + (e.message || e)); }
  loop();
})();
`;
