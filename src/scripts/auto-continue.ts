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

  // ── Bridge ──
  function emit(s) {
    try {
      if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') window.__AUTOPILOT_BRIDGE__(s);
      else console.log(s);
    } catch(e) {}
  }
  function log(m) { emit('__AUTOPILOT_LOG__:' + m); }

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
    var cfg = window.__antigravityConfig || {};
    var actions = cfg.actions || {};
    for (var i=0; i<ACTIONS.length; i++) {
      if (actions[ACTIONS[i][0]] === false) continue;
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
  function stalledSignal() {
    var thumbs = q('.codicon-thumbsup,.codicon-thumbsdown,[class*="thumbsup" i],[class*="thumbsdown" i]');
    for (var i=0; i<thumbs.length; i++) {
      var el = thumbs[i].closest ? (thumbs[i].closest('button,[role="button"]') || thumbs[i]) : thumbs[i];
      if (vis(el) && !blocked(el)) return true;
    }
    return false;
  }

  // ── Find chat input and focus it ──
  function focusChatInput() {
    var els = q('textarea,[contenteditable="true"],[role="textbox"]');
    for (var i=0; i<els.length; i++) {
      var el = els[i];
      if (!vis(el) || blocked(el)) continue;
      var sig = [el.getAttribute('aria-label')||'',el.getAttribute('placeholder')||'',el.className||'',el.id||''].join(' ').toLowerCase();
      if (/(chat|message|ask|prompt|composer|copilot|assistant|interactive)/.test(sig)) { try{el.focus();}catch(e){} return el; }
      if (el.closest && el.closest('[class*="chat" i],[class*="composer" i],.interactive-input-part,.chat-input-widget')) { try{el.focus();}catch(e){} return el; }
    }
    // Fallback: first visible textarea
    for (var j=0; j<els.length; j++) {
      if (vis(els[j]) && !blocked(els[j]) && (els[j].tagName||'').toLowerCase()==='textarea') { try{els[j].focus();}catch(e){} return els[j]; }
    }
    return null;
  }

  // ── Main Loop: SENSOR ONLY ──
  // Detects state and emits bridge messages. ALL actions (clicking, typing, submitting)
  // are performed by the Node.js CDP handler using native CDP Input commands.
  function run() {
    if (window.__antigravityActiveInstance !== ID) return;
    window.__antigravityHeartbeat = Date.now();
    var now = Date.now();
    var cfg = window.__antigravityConfig || {};
    var timing = cfg.timing || {};

    if ((now - lastClickAt) < 300) return;

    // === PHASE 1: Find actionable buttons, request CDP click at their coordinates ===
    var btns = q('button,[role="button"],a,.monaco-button');
    for (var i=0; i<btns.length; i++) {
      var btn = btns[i];
      if (!vis(btn) || blocked(btn)) continue;
      var text = [btn.textContent||'',btn.getAttribute('aria-label')||'',btn.getAttribute('title')||''].join(' ').replace(/\\s+/g,' ').trim().toLowerCase();
      if (text.length > 80) continue;
      var action = matchAction(text);
      if (action) {
        var c = center(btn);
        emit('__AUTOPILOT_CLICK__:' + c[0] + ',' + c[1] + ',' + action);
        log('click ' + action + ' @' + c[0] + ',' + c[1]);
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
    var waiting = stalledSignal() || (!gen && (now - lastProgressAt) >= stalledMs * 1.5);

    window.__antigravityRuntimeState = {
      status: gen ? 'processing' : (stalled && waiting ? 'waiting_for_chat_message' : 'idle'),
      waitingForChatMessage: stalled && waiting,
      isGenerating: gen, stalled: stalled, timestamp: now
    };

    if (!stalled || !waiting || gen) return;
    var bumpCfg = cfg.bump || {};
    if (bumpCfg.enabled === false) return;
    var bumpText = bumpCfg.text || 'Proceed';
    var cooldown = Number(timing.bumpCooldownMs) || 30000;
    if ((now - lastBumpAt) < cooldown) return;

    // Focus input via DOM (best effort), then request CDP bump
    var input = focusChatInput();
    if (input) {
      var ic = center(input);
      emit('__AUTOPILOT_CLICK__:' + ic[0] + ',' + ic[1] + ',focusInput');
    }
    // Short delay so focus click settles before typing
    setTimeout(function() {
      if (window.__antigravityActiveInstance !== ID) return;
      emit('__AUTOPILOT_HYBRID_BUMP__:' + bumpText);
      log('bump: ' + bumpText);
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
