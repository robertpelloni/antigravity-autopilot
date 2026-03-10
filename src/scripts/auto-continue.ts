export const AUTO_CONTINUE_SCRIPT = `
(function() {
  if (window.__antigravityAutoContinueRunning && typeof window.stopAutoContinue === 'function') {
    try { window.stopAutoContinue(); } catch(e) {}
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

  var FORK_PROFILES = {
    antigravity: {
      inputSelectors: 'textarea,[contenteditable="true"],[role="textbox"],.interactive-input-part textarea,.chat-input-widget textarea',
      inputHint: /(chat|message|ask|prompt|composer|assistant|interactive|agent)/,
      sendSelectors: '[title*="Send" i],[aria-label*="Send" i],[title*="Submit" i],[aria-label*="Submit" i],.codicon-send,button[type="submit"]',
      waitPattern: /(waiting for input|requires input|continue generating|all tasks completed|task completed|done|finished|anything else\?)/i
    },
    cursor: {
      inputSelectors: 'textarea,[contenteditable="true"],[role="textbox"]',
      inputHint: /(chat|message|ask|prompt|composer|assistant|anysphere)/,
      sendSelectors: '[title*="Send" i],[aria-label*="Send" i],button[type="submit"]',
      waitPattern: /(waiting for input|requires input|done|finished|anything else\?)/i
    },
    vscode: {
      inputSelectors: 'textarea,[contenteditable="true"],[role="textbox"],.interactive-input-part textarea,.chat-input-widget textarea',
      inputHint: /(chat|message|ask|prompt|composer|assistant|copilot|interactive)/,
      sendSelectors: '[title*="Send" i],[aria-label*="Send" i],[aria-keyshortcuts*="Enter" i],button[type="submit"]',
      waitPattern: /(waiting for input|requires input|done|finished|anything else\?)/i
    }
  };

  // ── Bridge ──
  function emit(s) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(s);
      else console.log(s);
    } catch(e) {}
  }
  function log(m) { emit('__AUTOPILOT_LOG__:' + m); }
  function emitAction(group, detail) { emit('__AUTOPILOT_ACTION__:' + group + '|' + detail); }

  function detectFork() {
    var t = String(document.title || '').toLowerCase();
    var u = String(location.href || '').toLowerCase();
    if (t.indexOf('antigravity') >= 0 || u.indexOf('antigravity') >= 0) return 'antigravity';
    if (t.indexOf('cursor') >= 0 || u.indexOf('cursor') >= 0) return 'cursor';
    return 'vscode';
  }

  // ── Deep Query (traverses shadow DOM) ──
  function q(sel, root) {
    var out = [], seen = new Set();
    (function visit(n) {
      if (!n || !n.querySelectorAll) return;
      try { var ls = n.querySelectorAll(sel); for(var i=0;i<ls.length;i++) if(!seen.has(ls[i])){seen.add(ls[i]);out.push(ls[i]);} } catch(e){}
      try { var all = n.querySelectorAll('*'); for(var j=0;j<all.length;j++) try{if(all[j].shadowRoot)visit(all[j].shadowRoot);}catch(e){} } catch(e){}
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
    try { return !!el.closest('.part.titlebar,.part.activitybar,.part.statusbar,.menubar,.terminal-instance,.xterm,[class*="terminal" i],.settings-editor,.extensions-viewlet'); } catch(e){ return false; }
  }

  function center(el) {
    var r = el.getBoundingClientRect();
    return [Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)];
  }

  // ── DOM click (works for Electron buttons, does NOT work for Monaco text input) ──
  function domClick(el, label) {
    if (!el) return false;
    try {
      try { el.focus({preventScroll:true}); } catch(e){}
      try { el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'mouse',isPrimary:true})); } catch(e){}
      try { el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerType:'mouse',isPrimary:true})); } catch(e){}
      try { el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); } catch(e){}
      try { el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true})); } catch(e){}
      try { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); } catch(e){}
      try { if (typeof el.click === 'function') el.click(); } catch(e){}
      log('clicked ' + label);
      emitAction('click', label);
      return true;
    } catch(e) { return false; }
  }

  // ── Word-boundary-aware matching (avoids template literal \\b escaping issues) ──
  function hasWord(text, word) {
    var i = text.indexOf(word);
    while (i >= 0) {
      var before = i > 0 ? text[i-1] : ' ';
      var after = i+word.length < text.length ? text[i+word.length] : ' ';
      if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
      i = text.indexOf(word, i+1);
    }
    return false;
  }

  // ── Button action specs (longer phrases checked FIRST to avoid substring false-positives) ──
  var ACTIONS = [
    ['clickRun',        ['run in terminal','run command','execute','run']],
    ['clickExpand',     ['expand','requires input','step requires input']],
    ['clickAlwaysAllow',['always allow','always approve']],
    ['clickRetry',      ['retry','try again']],
    ['clickAcceptAll',  ['accept all changes','apply all changes','accept all','apply all']],
    ['clickKeep',       ['keep']],
    ['clickProceed',    ['proceed','continue']],
    ['clickAllow',      ['allow']]
  ];

  function matchAction(text) {
    for (var i=0; i<ACTIONS.length; i++) {
      var words = ACTIONS[i][1];
      for (var j=0; j<words.length; j++) {
        if (hasWord(text, words[j])) return ACTIONS[i][0];
      }
    }
    return null;
  }

  // ── Generating detector ──
  function isGenerating() {
    var els = q('.codicon-loading,.typing-indicator,[title*="Stop" i],[aria-label*="Stop" i]');
    for (var i=0; i<els.length; i++) {
      var el = els[i].closest ? (els[i].closest('button,[role="button"]') || els[i]) : els[i];
      if (vis(el) && !blocked(el)) return true;
    }
    return false;
  }

  // ── Stalled signal detector (thumbs up/down = Roo/Cline complete) ──
  function stalledSignal(fork) {
    var profile = FORK_PROFILES[fork] || FORK_PROFILES.vscode;

    var thumbs = q('.codicon-thumbsup,.codicon-thumbsdown,[class*="thumbsup" i],[class*="thumbsdown" i]');
    for (var i=0; i<thumbs.length; i++) {
      var el = thumbs[i].closest ? (thumbs[i].closest('button,[role="button"]') || thumbs[i]) : thumbs[i];
      if (vis(el) && !blocked(el)) return true;
    }

    var texts = q('.chat-body,.message-body,.chat-message,[data-testid*="message" i],.monaco-list-row,p,span.message');
    for (var j=0; j<texts.length; j++) {
      var n = texts[j];
      if (!vis(n)) continue;
      var txt = String(n.textContent || '').replace(/\s+/g,' ').trim();
      if (txt.length > 0 && txt.length < 400 && profile.waitPattern.test(txt)) return true;
    }

    return false;
  }

  // ── Find chat input and focus it ──
  function focusChatInput(fork) {
    var profile = FORK_PROFILES[fork] || FORK_PROFILES.vscode;
    var els = q(profile.inputSelectors);
    for (var i=0; i<els.length; i++) {
      var el = els[i];
      if (!vis(el) || blocked(el)) continue;
      var sig = [el.getAttribute('aria-label')||'',el.getAttribute('placeholder')||'',el.className||'',el.id||''].join(' ').toLowerCase();
      if (profile.inputHint.test(sig)) { try{el.focus();}catch(e){} return el; }
      if (el.closest && el.closest('[class*="chat" i],[class*="composer" i],.interactive-input-part,.chat-input-widget')) { try{el.focus();}catch(e){} return el; }
    }
    return null;
  }

  function typeBumpDom(input, text) {
    try {
      if (!input) return false;
      if (typeof input.focus === 'function') input.focus();
      if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
        try { document.execCommand('selectAll', false, null); } catch(e) {}
        try { document.execCommand('insertText', false, text); } catch(e) { input.textContent = text; }
      } else {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set && String(input.tagName || '').toLowerCase() === 'textarea') setter.set.call(input, text);
        else input.value = text;
        try { input.dispatchEvent(new Event('input', { bubbles:true, cancelable:true })); } catch(e) {}
      }
      try { input.dispatchEvent(new Event('change', { bubbles:true, cancelable:true })); } catch(e) {}
      return true;
    } catch(e) { return false; }
  }

  function submitBump(input, fork, bumpText) {
    var profile = FORK_PROFILES[fork] || FORK_PROFILES.vscode;
    var scope = (input && input.closest && input.closest('form,.interactive-input-part,[class*="chat-input" i]')) || document;
    var send = q(profile.sendSelectors, scope);

    for (var i=0; i<send.length; i++) {
      var el = send[i].closest ? (send[i].closest('button,[role="button"],a') || send[i]) : send[i];
      if (vis(el) && !blocked(el) && domClick(el, 'submit')) return true;
    }

    try {
      if (input && typeof input.focus === 'function') input.focus();
      var combos = [{altKey:true},{ctrlKey:true},{metaKey:true},{}];
      for (var j=0; j<combos.length; j++) {
        var m = combos[j];
        var args = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, cancelable:true };
        for (var k in m) args[k] = m[k];
        input.dispatchEvent(new KeyboardEvent('keydown', args));
        input.dispatchEvent(new KeyboardEvent('keyup', args));
      }
      emitAction('submit', 'alt-ctrl-meta-enter');
    } catch(e) {}

    emit('__AUTOPILOT_HYBRID_BUMP__:' + bumpText);
    return true;
  }

  // ── Main Loop ──
  // Buttons: clicked via DOM (works in Electron)
  // Typing/submitting: done via CDP bridge (only way that works for Monaco inputs)
  function run() {
    if (window.__antigravityActiveInstance !== ID) return;
    window.__antigravityHeartbeat = Date.now();
    var now = Date.now();
    var cfg = window.__antigravityConfig || {};
    var timing = cfg.timing || {};
    var fork = detectFork();
    var actionThrottleMs = Number(timing.actionThrottleMs) || 300;

    if ((now - lastClickAt) < actionThrottleMs) return;

    // === PHASE 1: Click actionable buttons via DOM ===
    var btns = q('button,[role="button"],a,.monaco-button');
    for (var i=0; i<btns.length; i++) {
      var btn = btns[i];
      if (!vis(btn) || blocked(btn)) continue;
      var text = [btn.textContent||'',btn.getAttribute('aria-label')||'',btn.getAttribute('title')||''].join(' ').replace(/\\s+/g,' ').trim().toLowerCase();
      if (text.length > 120) continue;
      var action = matchAction(text);
      if (action) {
        domClick(btn, action);
        lastClickAt = now;
        lastProgressAt = now;
        return;
      }
    }

    // === PHASE 2: Track generating state ===
    var gen = isGenerating();
    if (gen || wasGenerating) lastProgressAt = now;
    wasGenerating = gen;

    // === PHASE 3: Stalled detection, emit state, request bump ===
    var stalledMs = Number(timing.stalledMs) || 7000;
    var stalled = !gen && (now - lastProgressAt) >= stalledMs;
    var waiting = stalledSignal(fork) || (!gen && (now - lastProgressAt) >= stalledMs * 1.5);

    window.__antigravityRuntimeState = {
      fork: fork,
      mode: fork,
      status: gen ? 'processing' : (stalled && waiting ? 'waiting_for_chat_message' : 'idle'),
      waitingForChatMessage: stalled && waiting,
      completeStopSignal: stalled && waiting,
      hasInput: true,
      isGenerating: gen,
      stalled: stalled,
      timestamp: now
    };

    if (!stalled || !waiting || gen) return;
    var bumpCfg = cfg.bump || {};
    if (bumpCfg.enabled === false) return;
    var bumpText = bumpCfg.text || 'Proceed';
    var cooldown = Number(timing.bumpCooldownMs) || 30000;
    if ((now - lastBumpAt) < cooldown) return;

    // Focus input via DOM (best effort), then request CDP typing
    var input = focusChatInput(fork);
    setTimeout(function() {
      if (window.__antigravityActiveInstance !== ID) return;
      var typed = typeBumpDom(input, bumpText);
      submitBump(input, fork, bumpText);
      log('bump: ' + bumpText + ' typed=' + (typed ? 'yes' : 'no'));
    }, 300);
    lastBumpAt = now;
    lastClickAt = now;
    lastProgressAt = now;
  }

  function loop() {
    if (window.__antigravityActiveInstance !== ID) return;
    var ms = Number((window.__antigravityConfig||{}).timing && (window.__antigravityConfig||{}).timing.pollIntervalMs) || 800;
    timer = setTimeout(function() {
      try { run(); } catch(e) { log('err:' + (e.message||e)); }
      loop();
    }, Math.max(200, ms));
  }

  window.__antigravityGetState = function() { return window.__antigravityRuntimeState || null; };
  window.stopAutoContinue = function() { if(timer)clearTimeout(timer); window.__antigravityAutoContinueRunning=false; };

  log('sensor started');
  try { run(); } catch(e) { log('init:' + (e.message||e)); }
  loop();
})();
`;
