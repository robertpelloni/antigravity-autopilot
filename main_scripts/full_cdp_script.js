
(function () {
    "use strict";

    if (typeof window === 'undefined') return;

    const Analytics = (function () {

        const TERMINAL_KEYWORDS = ['run', 'execute', 'command', 'terminal'];
        // ============================================================================
        const ANTIGRAVITY_VERSION = '6.2.9';
        // ============================================================================
        const SECONDS_PER_CLICK = 5;
        const TIME_VARIANCE = 0.2;

        const ActionType = {
            FILE_EDIT: 'file_edit',
            TERMINAL_COMMAND: 'terminal_command'
        };

        function createDefaultStats() {
            return {
                clicksThisSession: 0,
                blockedThisSession: 0,
                sessionStartTime: null,
                fileEditsThisSession: 0,
                terminalCommandsThisSession: 0,
                actionsWhileAway: 0,
                isWindowFocused: true,
                lastConversationUrl: null,
                lastConversationStats: null
            };
        }

        function getStats() {
            return window.__autopilotState?.stats || createDefaultStats();
        }

        function getStatsMutable() {
            return window.__autopilotState.stats;
        }

        function categorizeClick(buttonText) {
            const text = (buttonText || '').toLowerCase();
            for (const keyword of TERMINAL_KEYWORDS) {
                if (text.includes(keyword)) return ActionType.TERMINAL_COMMAND;
            }
            return ActionType.FILE_EDIT;
        }

        function trackClick(buttonText, log) {
            const stats = getStatsMutable();
            stats.clicksThisSession++;
            log(`[Stats] Click tracked. Total: ${stats.clicksThisSession}`);

            const category = categorizeClick(buttonText);
            if (category === ActionType.TERMINAL_COMMAND) {
                stats.terminalCommandsThisSession++;
                log(`[Stats] Terminal command. Total: ${stats.terminalCommandsThisSession}`);
            } else {
                stats.fileEditsThisSession++;
                log(`[Stats] File edit. Total: ${stats.fileEditsThisSession}`);
            }

            let isAway = false;
            if (!stats.isWindowFocused) {
                stats.actionsWhileAway++;
                isAway = true;
                log(`[Stats] Away action. Total away: ${stats.actionsWhileAway}`);
            }

            return { category, isAway, totalClicks: stats.clicksThisSession };
        }

        function trackBlocked(log) {
            const stats = getStatsMutable();
            stats.blockedThisSession++;
            log(`[Stats] Blocked. Total: ${stats.blockedThisSession}`);
        }

        function collectROI(log) {
            const stats = getStatsMutable();
            const collected = {
                clicks: stats.clicksThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                sessionStart: stats.sessionStartTime
            };
            log(`[ROI] Collected: ${collected.clicks} clicks, ${collected.blocked} blocked`);
            stats.clicksThisSession = 0;
            stats.blockedThisSession = 0;
            stats.sessionStartTime = Date.now();
            return collected;
        }

        function getSessionSummary() {
            const stats = getStats();
            const clicks = stats.clicksThisSession || 0;
            const baseSecs = clicks * SECONDS_PER_CLICK;
            const minMins = Math.max(1, Math.floor((baseSecs * (1 - TIME_VARIANCE)) / 60));
            const maxMins = Math.ceil((baseSecs * (1 + TIME_VARIANCE)) / 60);

            return {
                clicks,
                fileEdits: stats.fileEditsThisSession || 0,
                terminalCommands: stats.terminalCommandsThisSession || 0,
                blocked: stats.blockedThisSession || 0,
                estimatedTimeSaved: clicks > 0 ? `${minMins}–${maxMins} minutes` : null
            };
        }

        function consumeAwayActions(log) {
            const stats = getStatsMutable();
            const count = stats.actionsWhileAway || 0;
            log(`[Away] Consuming away actions: ${count}`);
            stats.actionsWhileAway = 0;
            return count;
        }

        function isUserAway() {
            return !getStats().isWindowFocused;
        }

        function initializeFocusState(log) {
            const state = window.__autopilotState;
            if (state && state.stats) {

                state.stats.isWindowFocused = true;
                log('[Focus] Initialized (awaiting extension sync)');
            }
        }

        function initialize(log) {
            if (!window.__autopilotState) {
                window.__autopilotState = {
                    isRunning: false,
                    tabNames: [],
                    completionStatus: {},
                    sessionID: 0,
                    currentMode: null,
                    startTimes: {},
                    bannedCommands: [],
                    isPro: false,
                    isPro: false,
                    stats: createDefaultStats(),
                    // User Configs
                    threadWaitInterval: 5000,
                    autoApproveDelay: 30000,
                    bumpMessage: 'bump'
                };
                log('[Analytics] State initialized');
            } else if (!window.__autopilotState.stats) {
                window.__autopilotState.stats = createDefaultStats();
                log('[Analytics] Stats added to existing state');
            } else {
                const s = window.__autopilotState.stats;
                if (s.actionsWhileAway === undefined) s.actionsWhileAway = 0;
                if (s.isWindowFocused === undefined) s.isWindowFocused = true;
                if (s.fileEditsThisSession === undefined) s.fileEditsThisSession = 0;
                if (s.terminalCommandsThisSession === undefined) s.terminalCommandsThisSession = 0;
            }

            initializeFocusState(log);

            if (!window.__autopilotState.stats.sessionStartTime) {
                window.__autopilotState.stats.sessionStartTime = Date.now();
            }

            log('[Analytics] Initialized');

            // Phase 39: Manual Trigger API
            window.__autopilotState.forceSubmit = async function () {
                log(`[ForceSubmit] Triggering direct DOM submission...`);
                const profile = getCurrentMode();
                const sendSelectors = getUnifiedSendButtonSelectors(profile);
                const sendEl = findVisibleElementBySelectors(sendSelectors);
                if (sendEl) {
                    log(`[ForceSubmit] Found send button, executing robust click...`);
                    await remoteClick(sendEl);
                    return true;
                }

                // Fallback to keyboard
                const inputSelectors = getUnifiedTextInputSelectors(profile);
                const inputEl = findVisibleElementBySelectors(inputSelectors);
                if (inputEl) {
                    log(`[ForceSubmit] Send button missing, trying keyboard shortcut fallback...`);
                    return await submitWithKeys(inputEl);
                }
                return false;
            };

            window.__autopilotState.forceAction = async function (action) {
                log(`[ForceAction] Received manual trigger: ${action}`);
                const mode = getCurrentMode();
                if (mode === 'antigravity' && (action === 'run' || action === 'expand')) {
                    bumpSafetyCounter('blockedForceActionAg');
                    log(`[ForceAction] AG mode: blocked forceAction(${action}) for safety.`);
                    return false;
                }
                let selectors = [];
                if (action === 'run') selectors = ['[title*="Run in Terminal"]', '[aria-label*="Run in Terminal"]', '[title*="Run command"]', '[aria-label*="Run command"]', '[title*="Execute command"]', '[aria-label*="Execute command"]'];
                else if (action === 'expand') selectors = ['[title*="Expand"]', '[aria-label*="Expand"]'];
                else if (action === 'accept') selectors = ['[title*="Accept"]', '[aria-label*="Accept"]', '[title*="Apply"]', '[aria-label*="Apply"]', '[title*="Insert"]', '[aria-label*="Insert"]', '.codicon-check', '.codicon-diff-insert', '.start-inline-chat-button'];

                if (selectors.length > 0) {
                    await performClick(selectors);
                    return true;
                }
                return false;
            };

            window.__autopilotState.forceSubmit = async function () {
                log('[ForceSubmit] Attempting to click submit button...');
                const selectors = ['[title*="Send"]', '[aria-label*="Send"]', '.codicon-send', 'button[aria-label="Send"]'];
                await performClick(selectors);
                return true;
            };
        }


        function setFocusState(isFocused, log) {
            const state = window.__autopilotState;
            if (!state || !state.stats) return;

            const wasAway = !state.stats.isWindowFocused;
            state.stats.isWindowFocused = isFocused;

            if (log) {
                log(`[Focus] Extension sync: focused=${isFocused}, wasAway=${wasAway}`);
            }
        }

        return {
            initialize,
            trackClick,
            trackBlocked,
            categorizeClick,
            ActionType,
            collectROI,
            getSessionSummary,
            consumeAwayActions,
            isUserAway,
            getStats,
            setFocusState
        };
    })();

    const log = (msg, isSuccess = false) => {
        const payload = `__AUTOPILOT_LOG__:${msg}`;
        if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
            window.__AUTOPILOT_BRIDGE__(payload);
        } else {
            console.log(`[autoAll] ${msg}`);
        }
    };

    function getSafetyCounters() {
        const state = window.__autopilotState || (window.__autopilotState = {});
        if (!state.safetyCounters || typeof state.safetyCounters !== 'object') {
            state.safetyCounters = {
                blockedForceActionAg: 0,
                blockedAgExpandPass: 0,
                blockedInvalidTarget: 0,
                blockedNonChatSurface: 0,
                blockedStuckKeypressFallback: 0
            };
        }
        return state.safetyCounters;
    }

    function bumpSafetyCounter(key) {
        const counters = getSafetyCounters();
        counters[key] = (counters[key] || 0) + 1;
    }

    Analytics.initialize(log);

    const timerWorkerCode = `
        self.onmessage = function(e) {
            setTimeout(function() {
                self.postMessage({ id: e.data.id });
            }, e.data.ms);
        };
    `;
    let timerWorker = null;
    let timerCallbacks = new Map();
    let timerId = 0;

    function getTimerWorker() {
        if (!timerWorker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
            try {
                const blob = new Blob([timerWorkerCode], { type: 'application/javascript' });
                timerWorker = new Worker(URL.createObjectURL(blob));
                timerWorker.onmessage = function (e) {
                    const cb = timerCallbacks.get(e.data.id);
                    if (cb) {
                        timerCallbacks.delete(e.data.id);
                        cb();
                    }
                };
                timerWorker.onerror = function (err) {
                    log('[Timer] Worker error, falling back to setTimeout');
                    timerWorker = null;
                };
                log('[Timer] Web Worker initialized for background operation');
            } catch (err) {
                log('[Timer] Web Worker not available, using setTimeout fallback');
            }
        }
        return timerWorker;
    }

    function workerDelay(ms) {
        return new Promise(function (resolve) {
            const worker = getTimerWorker();
            if (worker) {
                const id = ++timerId;
                timerCallbacks.set(id, resolve);
                worker.postMessage({ id: id, ms: ms });
            } else {

                setTimeout(resolve, ms);
            }
        });
    }

    const getDocuments = (root = document) => {
        let docs = [root];
        try {
            // Traverse Shadow DOM
            const traverse = (node) => {
                if (node.shadowRoot) {
                    docs.push(node.shadowRoot);
                    traverse(node.shadowRoot);
                }
                const children = node.children || node.querySelectorAll('*');
                for (const child of children) {
                    traverse(child);
                }
            };
            // traverse(root.body || root); // Can be expensive, but necessary for deep shadow roots
            // Optimized approach: Query all elements and check for shadowRoot
            const allElements = root.querySelectorAll('*');
            for (const el of allElements) {
                if (el.shadowRoot) {
                    docs.push(el.shadowRoot);
                    // Recursively get docs from shadow root
                    docs.push(...getDocuments(el.shadowRoot));
                }
            }

            // Traverse Iframes
            const iframes = root.querySelectorAll('iframe, frame');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) docs.push(...getDocuments(iframeDoc));
                } catch (e) { }
            }
        } catch (e) { }
        return docs;
    };

    const queryAll = (selector) => {
        const results = [];
        const bannedCache = new WeakSet();

        const isNodeBanned = (node) => {
            if (!node || node.nodeType !== 1) return false;
            if (bannedCache.has(node)) return true;

            const bannedIcons = '.codicon-plus, .codicon-attach, .codicon-paperclip, .codicon-add, [class*="codicon-layout"], .codicon-settings-gear, .codicon-gear';

            // Instantly ban dangerous context nodes
            if (node.matches(bannedIcons)) {
                bannedCache.add(node);
                return true;
            }

            // Check if it HAS dangerous children
            if (node.querySelector && node.querySelector(bannedIcons)) {
                bannedCache.add(node);
                return true;
            }

            // Text / Label checks (Extremely strict)
            const attrs = ((node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('title') || '') + ' ' + (node.textContent || '')).toLowerCase();
            if (/(customize layout|layout control|add context|attach context|attach a file|new chat|clear chat|clear session)/i.test(attrs)) {
                bannedCache.add(node);
                return true;
            }

            return false;
        };

        getDocuments().forEach(doc => {
            try {
                const nodes = Array.from(doc.querySelectorAll(selector));
                for (const node of nodes) {
                    if (!isNodeBanned(node)) {
                        results.push(node);
                    }
                }
            } catch (e) { }
        });
        return results;
    };

    const UI_SELECTORS = {
        shared: {
            click: [
                'button',
                '[class*="button"]',
                '.codicon-play',
                '.codicon-debug-start',
                '.codicon-run',
                '[aria-label*="Run"]',
                '[title*="Run"]',
                '[aria-label*="Accept"]',
                '[title*="Accept"]',
                '[aria-label*="Allow"]',
                '[title*="Allow"]',
                '[aria-label*="Accept (Limited)"]',
                '[title*="Accept (Limited)"]',
                '[aria-label*="Yes"]',
                '[title*="Yes"]',
                '[aria-label*="Continue"]',
                '[title*="Continue"]',
                '[aria-label*="Retry"]',
                '[title*="Retry"]',
                '[aria-label*="Always Approve"]',
                '[title*="Always Approve"]'
            ],
            sendButtons: [
                'button[aria-label*="Send"]',
                'button[title*="Send"]',
                '[aria-label*="Submit"]',
                '[title*="Submit"]',
                '.codicon-send',
                'button[data-testid*="send"]'
            ],
            textInputs: [
                'textarea[aria-label*="Chat"]',
                'textarea[placeholder*="message" i]',
                'textarea[placeholder*="chat" i]',
                'textarea[placeholder*="Ask" i]',
                '[contenteditable="true"][role="textbox"]'
            ],
            feedback: [
                '.codicon-thumbsup',
                'button[title*="Helpful"]',
                'button[aria-label*="Helpful"]',
                '.vote-up'
            ]
        },
        antigravity: {
            click: [
                'button[aria-label*="Run"]',
                'button[title*="Run"]',
                '[data-testid="accept-all"]',
                '[data-testid*="accept"]',
                'button[aria-label*="Accept"]',
                'button[title*="Accept"]',
                'button[aria-label*="Allow"]',
                'button[title*="Allow"]',
                'button[aria-label*="Continue"]',
                'button[title*="Continue"]',
                'button[aria-label*="Keep"]',
                'button[title*="Keep"]',
                'button[aria-label*="Retry"]',
                'button[title*="Retry"]',
                'button[aria-label*="Always Approve"]',
                'button[title*="Always Approve"]',
                '[data-testid*="always-approve" i]',
                '[data-testid*="always_approve" i]',
                '[data-testid*="approve-always" i]'
            ],
            sendButtons: [
                'button[aria-label*="Send"]',
                'button[title*="Send"]',
                'button[aria-label*="submit" i]'
            ],
            textInputs: [
                'textarea',
                '[contenteditable="true"]'
            ]
        },
        cursor: {
            click: [
                '#workbench\\.parts\\.auxiliarybar button',
                '[class*="anysphere"]'
            ],
            sendButtons: [
                '#workbench\\.parts\\.auxiliarybar button[aria-label*="Send"]',
                '#workbench\\.parts\\.auxiliarybar button[aria-label*="Submit"]',
                '.interactive-editor button[aria-label*="Send"]',
                '.interactive-editor button[aria-label*="Submit"]',
                '[class*="anysphere"] button[aria-label*="Submit"]'
            ],
            textInputs: [
                '#workbench\\.parts\\.auxiliarybar textarea',
                '.interactive-editor textarea',
                '.interactive-editor [contenteditable="true"]',
                '[class*="anysphere"] textarea'
            ]
        },
        vscode: {
            click: [
                '.monaco-dialog-box button',
                '.monaco-notification-list button',
                '.interactive-editor button',
                '.chat-input-container button'
            ],
            sendButtons: [
                '.interactive-editor button[aria-label*="Send"]',
                '.chat-input-container button[aria-label*="Send"]',
                '.chat-input-container button[title*="Send"]'
            ],
            textInputs: [
                '.interactive-editor textarea',
                '.chat-input-container textarea',
                '.chat-input-container [contenteditable="true"]'
            ]
        }
    };

    function getCurrentMode() {
        const mode = (window.__autopilotState?.currentMode || 'cursor').toLowerCase();
        if (mode === 'antigravity' || mode === 'cursor' || mode === 'vscode') return mode;
        return 'vscode';
    }

    function getRuntimeRole() {
        const fromState = String(window.__autopilotState?.controllerRole || '').toLowerCase();
        if (fromState === 'leader' || fromState === 'follower') return fromState;

        const fromConfig = window.__antigravityConfig?.runtime?.role;
        const normalizedConfig = String(fromConfig || '').toLowerCase();
        if (normalizedConfig === 'leader' || normalizedConfig === 'follower') return normalizedConfig;

        const fromLeaderFlag = window.__antigravityConfig?.runtime?.isLeader;
        if (fromLeaderFlag === true) return 'leader';
        if (fromLeaderFlag === false) return 'follower';

        return 'unknown';
    }

    function isInteractionWindowEligible() {
        const role = getRuntimeRole();
        if (role !== 'leader') {
            log(`[RoleGuard] non-leader runtime (${role}): interaction blocked`);
            return false;
        }

        if (document.visibilityState !== 'visible') {
            return false;
        }

        if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
            return false;
        }

        return true;
    }

    function mergeSelectorSets(mode, category) {
        const shared = (UI_SELECTORS.shared[category] || []).slice();
        const modeSpecific = (UI_SELECTORS[mode] && UI_SELECTORS[mode][category]) ? UI_SELECTORS[mode][category] : [];

        // Antigravity hardening: do not merge broad shared click selectors (e.g. generic button)
        // into Antigravity click scans. This prevents cross-targeting workbench chrome controls
        // such as Customize Layout / Run menu when both VS Code forks are open.
        if (mode === 'antigravity' && category === 'click') {
            return [...new Set([...modeSpecific])];
        }

        return [...new Set([...modeSpecific, ...shared])];
    }

    function getUnifiedClickSelectors(mode = getCurrentMode()) {
        return mergeSelectorSets(mode, 'click');
    }

    function getUnifiedSendButtonSelectors(mode = getCurrentMode()) {
        return mergeSelectorSets(mode, 'sendButtons');
    }

    function getUnifiedTextInputSelectors(mode = getCurrentMode()) {
        return mergeSelectorSets(mode, 'textInputs');
    }

    function getUnifiedFeedbackSelectors(mode = getCurrentMode()) {
        return mergeSelectorSets(mode, 'feedback');
    }

    function shadowClosest(el, selector) {
        let current = el;
        while (current) {
            if (current.nodeType === 1 && current.matches(selector)) return current;
            current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
        }
        return null;
    }

    function isValidInteractionTarget(el) {
        if (!el) return false;

        // 1. Check the element itself for unsafe text
        try {
            const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).toLowerCase();
            if (/(extension|marketplace|plugin|install|uninstall|customize layout|layout control|add context|attach context|attach a file|new chat|clear chat|clear session|view as|open in)/i.test(text)) {
                return false;
            }
        } catch (e) { }

        // 2. Descendant check for banned icons
        try {
            const bannedIcons = '[class*="codicon-settings-gear"], [class*="codicon-gear"], [class*="codicon-attach"], [class*="codicon-paperclip"], [class*="codicon-link"], [class*="codicon-layout"], [class*="codicon-clear-all"], [class*="codicon-trash"], [class*="codicon-add"], [class*="codicon-plus"], [class*="codicon-more"], [class*="codicon-history"]';
            if (el.matches(bannedIcons) || el.querySelector(bannedIcons)) {
                return false;
            }
        } catch (e) { }

        // 3. Walk up the tree and check all ancestors for unsafe attributes and banned classes
        let current = el;
        while (current) {
            if (current.nodeType === 1) { // ELEMENT_NODE
                // Text/Attribute bans on parents
                const attrs = ((current.getAttribute('aria-label') || '') + ' ' + (current.getAttribute('title') || '')).toLowerCase();
                if (/(customize layout|layout control|add context|attach context|new chat|clear chat|clear session)/i.test(attrs)) {
                    return false;
                }

                // Workbench Chrome Bans + Menus
                if (current.matches('.quick-input-widget, .monaco-quick-input-container, .suggest-widget, .rename-box, .settings-editor, .extensions-viewlet, [id*="workbench.view.extensions"], .pane-header, .panel-header, .view-pane-header, .title-actions, .tabs-and-actions-container, .part.activitybar, .part.statusbar, .part.titlebar, .panel-switcher-container, .monaco-panel .composite.title, .dialog-container, .notifications-toasts, .monaco-dialog-box, .monaco-menu, .monaco-menu-container, .menubar, .menubar-menu-button, [role="menu"], [role="menuitem"], [role="menubar"]')) {
                    return false;
                }
                if (current.getAttribute('role') === 'tab' || current.getAttribute('role') === 'tablist') {
                    return false;
                }

                // Icon Class Bans
                if (current.matches('.codicon-settings-gear, .codicon-attach, [class*="codicon-layout"], .codicon-clear-all, .codicon-trash, .codicon-add, .codicon-plus, .codicon-more, .codicon-history')) {
                    return false;
                }
            }
            current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
        }

        // 3. Global Workbench safety lock (Prevent clicking native IDE elements)
        if (window === window.top) {
            if (shadowClosest(el, '.monaco-workbench') && !shadowClosest(el, 'iframe, webview, .webview, #webview')) {
                return false;
            }
        }

        return true;
    }

    function isChatActionSurface(el) {
        if (!el) return false;

        const blockedShell = '.title-actions, .tabs-and-actions-container, .part.titlebar, .part.activitybar, .part.statusbar, .menubar, .menubar-menu-button, .monaco-menu, .monaco-menu-container, [role="menu"], [role="menuitem"], [role="menubar"]';
        const chatContainers = '.interactive-input-part, .chat-input-widget, .chat-row, .chat-list, [data-testid*="chat" i], [class*="chat" i], [class*="interactive" i], .monaco-list-row';

        let hasBlockedAncestor = false;
        let current = el;
        while (current) {
            if (current.nodeType === 1) {
                try {
                    if (current.matches(blockedShell)) {
                        hasBlockedAncestor = true;
                        break;
                    }
                } catch (e) { }
            }
            current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
        }

        if (hasBlockedAncestor) return false;

        current = el;
        while (current) {
            if (current.nodeType === 1) {
                try {
                    if (current.matches(chatContainers)) return true;
                } catch (e) { }
            }
            current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
        }

        return false;
    }

    function findVisibleElementBySelectors(selectors) {
        for (const selector of selectors) {
            const nodes = queryAll(selector);
            for (const node of nodes) {
                if (isElementVisible(node) && !node.disabled && isValidInteractionTarget(node)) {
                    return node;
                }
            }
        }
        return null;
    }

    function setInputValue(el, value) {
        if (!el) return false;
        try {
            el.focus();
            if (el.isContentEditable) {
                el.textContent = value;
            } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.focus();

                let nativeSetter = el.tagName === 'TEXTAREA'
                    ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
                    : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

                if (nativeSetter) {
                    nativeSetter.call(el, value);
                } else {
                    el.value = value;
                }
            } else {
                return false;
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            return false;
        }
    }

    function readComposerValue(target) {
        if (!target) return '';
        try {
            if (target.isContentEditable) return (target.textContent || '').trim();
            if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return (target.value || '').trim();
        } catch (e) { }
        return '';
    }

    async function submitWithKeys(targetOverride) {
        if (getCurrentMode() === 'antigravity') {
            log('[SubmitGuard] AG mode: keyboard submit fallback disabled for safety.');
            return false;
        }

        sendCommandToExtension('__AUTOPILOT_ACTION__:submit|keys');
        const target = targetOverride || document.querySelector('.monaco-editor textarea, [aria-label*="Chat Input"], .interactive-input-part textarea, [id*="chat-input"]');
        if (!target) return false;

        const beforeText = readComposerValue(target);
        if (!beforeText) return false;

        // CRITICAL FIX: Ensure the composer maintains explicit focus.
        // Unbound global Enter keys can trigger native VS Code commands (like "Customize Layout")
        // if the focus is accidentally trapped in the workbench chrome.
        if (document.activeElement !== target) {
            try { target.focus(); } catch (e) { }
            await workerDelay(50);
        }

        // NUCLEAR OPTION: If active element STILL isn't our target textarea, ATB (Abort The Board)
        // Never blindly fire KeyboardEvents if focus is captured by '.monaco-workbench'
        if (document.activeElement !== target) {
            log('[SubmitGuard] ABORT: Failed to acquire focus on Chat Input. Suppressing rogue Enter key dispatch.');
            return false;
        }

        const combos = [
            { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
            { key: 'Enter', code: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
            { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }
        ];

        let submitted = false;
        for (const combo of combos) {
            // Re-verify focus every loop iteration, as dispatching might trigger a blur
            if (document.activeElement !== target) break;

            try {
                /* NUKED KEYBOARDEVENT LOOP */
                await workerDelay(120);

                const afterText = readComposerValue(target);
                if (!afterText || afterText.length < beforeText.length) {
                    return true;
                }
            } catch (e) { }
        }

        return false;
    }

    function countPendingAcceptButtons(selectors) {
        let count = 0;
        const seen = new Set();

        for (const selector of selectors) {
            const nodes = queryAll(selector);
            for (const node of nodes) {
                if (seen.has(node)) continue;
                seen.add(node);
                if (isElementVisible(node) && isAcceptButton(node)) {
                    count++;
                }
            }
        }

        return count;
    }

    function getProfileCoverage(mode) {
        const clickSelectors = getUnifiedClickSelectors(mode);
        const sendSelectors = getUnifiedSendButtonSelectors(mode);
        const inputSelectors = getUnifiedTextInputSelectors(mode);

        return {
            mode,
            pendingAcceptButtons: countPendingAcceptButtons(clickSelectors),
            hasVisibleSendButton: !!findVisibleElementBySelectors(sendSelectors),
            hasVisibleInput: !!findVisibleElementBySelectors(inputSelectors)
        };
    }

    function collectButtonSignals() {
        const countVisible = (selectors) => {
            const arr = Array.isArray(selectors) ? selectors : [selectors];
            let count = 0;
            for (const sel of arr) {
                const nodes = queryAll(sel);
                for (const n of nodes) {
                    if (isElementVisible(n)) count += 1;
                }
            }
            return count;
        };

        return {
            acceptAll: countVisible(['[title*="Accept All"]', '[aria-label*="Accept All"]']),
            allow: countVisible(['[title*="Allow"]', '[aria-label*="Allow"]']),
            keep: countVisible(['[title="Keep"]', '[aria-label="Keep"]', 'button[title*="Keep"]', 'button[aria-label*="Keep"]']),
            retry: countVisible(['[title*="Retry"]', '[aria-label*="Retry"]', 'button[title*="Retry"]', 'button[aria-label*="Retry"]', '[data-testid*="retry" i]']),
            alwaysApprove: countVisible(['[title*="Always Approve"]', '[aria-label*="Always Approve"]', 'button[title*="Always Approve"]', 'button[aria-label*="Always Approve"]', '[data-testid*="always-approve" i]', '[data-testid*="always_approve" i]', '[data-testid*="approve-always" i]']),
            run: countVisible(['[title*="Run in Terminal"]', '[aria-label*="Run in Terminal"]', '.codicon-play', '.codicon-run']),
            expand: countVisible(['[title*="Expand"]', '[aria-label*="Expand"]', '.codicon-chevron-right', '.monaco-tl-twistie.collapsed']),
            continue: countVisible(['button[title*="Continue"]', 'button[aria-label*="Continue"]', '.action-label']),
            feedback: countVisible(['.codicon-thumbsup', '.codicon-thumbsdown', '[title*="Helpful"]', '[aria-label*="Helpful"]', '[title*="Good"]', '[title*="Bad"]']),
            send: countVisible(getUnifiedSendButtonSelectors(getCurrentMode())),
            input: countVisible(getUnifiedTextInputSelectors(getCurrentMode()))
        };
    }

    function getRuntimeStateSnapshot() {
        const state = window.__autopilotState || {};
        const mode = getCurrentMode();
        const runtimeRole = getRuntimeRole();
        const interactionEligible = isInteractionWindowEligible();
        const profileCoverage = {
            antigravity: getProfileCoverage('antigravity'),
            vscode: getProfileCoverage('vscode'),
            cursor: getProfileCoverage('cursor')
        };
        const safetyCounters = getSafetyCounters();
        const blockedUnsafeActionsTotal = Object.values(safetyCounters).reduce((sum, value) => {
            const n = Number(value || 0);
            return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        const activeCoverage = profileCoverage[mode] || getProfileCoverage(mode);
        const buttonSignals = collectButtonSignals();

        const pendingAcceptButtons = activeCoverage.pendingAcceptButtons;
        const hasVisibleSendButton = activeCoverage.hasVisibleSendButton;
        const hasVisibleInput = activeCoverage.hasVisibleInput;
        const isIdle = isConversationIdle();

        const tabNames = Array.isArray(state.tabNames) ? state.tabNames : [];
        const doneCount = tabNames.filter(name => state.completionStatus && state.completionStatus[name] === 'done').length;
        const totalTabs = tabNames.length;
        const allKnownTabsDone = totalTabs > 0 && doneCount === totalTabs;
        const noPendingActions = pendingAcceptButtons === 0;

        const allTasksCompleteByTabs = allKnownTabsDone && noPendingActions;
        const allTasksCompleteBySignals = noPendingActions && isIdle;
        const allTasksComplete = totalTabs > 0 ? allTasksCompleteByTabs : allTasksCompleteBySignals;
        const waitingForChatMessage = !!state.isRunning && allTasksComplete && isIdle && (hasVisibleInput || hasVisibleSendButton);

        const completionReasons = [];
        if (!state.isRunning) completionReasons.push('automation not running');
        if (pendingAcceptButtons > 0) completionReasons.push(`${pendingAcceptButtons} pending accept action(s)`);
        if (totalTabs > 0 && !allKnownTabsDone) completionReasons.push(`tab completion ${doneCount}/${totalTabs}`);
        if (!isIdle) completionReasons.push('conversation not idle yet');
        if (allTasksComplete && !waitingForChatMessage) completionReasons.push('completion detected but input/send signal missing');
        if (waitingForChatMessage) completionReasons.push('all tasks complete and waiting for chat resume');

        let completionConfidence = 0;
        if (!!state.isRunning) completionConfidence += 10;
        if (allTasksCompleteByTabs) completionConfidence += 35;
        if (allTasksCompleteBySignals) completionConfidence += 20;
        if (isIdle) completionConfidence += 20;
        if (hasVisibleInput || hasVisibleSendButton) completionConfidence += 15;
        if (completionConfidence > 100) completionConfidence = 100;

        let completionConfidenceLabel = 'low';
        if (completionConfidence >= 80) completionConfidenceLabel = 'high';
        else if (completionConfidence >= 55) completionConfidenceLabel = 'medium';

        const readyToResume = !!state.isRunning && waitingForChatMessage;
        let recommendedAction = 'Continue monitoring runtime state.';
        if (readyToResume) {
            recommendedAction = 'Safe to send a resume message and continue development.';
        } else if (!state.isRunning) {
            recommendedAction = 'Start Auto-All/CDP automation to produce runtime completion signals.';
        } else if (pendingAcceptButtons > 0) {
            recommendedAction = 'Process pending accept actions before attempting resume.';
        } else if (!isIdle) {
            recommendedAction = 'Wait for conversation idle feedback signals before resuming.';
        } else if (!(hasVisibleInput || hasVisibleSendButton)) {
            recommendedAction = 'Open/focus chat input so waiting-for-message state can be confirmed.';
        }

        let status = 'processing';
        if (!state.isRunning) status = 'stopped';
        else if (pendingAcceptButtons > 0) status = 'pending_accept_actions';
        else if (waitingForChatMessage) status = 'waiting_for_chat_message';
        else if (allTasksComplete) status = 'all_tasks_complete';
        else if (isIdle) status = 'idle';

        return {
            status,
            mode,
            runtimeRole,
            interactionEligible,
            isRunning: !!state.isRunning,
            isIdle,
            pendingAcceptButtons,
            hasVisibleInput,
            hasVisibleSendButton,
            totalTabs,
            doneTabs: doneCount,
            allTasksCompleteByTabs,
            allTasksCompleteBySignals,
            allTasksComplete,
            waitingForChatMessage,
            completionWaiting: {
                readyToResume,
                isComplete: allTasksComplete,
                isWaitingForChatMessage: waitingForChatMessage,
                confidence: completionConfidence,
                confidenceLabel: completionConfidenceLabel,
                reasons: completionReasons,
                recommendedAction,
                evidence: {
                    isRunning: !!state.isRunning,
                    isIdle,
                    feedbackSignalDetected: isIdle,
                    pendingAcceptButtons,
                    totalTabs,
                    doneTabs: doneCount,
                    hasVisibleInput,
                    hasVisibleSendButton,
                    allTasksCompleteByTabs,
                    allTasksCompleteBySignals
                }
            },
            buttonSignals,
            safetyCounters,
            blockedUnsafeActionsTotal,
            profileCoverage,
            lastClickTime,
            lastBumpTime,
            timestamp: Date.now()
        };
    }

    const stripTimeSuffix = (text) => {
        return (text || '').trim().replace(/\s*\d+[smh]$/, '').trim();
    };

    // --- Remote Interactions (Bypassing Trusted Event Reqs) ---
    // --- Remote Interactions (Bypassing Trusted Event Reqs) ---
    async function remoteClick(el) {
        if (!el || !isElementVisible(el)) return false;

        // Calculate Global Coordinates (handling iframes)
        let x = 0;
        let y = 0;
        let width = 0;
        let height = 0;

        try {
            const rect = el.getBoundingClientRect();
            width = rect.width;
            height = rect.height;

            // Start with local coordinates within the element's document (viewport-relative)
            x = rect.left;
            y = rect.top;

            let currentWin = el.ownerDocument.defaultView;

            // Traverse up the frame chain until we reach the script's execution context (window)
            while (currentWin && currentWin !== window) {
                try {
                    const frameElement = currentWin.frameElement;
                    if (!frameElement) break; // Can't go higher (cross-origin or top)

                    const frameRect = frameElement.getBoundingClientRect();
                    x += frameRect.left;
                    y += frameRect.top;

                    // Adjust if frame has borders? Usually getBoundingClientRect handles content box vs border box
                    // But here we just want the offset of the frame in the parent.
                    // The inner window's (0,0) is at (frameRect.left + borderLeft, frameRect.top + borderTop)
                    // But getting border width is hard. Assuming minimal borders for now.
                    // Actually, frameRect includes border.
                    const style = window.getComputedStyle(frameElement);
                    x += parseFloat(style.borderLeftWidth || '0') + parseFloat(style.paddingLeft || '0');
                    y += parseFloat(style.borderTopWidth || '0') + parseFloat(style.paddingTop || '0');

                    currentWin = currentWin.parent;
                } catch (e) { break; }
            }
        } catch (e) {
            // Fallback
            const r = el.getBoundingClientRect();
            x = r.left; y = r.top; width = r.width; height = r.height;
        }

        if (width === 0 || height === 0) return false;

        const centerX = Math.round(x + (width / 2));
        const centerY = Math.round(y + (height / 2));

        // ----------------------------------------------------------------
        // ROBUST NATIVE DISPATCH (Crucial for React/Monaco inside Webviews)
        // ----------------------------------------------------------------
        try {
            const evOpts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new PointerEvent('pointerdown', evOpts));
            el.dispatchEvent(new MouseEvent('mousedown', evOpts));
            el.dispatchEvent(new PointerEvent('pointerup', evOpts));
            el.dispatchEvent(new MouseEvent('mouseup', evOpts));
        } catch (e) { }

        // [5.2.77 / 5.2.80] RESTORE THE TRUE HARDWARE BRIDGE!
        // The "Crossfire Bug" (hitting Customize Layout) was FIXED in the backend 
        // by the Exclusion Shield array! We MUST use the hardware CDP bridge because
        // React/Monaco inside the WebView ignoring raw JS el.click() events.
        const sigPayload = `__AUTOPILOT_CLICK__:${centerX}:${centerY}`;
        sendCommandToExtension(sigPayload);

        // Keep programmatic click as a fallback
        try { el.click(); } catch (e) { }
        playSound('click');

        // Emit ACTION event for sound effects
        let actionGroup = 'click';
        const txt = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
        if (txt.includes('run')) actionGroup = 'run';
        else if (txt.includes('expand') || el.classList.contains('codicon-chevron-right')) actionGroup = 'expand';
        else if (txt.includes('accept') || txt.includes('apply')) actionGroup = 'accept';
        else if (txt.includes('allow') || txt.includes('yes')) actionGroup = 'allow';
        else if (txt.includes('send') || txt.includes('submit')) actionGroup = 'submit';

        sendCommandToExtension(`__AUTOPILOT_ACTION__:${actionGroup}|${txt.substring(0, 20)}`);

        const timing = window.__antigravityConfig?.timing || {};
        const throttle = timing.actionThrottleMs || 100;
        await workerDelay(throttle);
        return true;
    }

    async function remoteType(text) {
        if (!text) return;
        sendCommandToExtension(`__AUTOPILOT_TYPE__:${text}`);
        playSound('type');
        await workerDelay(50);
    }

    async function detectAndDismissMCPDialog() {
        const dialogs = queryAll('.monaco-dialog-box');
        for (const dialog of dialogs) {
            if (!isElementVisible(dialog)) continue;
            const text = (dialog.textContent || '').toLowerCase();
            if (text.includes('mcp') || text.includes('marketplace')) {
                log('[MCP-Guard] Detected MCP/Marketplace dialog');
                const buttons = dialog.querySelectorAll('button');
                // Usually "Yes" is primary, "No" is secondary. Or "Enable" / "Disable".
                // We want to dismiss. "No", "Cancel", "Disable".
                for (const btn of buttons) {
                    const btnText = (btn.textContent || '').toLowerCase();
                    if (btnText.includes('no') || btnText.includes('cancel') || btnText.includes('disable') || btnText.includes('close')) {
                        log(`[MCP-Guard] Clicking dismiss button: "${btnText}"`);
                        await remoteClick(btn);
                        return true;
                    }
                }
                // Fallback: Click the last button (usually cancel)
                if (buttons.length > 0) {
                    log('[MCP-Guard] Clicking last button (fallback dismiss)');
                    await remoteClick(buttons[buttons.length - 1]);
                    return true;
                }
            }
        }
        return false;
    }



    function sendCommandToBridge(commandId, args) {
        // Leave command as ___ANTIGRAVITY_COMMAND__ if it's somehow triggering a legacy command for legacy fallback wait.
        let payload = `__AUTOPILOT_COMMAND__:${commandId}`;
        if (commandId === 'antigravity.agent.acceptAgentStep') {
            // Let it sinkhole.
            payload = `__ANTIGRAVITY_COMMAND__:${commandId}`;
        }

        if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
            window.__AUTOPILOT_BRIDGE__(payload);
            log(`[Bridge] Sent: ${payload}`);
        } else {
            console.log(payload);
            log(`[Bridge] Console: ${payload}`);
        }
    }

    function sendCommandToExtension(payload) {
        if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
            window.__AUTOPILOT_BRIDGE__(payload);
            log(`[Bridge] Sent via AUTOPILOT bridge: ${payload}`);
        } else if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
            // Legacy fallback only; primary runtime bridge is __AUTOPILOT_BRIDGE__.
            window.__ANTIGRAVITY_BRIDGE__(payload);
            log(`[Bridge] Sent via legacy bridge fallback: ${payload}`);
        } else {
            console.log(payload);
            log(`[Bridge] Console: ${payload}`);
        }
    }

    // Polyfill for RequestIdleCallback if needed
    window.requestIdleCallback = window.requestIdleCallback || function (cb) {
        return setTimeout(() => {
            const start = Date.now();
            cb({
                didTimeout: false,
                timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
            });
        }, 1);
    };

    // Legacy overlay and tab-tracking helpers removed.

    function findNearbyCommandText(el) {
        const commandSelectors = ['pre', 'code', 'pre code'];
        let commandText = '';

        let container = el.parentElement;
        let depth = 0;
        const maxDepth = 10;

        while (container && depth < maxDepth) {

            let sibling = container.previousElementSibling;
            let siblingCount = 0;

            while (sibling && siblingCount < 5) {

                if (sibling.tagName === 'PRE' || sibling.tagName === 'CODE') {
                    const text = sibling.textContent.trim();
                    if (text.length > 0) {
                        commandText += ' ' + text;
                        log(`[BannedCmd] Found <${sibling.tagName}> sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                    }
                }

                for (const selector of commandSelectors) {
                    const codeElements = sibling.querySelectorAll(selector);
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            const text = codeEl.textContent.trim();
                            if (text.length > 0 && text.length < 5000) {
                                commandText += ' ' + text;
                                log(`[BannedCmd] Found <${selector}> in sibling at depth ${depth}: "${text.substring(0, 100)}..."`);
                            }
                        }
                    }
                }

                sibling = sibling.previousElementSibling;
                siblingCount++;
            }

            if (commandText.length > 10) {
                break;
            }

            container = container.parentElement;
            depth++;
        }

        if (commandText.length === 0) {
            let btnSibling = el.previousElementSibling;
            let count = 0;
            while (btnSibling && count < 3) {
                for (const selector of commandSelectors) {
                    const codeElements = btnSibling.querySelectorAll ? btnSibling.querySelectorAll(selector) : [];
                    for (const codeEl of codeElements) {
                        if (codeEl && codeEl.textContent) {
                            commandText += ' ' + codeEl.textContent.trim();
                        }
                    }
                }
                btnSibling = btnSibling.previousElementSibling;
                count++;
            }
        }

        if (el.getAttribute('aria-label')) {
            commandText += ' ' + el.getAttribute('aria-label');
        }
        if (el.getAttribute('title')) {
            commandText += ' ' + el.getAttribute('title');
        }

        const result = commandText.trim().toLowerCase();
        if (result.length > 0) {
            log(`[BannedCmd] Extracted command text (${result.length} chars): "${result.substring(0, 150)}..."`);
        }
        return result;
    }

    function isCommandBanned(commandText) {
        const state = window.__autopilotState;
        const bannedList = state.bannedCommands || [];

        if (bannedList.length === 0) return false;
        if (!commandText || commandText.length === 0) return false;

        const lowerText = commandText.toLowerCase();

        for (const banned of bannedList) {
            const pattern = banned.trim();
            if (!pattern || pattern.length === 0) continue;

            try {

                if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {

                    const lastSlash = pattern.lastIndexOf('/');
                    const regexPattern = pattern.substring(1, lastSlash);
                    const flags = pattern.substring(lastSlash + 1) || 'i';

                    const regex = new RegExp(regexPattern, flags);
                    if (regex.test(commandText)) {
                        log(`[BANNED] Command blocked by regex: /${regexPattern}/${flags}`);
                        Analytics.trackBlocked(log);
                        return true;
                    }
                } else {

                    const lowerPattern = pattern.toLowerCase();
                    if (lowerText.includes(lowerPattern)) {
                        log(`[BANNED] Command blocked by pattern: "${pattern}"`);
                        Analytics.trackBlocked(log);
                        return true;
                    }
                }
            } catch (e) {

                log(`[BANNED] Invalid regex pattern "${pattern}", using literal match: ${e.message}`);
                if (lowerText.includes(pattern.toLowerCase())) {
                    log(`[BANNED] Command blocked by pattern (fallback): "${pattern}"`);
                    Analytics.trackBlocked(log);
                    return true;
                }
            }
        }
        return false;
    }

    function isAcceptButton(el) {
        const state = window.__autopilotState || {};
        let text = (el.textContent || "").trim().toLowerCase();

        // Fallback: If text is empty, check aria-label or title (common for icon-only buttons like "Run")
        if (text.length === 0) {
            text = (el.getAttribute('aria-label') || "").trim().toLowerCase();
        }
        if (text.length === 0) {
            text = (el.getAttribute('title') || "").trim().toLowerCase();
        }

        if (text.length === 0 || text.length > 120) return false;

        if (getCurrentMode() === 'antigravity' && (text.includes('run') || text.includes('expand'))) {
            return false;
        }

        // Hardcoded safety lock: explicitly reject context/layout chrome controls
        if (/(add context|attach|layout|customize)/i.test(text)) return false;

        // Safety: Never interact with marketplace / extension management / plugin surfaces
        // These are frequent sources of destructive misclicks and UI thrashing.
        if (el.closest) {
            const unsafeContainer = el.closest(
                '.extensions-viewlet, [id*="workbench.view.extensions"], [class*="extensions"], [id*="extensions"], [class*="marketplace"], [id*="marketplace"], [data-view-id*="extensions"]'
            );
            if (unsafeContainer) {
                log(`[SAFETY] Skipping button in Extensions/Marketplace context: "${text}"`);
                return false;
            }
        }

        // Hardcore icon checks inside the button
        const badIcons = '.codicon-settings-gear, .codicon-gear, .codicon-layout, .codicon-attach, .codicon-paperclip, .codicon-add, .codicon-plus';
        if (el.matches(badIcons) || (el.querySelector && el.querySelector(badIcons))) {
            return false;
        }

        // Use configured patterns from state if available, otherwise use defaults
        const defaultPatterns = ['accept', 'accept all', 'keep', 'run in terminal', 'run command', 'execute command', 'run', 'expand', 'retry', 'always approve', 'apply', 'confirm', 'allow once', 'allow', 'proceed', 'continue', 'yes', 'ok', 'save', 'approve', 'overwrite'];

        const patterns = state.acceptPatterns || defaultPatterns;

        const defaultRejects = ['skip', 'reject', 'cancel', 'close', 'refine', 'deny', 'no', 'dismiss', 'abort', 'ask every time', 'always run', 'always allow', 'auto proceed', 'auto-proceed', 'stop', 'pause', 'disconnect', 'install', 'uninstall', 'enable', 'disable', 'marketplace', 'extension', 'plugin', 'customize layout', 'layout control'];
        const rejects = state.rejectPatterns ? [...defaultRejects, ...state.rejectPatterns] : defaultRejects;

        if (rejects.some(r => text.includes(r))) return false;
        if (!patterns.some(p => text.includes(p))) return false;

        if (text.includes('accept all')) {
            if (el.closest('[id*="scm"], [class*="scm"], [data-view-id*="scm"]')) {
                // Extracted git.stageAll command alias to prevent layout triggers
                // no-op: async waits are not allowed inside this sync predicate
            }
            return true;
        }

        const isCommandButton = text.includes('run') || text.includes('execute') || text.includes('accept');

        // The Exclusion Shield protects the Main Window from broad queries like 'run'.
        // We no longer need to explicitly ban 'run' here, which was breaking Webview Run buttons!
        // (Removed lines 1516-1524)

        // Special Case: "Accept" in Diff Editor
        if (text === 'accept' || text.includes('accept changes')) {
            // Check if it's the global "Accept All" in SCM title
            // or a specific file accept.
            // For SCM "Accept All", we can use git.stageAll
            // But how do we know?
            // Heuristic: If it's in a view with "Source Control" title?
            // Actually, keep clicking for now, BUT if it fails (stuck), we might want to use command.
            // Let's use command if possible.
            // "Accept All" in SCM view -> git.stageAll
            if (el.closest('[id*="scm-view"]')) {
                // Extracted git.stageAll command alias to prevent layout triggers
                // no-op: async waits are not allowed inside this sync predicate
            }
            return true;
        }

        if (isCommandButton) {
            // Only ban if explicitly banned by nearby text
            const nearbyText = findNearbyCommandText(el);
            if (isCommandBanned(nearbyText)) {
                log(`[BANNED] Skipping button: "${text}" - command is banned`);
                return false;
            }
        }

        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.pointerEvents !== 'none' && !el.disabled;
    }

    function isElementVisible(el) {
        if (!el || !el.isConnected) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && style.visibility !== 'hidden';
    }

    function waitForDisappear(el, timeout = 500) {
        return new Promise(resolve => {
            const startTime = Date.now();
            const check = () => {
                if (!isElementVisible(el)) {
                    resolve(true);
                } else if (Date.now() - startTime >= timeout) {
                    resolve(false);
                } else {
                    setTimeout(check, 50); // ONLY use setTimeout for background tracking!
                }
            };

            setTimeout(check, 50);
        });
    }

    // Click "Always run" option in Antigravity's permission dropdown (new UI feature)
    // Track if we've already clicked it to avoid re-triggering the dropdown
    let alwaysRunClicked = false;

    async function clickAlwaysRunDropdown() {
        // If we've already clicked "Always run", don't interact with dropdown anymore
        if (alwaysRunClicked) {
            return false;
        }

        // Look for dropdown menu items containing "Always run" or "Always allow"
        const dropdownSelectors = [
            '[role="menuitem"]',
            '[role="option"]',
            '.dropdown-item',
            '.menu-item',
            'div[class*="dropdown"] div',
            'div[class*="menu"] div',
            'li'
        ];

        for (const selector of dropdownSelectors) {
            const items = queryAll(selector);
            for (const item of items) {
                const text = (item.textContent || '').trim().toLowerCase();
                // Match "Always run", "Always allow", etc.
                if (text === 'always run' ||
                    text === 'always allow' ||
                    (text.includes('always') && (text.includes('run') || text.includes('allow')))) {

                    // Make sure it's visible and clickable
                    const style = window.getComputedStyle(item);
                    const rect = item.getBoundingClientRect();
                    const isVisible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        parseFloat(style.opacity) > 0.1 &&
                        rect.width > 0 && rect.height > 0;

                    if (isVisible) {
                        log('[Dropdown] Clicking "Always run" option - will not click again');
                        await remoteClick(item);
                        alwaysRunClicked = true;  // Remember we clicked it
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Reset the alwaysRunClicked flag when a new session starts
    function resetAlwaysRunState() {
        alwaysRunClicked = false;
    }


    async function expandCollapsedSections() {
        if (getCurrentMode() === 'antigravity') {
            bumpSafetyCounter('blockedAgExpandPass');
            log('[Expand] AG mode: expansion pass disabled for safety.');
            return false;
        }

        // Expand collapsed sections ONLY within the chat/response area
        // IMPORTANT: Do NOT query globally — that would click file explorer, sidebar, etc.
        const expandTargets = [];
        let clicked = 0;

        // Scope: broad search within the active editor/workbench area
        // 1. Generic aria-expanded check (most reliable)
        // Use queryAll to benefit from shadow dom traversal and our banned node cache
        const candidates = queryAll('[aria-expanded="false"]');
        for (const el of candidates) {
            if (!isElementVisible(el)) continue;
            if (!isValidInteractionTarget(el)) continue; // MASSIVE: Do not click banned items like Layout or Add Context

            // Filter out obvious noise (like file explorer trees if we are not focused there)
            // But keep it broad enough to catch chat response toggles
            if (el.matches('.monaco-list-row, .monaco-tl-row, .monaco-tree-row')) {
                // Check if it looks like a "step" or "run" item
                const text = (el.textContent || '').toLowerCase();
                if (text.includes('run') || text.includes('step') || text.includes('command') || text.includes('terminal')) {
                    expandTargets.push(el);
                }
            } else {
                // DANGER ZONE FIX: Never blindly click aria-expanded="false" elements!
                // Only click if it has text proving it is an AI reasoning block or expansion UI
                const text = (el.textContent || '').toLowerCase();
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                const title = (el.getAttribute('title') || '').toLowerCase();

                if (text.includes('requires input') || text.includes('expand') || (text.includes('step') && text.includes('input')) ||
                    label.includes('expand') || title.includes('expand')) {

                    if (!text.includes('explorer') && !label.includes('explorer')) {
                        expandTargets.push(el);
                    }
                }
            }
        }

        // 2. Explicit "Show" / "Expand" buttons
        const explicitButtons = queryAll('button, [role="button"], .clickable, .codicon-bell, .codicon-chevron-right, .codicon-chevron-down');
        for (const el of explicitButtons) {
            if (!isElementVisible(el)) continue;

            // EXCLUSION: Skip known non-interactive zones (already handled by isValidInteractionTarget but good to be safe)
            if (!isValidInteractionTarget(el)) continue;

            const text = (el.textContent || '').trim().toLowerCase();
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const className = (el.className || '').toLowerCase();

            // Gold Standard: "1 Step Requires Input" / "Expand <"
            if (text.includes('requires input') ||
                text.includes('step') && text.includes('input') ||
                text.includes('expand') ||
                label.includes('expand') ||
                title.includes('expand') ||
                className.includes('codicon-bell')) { // The bell icon usually indicates "Requires Input"

                // Safety: Don't click file explorer expansion
                if (!text.includes('explorer') && !label.includes('explorer')) {
                    expandTargets.push(el);
                    continue;
                }
            }

            if ((text === 'show' || label.includes('show')) &&
                !text.includes('explorer') && !label.includes('explorer')) {
                expandTargets.push(el);
            }
        }

        // 4. Click unique targets
        const unique = [...new Set(expandTargets)];
        if (unique.length > 0) {
            log('[Expand] Found ' + unique.length + ' collapse toggles in chat area. Expanding...');
            for (const btn of unique) {
                try { await remoteClick(btn); clicked++; } catch (e) { }
                await new Promise(r => setTimeout(r, 50));
            }
            if (clicked > 0) {
                await workerDelay(300);
                return true;
            }
        }
        return false;
    }



    // --- Auto-Bump Logic ---


    function isConversationIdle() {
        // Gold Standard Idle Detection:
        // 1. Explicit Good/Bad/Feedback buttons are a clear "Done" signal
        const badges = queryAll('button, [role="button"], span, div, [class*="feedback"], [class*="rating"]');
        const feedbackTextPattern = /^(good|bad|helpful|not helpful|thumbs up|thumbs down)$/i;
        const feedbackLabelPattern = /(good|bad|helpful|not helpful|thumbs up|thumbs down|positive feedback|negative feedback|rate response)/i;

        for (const b of badges) {
            // Must be visible
            if (!isElementVisible(b)) continue;

            const text = (b.textContent || '').trim().replace(/\s+/g, ' ');
            const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`.trim();
            const className = (b.className || '').toLowerCase();

            // Check patterns
            if (feedbackTextPattern.test(text) || feedbackLabelPattern.test(label) ||
                (className.includes('thumbs') && (className.includes('up') || className.includes('down')))) {
                return true;
            }
        }

        // 2. Specific Codicons for ratings
        const thumbIcons = queryAll('.codicon-thumbsup, .codicon-thumbsdown, .codicon-star, [class*="codicon-feedback"]');
        for (const icon of thumbIcons) {
            if (isElementVisible(icon)) return true;
        }

        // 3. Check for specific "Regenerate" button which implies done
        const regenerateBtns = queryAll('[aria-label*="Regenerate"], [title*="Regenerate"], button:contains("Regenerate")');
        for (const btn of regenerateBtns) {
            if (isElementVisible(btn)) return true;
        }

        // 4. Check for input field visibility (if input is ready, it's likely idle)
        // But input might be visible while generating? Usually disabled.
        // We will rely on feedback buttons as primary strong signal.

        return false;
    }

    async function sendMessage(text) {
        if (!text) return false;
        if (!isInteractionWindowEligible()) {
            return false;
        }
        if (window.showAutoAllToast) {
            window.showAutoAllToast(`Auto-Reply: "${text}"`, 2000, 'rgba(0,100,200,0.8)');
        }
        const mode = getCurrentMode();
        log(`[Chat] Sending message (mode=${mode}): "${text}"`);

        // GOLD STANDARD: Try EVERY method sequentially until one works
        const profileOrder = [mode, 'vscode', 'antigravity', 'cursor'].filter((v, i, arr) => arr.indexOf(v) === i);

        for (const profile of profileOrder) {
            try {
                // Method A: DOM Input + Click Send
                const inputEl = findVisibleElementBySelectors(getUnifiedTextInputSelectors(profile));
                if (inputEl) {
                    log(`[Chat] Found input element (${profile})`);
                    if (setInputValue(inputEl, text)) {
                        const beforeSubmitText = readComposerValue(inputEl);
                        await workerDelay(100); // Wait for UI debounce

                        // Try finding send button with short retry window (button may enable after debounce)
                        let submitByClick = false;
                        const maxSendRetries = 5;
                        for (let attempt = 0; attempt < maxSendRetries; attempt++) {
                            const sendEl = findVisibleElementBySelectors(getUnifiedSendButtonSelectors(profile));
                            if (!sendEl) {
                                await workerDelay(180);
                                continue;
                            }

                            log(`[Chat] Found send button (${profile}) attempt ${attempt + 1}/${maxSendRetries}, clicking...`);
                            await remoteClick(sendEl);
                            await workerDelay(280);

                            const afterSendText = readComposerValue(inputEl);
                            if (!afterSendText || afterSendText.length < beforeSubmitText.length) {
                                submitByClick = true;
                                break;
                            }
                        }

                        if (submitByClick) {
                            return true;
                        }

                        log(`[Chat] Send click retries did not clear composer (${profile}), trying keyboard fallback...`);

                        // Method B: Keyboard Submit (Enter)
                        const success = await submitWithKeys(inputEl);
                        if (success) {
                            log(`[Chat] Message submitted via keyboard`);
                            return true;
                        }
                    }
                }
            } catch (e) {
                log(`[Chat] DOM strategy failed for profile=${profile}: ${e.message}`);
            }
        }

        // Method C: CDP Bridge (Ultimate Fallback)
        log('[Chat] Falling back to hybrid CDP bridge strategy');
        sendCommandToExtension('__AUTOPILOT_HYBRID_BUMP__:' + text);
        // IMPORTANT: do not also send __AUTOPILOT_TYPE__ here;
        // it causes duplicate bump text with no guaranteed submit.
        return true; // We assume bridge handles it
    }

    let lastBumpTime = 0;
    let lastClickTime = 0;

    async function autoBump() {
        if (!isInteractionWindowEligible()) return false;
        sendCommandToExtension('__AUTOPILOT_ACTION__:bump|auto');
        const state = window.__autopilotState;
        const bumpMsg = state.bumpMessage;
        if (!bumpMsg || !state.bumpEnabled) return false;

        const now = Date.now();
        const cooldown = state.autoApproveDelay || 30000;

        if (now - lastBumpTime < cooldown) return false;
        if (now - lastClickTime < cooldown) return false;

        if (!isConversationIdle()) return false;

        const sent = await sendMessage(bumpMsg);
        if (sent) {
            lastBumpTime = now;
            log('[Bump] Bump sent successfully');
            return true;
        }

        return false;
    }

    async function performClick(selectors, options = {}) {
        if (!isInteractionWindowEligible()) return 0;
        await detectAndDismissMCPDialog();
        const mode = getCurrentMode();
        // PRE-CHECK: Expand any collapsed sections that might be hiding buttons
        if (mode !== 'antigravity') {
            await expandCollapsedSections();
        }

        let found = [];
        selectors.forEach(s => queryAll(s).forEach(el => {
            if (isValidInteractionTarget(el)) {
                found.push({ el, selector: s, source: 'Primary' });
            } else {
                bumpSafetyCounter('blockedInvalidTarget');
            }
        }));

        if (found.length === 0 && mode !== 'antigravity') {
            const fallbackSelectors = [
                ...getUnifiedClickSelectors(mode),
                // User Requested "Gold Standard" coverage:
                '[aria-label*="Allow"]', '[title*="Allow"]',
                '[aria-label*="Accept All"]', '[title*="Accept All"]',
                '[aria-label*="Yes"]', '[title*="Yes"]',
                '[aria-label*="Retry"]', '[title*="Retry"]',
                '[aria-label*="Always Approve"]', '[title*="Always Approve"]'
            ];
            [...new Set(fallbackSelectors)].forEach(s => queryAll(s).forEach(el => {
                if (isValidInteractionTarget(el)) {
                    found.push({ el, selector: s, source: 'Fallback' });
                } else {
                    bumpSafetyCounter('blockedInvalidTarget');
                }
            }));
        }

        // If nothing found, try expanding ONE MORE TIME aggressively, then search again
        if (found.length === 0 && mode !== 'antigravity') {
            const expanded = await expandCollapsedSections();
            if (expanded) {
                selectors.forEach(s => queryAll(s).forEach(el => {
                    if (isValidInteractionTarget(el)) {
                        found.push({ el, selector: s, source: 'Expanded-Primary' });
                    } else {
                        bumpSafetyCounter('blockedInvalidTarget');
                    }
                }));

                if (found.length === 0) {
                    const fallbackSelectors = [
                        ...getUnifiedClickSelectors(mode)
                    ];
                    [...new Set(fallbackSelectors)].forEach(s => queryAll(s).forEach(el => {
                        if (isValidInteractionTarget(el)) {
                            found.push({ el, selector: s, source: 'Expanded-Fallback' });
                        } else {
                            bumpSafetyCounter('blockedInvalidTarget');
                        }
                    }));
                }
            }
        }

        debugLog(`[performClick] Expansion and fallback completed. Found ${found.length} elements.`);
        let clicked = 0;
        let verified = 0;
        const uniqueFound = [];
        const seen = new Set();
        found.forEach(item => {
            if (!seen.has(item.el)) {
                seen.add(item.el);
                uniqueFound.push(item);
            }
        });

        for (const item of uniqueFound) {
            const { el, selector, source } = item;
            if (!isChatActionSurface(el)) {
                bumpSafetyCounter('blockedNonChatSurface');
                continue;
            }
            // FILTER: Only interact with buttons matching allowlist/rejectlist
            // FILTER: Only interact with buttons matching allowlist/rejectlist
            const passesAcceptFilter = options.skipAcceptCheck ? true : isAcceptButton(el);
            if (!passesAcceptFilter) {
                continue;
            }

            // Broadcast detection - Diagnostics Matrix
            if (window.monitorButtonDetection) {
                const diag = {
                    acceptAll: !!findVisibleElementBySelectors(SELECTORS.ACCEPT_ALL_BUTTONS),
                    run: !!findVisibleElementBySelectors(SELECTORS.RUN_BUTTONS),
                    expand: !!findVisibleElementBySelectors(SELECTORS.EXPAND_BUTTONS),
                    chatInput: !!findVisibleElementBySelectors(SELECTORS.CHAT_INPUT_AREA),
                    submitConfig: !!findVisibleElementBySelectors(SELECTORS.SUBMIT_BUTTONS),
                    feedback: !!document.querySelector('.chat-input-container .feedback-icon, .chat-input-container .thumbs-up, .chat-input-container .thumbs-down')
                };
                console.log(`__AUTOPILOT_DIAGNOSTICS__:${JSON.stringify(diag)}`);
            }

            // Stuck Button Detection
            const state = window.__autopilotState;
            if (!state.clickHistory) state.clickHistory = { signature: '', count: 0 };

            if (passesAcceptFilter) {
                log(`[Trace] Found Candidate. Text: "${el.textContent?.substring(0, 30)}", Selector: "${selector}" (${source})`);

                // Hybrid Strategy: Check if we can use a command instead of click
                const txt = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();

                if (txt.includes('run') && (txt.includes('terminal') || el.closest('.terminal'))) {
                    log('Detected Terminal Run -> Using Hybrid Strategy');

                    // 1. Find the code
                    // Usually "Run" button is near a code block or inside a cell
                    // DOM: button -> container -> code block?
                    // Heuristic: Look for closest .code-block or pre or code
                    // Actually, in Chat, "Run in Terminal" is in the toolbar ABOVE the code usually.
                    // Or in the footer.
                    // Let's look for `pre` logic relative to button.
                    // Strategy: DOM traversal up, then search for `code`.
                    // If not found, abort fallback.

                    const container = el.closest('[data-code-block-index], .monaco-list-row, .chat-response, .markdown-body');
                    const codeEl = container ? container.querySelector('code, .code-block') : null;

                    if (codeEl) {
                        const code = codeEl.textContent;
                        if (code) {
                            log(`[Hybrid] Copying ${code.length} chars to clipboard...`);
                            // Use Clipboard API
                            // Requires permission? Usually allowed in extension context if focused.
                            try {
                                // We can't use navigator.clipboard easily in background?
                                // We can use `document.execCommand('copy')` with hidden textarea?

                                const ta = document.createElement('textarea');
                                ta.value = code;
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);

                                log('[Hybrid] Focusing terminal... (alias removed)');
                                await workerDelay(100);

                                log('[Hybrid] Pasting... (alias removed)');
                                await workerDelay(100);

                                // Send Enter?
                                // DISABLED: Removed hardcoded legacy terminal chat accept shortcut.
                                // This legacy command aliases to 'Customize Layout' on the modern Antigravity fork
                                // and causes a crippling UI loop when left running in the background watcher.
                                log('[Action] Auto-accepting terminal chat (suppressed legacy command)');

                                playSound('submit');

                                state.clickHistory = { signature: '[HybridTerminalRun]', count: 1 };
                                clicked++;

                                // Flash Blue
                                const originalBorder = el.style.border;
                                el.style.border = '2px solid #3b82f6';
                                setTimeout(() => el.style.border = originalBorder, 500);

                                continue;
                            } catch (e) {
                                log('[Hybrid] Run failed: ' + e.message);
                            }
                        }
                    }
                } else if (txt.includes('accept') && el.closest('[id*="scm"]')) {
                    log('Detected SCM Accept -> (Alias removed)');
                    // sendCommandToBridge('git.stageAll');

                    // Visual feedback
                    const originalBorder = el.style.border;
                    el.style.border = '2px solid #3b82f6'; // Blue for Command
                    setTimeout(() => el.style.border = originalBorder, 500);

                    // We assume it worked?
                    clicked++;
                    continue;
                }

                const buttonText = (el.textContent || "").trim();

                // create signature based on text and approx location to identify "Same Button"
                // rounding to 10px to account for minute layout shifts
                const r = el.getBoundingClientRect();
                const sig = `${buttonText}|${Math.round(r.top / 20)}|${Math.round(r.left / 20)}`;

                if (state.clickHistory.signature === sig) {
                    state.clickHistory.count++;

                    if (state.clickHistory.count === 2) {
                        bumpSafetyCounter('blockedStuckKeypressFallback');
                        log(`[StuckGuard] Button stubborn (2nd attempt). Skipping keypress fallback for safety.`);
                    }

                    if (state.clickHistory.count > 3) {
                        log(`[StuckGuard] Ignoring stuck button: "${buttonText}" (clicked ${state.clickHistory.count} times)`);
                        continue; // SKIP THIS CLICK
                    }
                } else {
                    // New button interaction reset
                    state.clickHistory.signature = sig;
                    state.clickHistory.count = 1;
                }

                log(`Clicking: "${buttonText}"`);

                await remoteClick(el);
                clicked++;

                const disappeared = await waitForDisappear(el);

                if (disappeared) {
                    Analytics.trackClick(buttonText, log);
                    verified++;
                    log(`[Stats] Click verified (button disappeared)`);
                    // If it disappeared, reset stuck count? 
                    // No, because we might click the NEXT button which has same signature?
                    // Actually if it disappeared, it's NOT the same button instance usually.
                    // But if a NEW button appears in exact same spot?
                    state.clickHistory.count = 0; // Reset if successful action
                } else {
                    log(`[Stats] Click not verified (button still visible)`);
                    // Don't reset count, so we detect stuckness next loop
                }
            }
        }

        if (clicked > 0) {
            log(`[Click] Attempted: ${clicked}, Verified: ${verified}`);
            lastClickTime = Date.now();
        }
        return verified; // We return verified count. But caller checks 'clicked > 0' usually?
        // So if we SKIP via stuck guard, `verified` will be 0.
        // And caller sees 0.
        // And `autoBump` triggers.
        // PERFECT.
    }

    function updateProfileCoverage() {
        const state = window.__autopilotState;
        if (!state) return;

        const evaluateProfile = (profileName) => {
            const selectors = UI_SELECTORS[profileName];
            if (!selectors) return null;

            const hasVisibleInput = selectors.textInputs.some(s => queryAll(s).some(isElementVisible));
            const hasVisibleSendButton = selectors.sendButtons.some(s => queryAll(s).some(isElementVisible));

            // For pending accept buttons, we use the unified selectors for that profile
            // This is a rough heuristic
            const clickSelectors = selectors.click || [];
            const pendingAcceptButtons = clickSelectors.reduce((acc, s) => {
                const elements = queryAll(s);
                return acc + elements.filter(el => isElementVisible(el) && isAcceptButton(el)).length;
            }, 0);

            return { hasVisibleInput, hasVisibleSendButton, pendingAcceptButtons };
        };

        state.profileCoverage = {
            vscode: evaluateProfile('vscode'),
            antigravity: evaluateProfile('antigravity'),
            cursor: evaluateProfile('cursor')
        };
    }

    // Legacy cursor/antigravity loop variants removed. Minimal core scheduler is the single active loop.

    window.__autoAllUpdateBannedCommands = function (bannedList) {
        const state = window.__autopilotState;
        state.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
        log(`[Config] Updated banned commands list: ${state.bannedCommands.length} patterns`);
        if (state.bannedCommands.length > 0) {
            log(`[Config] Banned patterns: ${state.bannedCommands.join(', ')}`);
        }
    };

    window.__autoAllUpdateAcceptPatterns = function (patternList) {
        const state = window.__autopilotState;
        state.acceptPatterns = Array.isArray(patternList) && patternList.length > 0 ? patternList : null;
        log(`[Config] Updated accept patterns: ${state.acceptPatterns ? state.acceptPatterns.length + ' patterns' : 'using defaults'}`);
    };

    window.__autoAllUpdateRejectPatterns = function (patternList) {
        const state = window.__autopilotState;
        state.rejectPatterns = Array.isArray(patternList) ? patternList : [];
        log(`[Config] Updated reject patterns: ${state.rejectPatterns.length} patterns`);
    };

    window.__autoAllGetStats = function () {
        const stats = Analytics.getStats();
        return {
            clicks: stats.clicksThisSession || 0,
            blocked: stats.blockedThisSession || 0,
            sessionStart: stats.sessionStartTime,
            fileEdits: stats.fileEditsThisSession || 0,
            terminalCommands: stats.terminalCommandsThisSession || 0,
            actionsWhileAway: stats.actionsWhileAway || 0
        };
    };

    window.__autoAllResetStats = function () {
        return Analytics.collectROI(log);
    };

    window.__autoAllGetSessionSummary = function () {
        return Analytics.getSessionSummary();
    };

    window.__autoAllGetAwayActions = function () {
        return Analytics.consumeAwayActions(log);
    };

    window.__autopilotGetRuntimeState = function () {
        try {
            const state = window.__autopilotState || {};
            if (state.lastRuntimeSnapshot && typeof state.lastRuntimeSnapshot === 'object') {
                return state.lastRuntimeSnapshot;
            }

            const mode = resolveForkMode();
            const map = detectIntentButtons();
            const stalled = detectStalledConversation(mode, map);
            const snapshot = buildMinimalRuntimeState(mode, map, stalled);
            state.lastRuntimeSnapshot = snapshot;
            return snapshot;
        } catch (e) {
            log(`[State] Failed to compute runtime state: ${e.message}`);
            return {
                status: 'error',
                isRunning: !!window.__autopilotState?.isRunning,
                error: String(e.message || e),
                timestamp: Date.now()
            };
        }
    };

    window.__autoAllSetFocusState = function (isFocused) {
        Analytics.setFocusState(isFocused, log);
    };

    // ------------------------------
    // Minimal deterministic core
    // ------------------------------
    const MINIMAL_INTENT_ORDER = [
        'always_allow',
        'accept_all',
        'allow',
        'keep',
        'proceed',
        'retry',
        'expand',
        'run'
    ];

    const MINIMAL_INTENTS = {
        always_allow: [/always\s*(allow|approve|run)/i],
        accept_all: [/accept\s*all/i],
        allow: [/^allow$/i, /allow\s*once/i],
        keep: [/^keep$/i],
        proceed: [/^proceed$/i, /^continue$/i],
        retry: [/^retry$/i],
        expand: [/^expand$/i, /expand\s*(section|response|steps?)?/i],
        run: [/run\s*in\s*terminal/i, /run\s*command/i, /execute\s*command/i, /^run$/i]
    };

    function normalizeButtonLabel(el) {
        if (!el) return '';
        const text = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        return `${text} ${aria} ${title}`.replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function resolveForkMode() {
        const stateMode = (window.__autopilotState?.currentMode || '').toLowerCase();
        if (stateMode === 'antigravity' || stateMode === 'cursor' || stateMode === 'vscode') {
            return stateMode;
        }

        const cfgMode = String(window.__antigravityConfig?.runtime?.mode || '').toLowerCase();
        if (cfgMode === 'antigravity' || cfgMode === 'cursor' || cfgMode === 'vscode') {
            return cfgMode;
        }

        if (queryAll('#antigravity\\.agentPanel').length > 0) return 'antigravity';
        if (queryAll('#workbench\\.parts\\.auxiliarybar').length > 0) return 'cursor';
        return 'vscode';
    }

    function getForkSelectors(mode) {
        if (mode === 'antigravity') {
            return {
                input: [
                    '#antigravity\\.agentPanel textarea',
                    '#antigravity\\.agentPanel [contenteditable="true"]',
                    'textarea[aria-label*="Chat" i]',
                    'textarea'
                ],
                send: [
                    '#antigravity\\.agentPanel button[aria-label*="Send" i]',
                    '#antigravity\\.agentPanel button[title*="Send" i]',
                    'button[aria-label*="Send" i]',
                    'button[title*="Send" i]'
                ],
                generating: [
                    'button[aria-label*="Stop" i]',
                    'button[title*="Stop" i]',
                    '[aria-label*="Cancel generation" i]'
                ]
            };
        }

        if (mode === 'cursor') {
            return {
                input: [
                    '#workbench\\.parts\\.auxiliarybar textarea',
                    '.interactive-editor textarea',
                    '.interactive-editor [contenteditable="true"]'
                ],
                send: [
                    '#workbench\\.parts\\.auxiliarybar button[aria-label*="Send" i]',
                    '.interactive-editor button[aria-label*="Send" i]',
                    '.interactive-editor button[title*="Send" i]'
                ],
                generating: [
                    'button[aria-label*="Stop" i]',
                    'button[title*="Stop" i]',
                    '[aria-label*="Cancel generation" i]'
                ]
            };
        }

        return {
            input: [
                '.interactive-editor textarea',
                '.chat-input-container textarea',
                '.chat-input-container [contenteditable="true"]',
                'textarea[aria-label*="Chat" i]'
            ],
            send: [
                '.interactive-editor button[aria-label*="Send" i]',
                '.chat-input-container button[aria-label*="Send" i]',
                '.chat-input-container button[title*="Send" i]',
                'button[aria-label*="Send" i]'
            ],
            generating: [
                'button[aria-label*="Stop" i]',
                'button[title*="Stop" i]',
                '[aria-label*="Cancel generation" i]'
            ]
        };
    }

    function findVisibleBySelectors(selectors) {
        for (const selector of selectors) {
            const nodes = queryAll(selector);
            for (const node of nodes) {
                if (isElementVisible(node) && !node.disabled && isValidInteractionTarget(node)) {
                    return node;
                }
            }
        }
        return null;
    }

    function detectIntentButtons() {
        const result = {
            always_allow: [],
            accept_all: [],
            allow: [],
            keep: [],
            proceed: [],
            retry: [],
            expand: [],
            run: []
        };

        const candidates = queryAll('button, [role="button"], [aria-label], [title]');
        for (const el of candidates) {
            if (!isElementVisible(el) || el.disabled) continue;
            if (!isValidInteractionTarget(el)) continue;
            if (!isChatActionSurface(el)) continue;

            const label = normalizeButtonLabel(el);
            if (!label) continue;

            for (const intent of MINIMAL_INTENT_ORDER) {
                const patterns = MINIMAL_INTENTS[intent] || [];
                if (patterns.some((re) => re.test(label))) {
                    result[intent].push(el);
                    break;
                }
            }
        }

        return result;
    }

    function readInputText(el) {
        if (!el) return '';
        if (el.isContentEditable) return (el.textContent || '').trim();
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return (el.value || '').trim();
        return '';
    }

    async function submitComposerByBestMethod(mode, inputEl) {
        const fork = getForkSelectors(mode);
        const sendEl = findVisibleBySelectors(fork.send);
        if (sendEl) {
            await remoteClick(sendEl);
            await workerDelay(220);
            if (!readInputText(inputEl)) return true;
        }

        // Final host fallback: delegate submit bridge for this fork.
        // This remains deterministic for currently supported host bridges.
        const currentText = readInputText(inputEl);
        if (currentText) {
            sendCommandToExtension('__AUTOPILOT_HYBRID_BUMP__:' + currentText);
            await workerDelay(220);
            return true;
        }

        return false;
    }

    async function typeAndSubmitBump(mode, bumpText) {
        const text = String(bumpText || '').trim();
        if (!text) return false;
        if (!isInteractionWindowEligible()) return false;

        const fork = getForkSelectors(mode);
        const inputEl = findVisibleBySelectors(fork.input);
        if (!inputEl) {
            // Deterministic fallback for forks where composer selectors drift.
            // Delegate to host bridge, which performs native typing/submission.
            sendCommandToExtension('__AUTOPILOT_HYBRID_BUMP__:' + text);
            lastBumpTime = Date.now();
            sendCommandToExtension('__AUTOPILOT_ACTION__:submit|minimal-hybrid');
            return true;
        }

        const typed = setInputValue(inputEl, text);
        if (!typed) return false;

        const delayMs = Math.max(40, Number(window.__autopilotState?.minimal?.typingDelayMs || 80));
        await workerDelay(delayMs);
        const submitted = await submitComposerByBestMethod(mode, inputEl);
        if (submitted) {
            lastBumpTime = Date.now();
            sendCommandToExtension('__AUTOPILOT_ACTION__:submit|minimal');
        }
        return submitted;
    }

    function detectStalledConversation(mode, actionMap) {
        const state = window.__autopilotState || {};
        const now = Date.now();
        const fork = getForkSelectors(mode);
        const hasInput = !!findVisibleBySelectors(fork.input);
        const hasSend = !!findVisibleBySelectors(fork.send);
        const isGenerating = !!findVisibleBySelectors(fork.generating);

        const actionableCount = MINIMAL_INTENT_ORDER.reduce((sum, key) => sum + (actionMap[key]?.length || 0), 0);
        const idleForMs = now - Math.max(lastClickTime || 0, lastBumpTime || 0, state.stats?.sessionStartTime || 0);
        const stalledMs = Math.max(1500, Number(state.minimal?.stalledMs || 7000));

        return (hasInput || hasSend) && !isGenerating && actionableCount === 0 && idleForMs >= stalledMs;
    }

    function buildMinimalRuntimeState(mode, actionMap, stalled) {
        const state = window.__autopilotState || {};
        const fork = getForkSelectors(mode);
        const hasInput = !!findVisibleBySelectors(fork.input);
        const hasSend = !!findVisibleBySelectors(fork.send);
        const pending = MINIMAL_INTENT_ORDER.reduce((sum, key) => sum + (actionMap[key]?.length || 0), 0);
        const waiting = !!state.isRunning && stalled;

        return {
            status: waiting ? 'waiting_for_chat_message' : (pending > 0 ? 'pending_accept_actions' : (state.isRunning ? 'processing' : 'stopped')),
            mode,
            runtimeRole: getRuntimeRole(),
            interactionEligible: isInteractionWindowEligible(),
            isRunning: !!state.isRunning,
            isIdle: stalled,
            pendingAcceptButtons: pending,
            hasVisibleInput: hasInput,
            hasVisibleSendButton: hasSend,
            totalTabs: 0,
            doneTabs: 0,
            allTasksCompleteByTabs: false,
            allTasksCompleteBySignals: stalled && pending === 0,
            allTasksComplete: stalled && pending === 0,
            waitingForChatMessage: waiting,
            completionWaiting: {
                readyToResume: waiting,
                isComplete: stalled && pending === 0,
                isWaitingForChatMessage: waiting,
                confidence: waiting ? 95 : 60,
                confidenceLabel: waiting ? 'high' : 'medium',
                reasons: waiting
                    ? ['chat input is ready, no action buttons pending, generation appears idle']
                    : ['actions still pending or generation in progress'],
                recommendedAction: waiting
                    ? 'Safe to send resume message.'
                    : 'Continue waiting or process pending actions.'
            },
            buttonSignals: {
                alwaysAllow: actionMap.always_allow.length,
                acceptAll: actionMap.accept_all.length,
                allow: actionMap.allow.length,
                keep: actionMap.keep.length,
                proceed: actionMap.proceed.length,
                retry: actionMap.retry.length,
                expand: actionMap.expand.length,
                run: actionMap.run.length,
                send: hasSend ? 1 : 0,
                input: hasInput ? 1 : 0
            },
            safetyCounters: getSafetyCounters(),
            blockedUnsafeActionsTotal: Object.values(getSafetyCounters()).reduce((sum, n) => sum + Number(n || 0), 0),
            profileCoverage: {
                antigravity: { pendingAcceptButtons: mode === 'antigravity' ? pending : 0, hasVisibleInput: mode === 'antigravity' ? hasInput : false, hasVisibleSendButton: mode === 'antigravity' ? hasSend : false },
                vscode: { pendingAcceptButtons: mode === 'vscode' ? pending : 0, hasVisibleInput: mode === 'vscode' ? hasInput : false, hasVisibleSendButton: mode === 'vscode' ? hasSend : false },
                cursor: { pendingAcceptButtons: mode === 'cursor' ? pending : 0, hasVisibleInput: mode === 'cursor' ? hasInput : false, hasVisibleSendButton: mode === 'cursor' ? hasSend : false }
            },
            lastClickTime,
            lastBumpTime,
            timestamp: Date.now()
        };
    }

    async function runMinimalCycle() {
        const state = window.__autopilotState;
        if (!state || !state.isRunning) return;
        if (!isInteractionWindowEligible()) return;

        const mode = resolveForkMode();
        state.currentMode = mode;
        const actionMap = detectIntentButtons();
        const clickThrottleMs = Math.max(40, Number(state.minimal?.clickThrottleMs || 120));
        let clicked = 0;

        for (const intent of MINIMAL_INTENT_ORDER) {
            const bucket = actionMap[intent];
            if (!bucket || bucket.length === 0) continue;

            for (const el of bucket) {
                const ok = await remoteClick(el);
                if (ok) {
                    clicked += 1;
                    lastClickTime = Date.now();
                    sendCommandToExtension(`__AUTOPILOT_ACTION__:${intent}|minimal`);
                    await workerDelay(clickThrottleMs);
                    // Keep the loop deterministic: one high-confidence action per cycle.
                    break;
                }
            }

            if (clicked > 0) break;
        }

        const stalled = detectStalledConversation(mode, actionMap);
        if (clicked === 0 && stalled) {
            const bumpCooldownMs = Math.max(1000, Number(state.minimal?.bumpCooldownMs || 12000));
            if ((Date.now() - lastBumpTime) >= bumpCooldownMs) {
                await typeAndSubmitBump(mode, state.bumpMessage || 'Proceed');
            }
        }

        state.lastRuntimeSnapshot = buildMinimalRuntimeState(mode, actionMap, stalled);
    }

    window.__autopilotState.forceSubmit = async function () {
        const mode = resolveForkMode();
        const fork = getForkSelectors(mode);
        const inputEl = findVisibleBySelectors(fork.input);
        if (!inputEl) return false;
        return await submitComposerByBestMethod(mode, inputEl);
    };

    window.showAutoAllToast = function (text, duration = 3000, color = 'rgba(0,100,0,0.8)') {
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed;top:10px;right:10px;z-index:99999;background:${color};color:white;padding:10px;border-radius:5px;font-family:sans-serif;pointer-events:none;transition:opacity 1s;`;
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 1000); }, duration);
    };

    window.__autopilotStart = async function (config) {
        try {
            const ide = (config.ide || 'cursor').toLowerCase();
            const cfgRole = String(config?.controllerRole || '').toLowerCase();
            const runtimeCfgRole = String(window.__antigravityConfig?.runtime?.role || '').toLowerCase();
            const runtimeCfgIsLeader = window.__antigravityConfig?.runtime?.isLeader;
            const previousRole = String(window.__autopilotState?.controllerRole || '').toLowerCase();
            const role = cfgRole === 'leader' || cfgRole === 'follower'
                ? cfgRole
                : runtimeCfgRole === 'leader' || runtimeCfgRole === 'follower'
                    ? runtimeCfgRole
                    : runtimeCfgIsLeader === true
                        ? 'leader'
                        : runtimeCfgIsLeader === false
                            ? 'follower'
                            : previousRole === 'leader' || previousRole === 'follower'
                                ? previousRole
                                : 'unknown';

            // Visual confirmation of injection
            window.showAutoAllToast(`Antigravity v${ANTIGRAVITY_VERSION} Active (${role.toUpperCase()}) 🚀`);

            if (config.bannedCommands) {
                window.__autoAllUpdateBannedCommands(config.bannedCommands);
            }
            if (config.acceptPatterns) {
                window.__autoAllUpdateAcceptPatterns(config.acceptPatterns);
            }
            if (config.rejectPatterns) {
                window.__autoAllUpdateRejectPatterns(config.rejectPatterns);
            }

            log(`__autopilotStart called: ide=${ide}, minimal-core=true`);

            const state = window.__autopilotState;
            state.controllerRole = role;
            state.currentMode = ide;
            state.bumpMessage = config.bumpMessage || state.bumpMessage || 'Proceed';
            state.bumpEnabled = !!state.bumpMessage;
            state.autoApproveDelay = (config.autoApproveDelay || 10) * 1000;
            state.threadWaitInterval = (config.threadWaitInterval || 3) * 1000;
            state.minimal = {
                pollMs: Math.max(150, Number(config.pollInterval || window.__antigravityConfig?.timing?.pollIntervalMs || 900)),
                clickThrottleMs: Math.max(40, Number(window.__antigravityConfig?.timing?.actionThrottleMs || 120)),
                stalledMs: Math.max(1500, Number(window.__antigravityConfig?.timing?.stalledMs || state.threadWaitInterval || 7000)),
                bumpCooldownMs: Math.max(1000, Number(window.__antigravityConfig?.timing?.bumpCooldownMs || state.autoApproveDelay || 12000)),
                typingDelayMs: Math.max(20, Number(window.__antigravityConfig?.bump?.typingDelayMs || 80))
            };

            state.forceAction = async function (action) {
                const normalized = String(action || '').toLowerCase().replace(/\s+/g, '_');
                const mode = resolveForkMode();
                const map = detectIntentButtons();

                const actionKey = normalized === 'always_allow' || normalized === 'always_approve'
                    ? 'always_allow'
                    : normalized === 'acceptall' ? 'accept_all' : normalized;

                const bucket = map[actionKey] || [];
                if (bucket.length === 0) {
                    return false;
                }

                const ok = await remoteClick(bucket[0]);
                if (ok) {
                    lastClickTime = Date.now();
                    state.lastRuntimeSnapshot = buildMinimalRuntimeState(mode, map, detectStalledConversation(mode, map));
                }
                return !!ok;
            };

            // Hot reload config without restarting loop.
            if (state.isRunning) {
                log('[MinimalCore] Hot-reloaded config (loop still running)');
                return;
            }

            state.isRunning = true;
            state.sessionID++;
            if (!state.stats.sessionStartTime) {
                state.stats.sessionStartTime = Date.now();
            }
            state.safetyCounters = {
                blockedForceActionAg: 0,
                blockedAgExpandPass: 0,
                blockedInvalidTarget: 0,
                blockedNonChatSurface: 0,
                blockedStuckKeypressFallback: 0
            };

            log(`[MinimalCore] Loaded (mode=${state.currentMode}, role=${state.controllerRole}, bump="${state.bumpMessage}")`, true);

            if (state.__minimalTick) {
                clearInterval(state.__minimalTick);
            }
            state.__minimalBusy = false;

            const tick = async () => {
                if (!state.isRunning) return;
                if (state.__minimalBusy) return;
                state.__minimalBusy = true;
                try {
                    await runMinimalCycle();
                } catch (loopErr) {
                    log(`[MinimalCore] Tick error: ${loopErr.message || loopErr}`);
                } finally {
                    state.__minimalBusy = false;
                }
            };

            state.__minimalTick = setInterval(() => {
                tick();
            }, state.minimal.pollMs);

            await tick();
        } catch (e) {
            log(`ERROR in __autopilotStart: ${e.message}`);
            console.error('[autoAll] Start error:', e);
        }
    };

    window.__autopilotStop = function () {
        const state = window.__autopilotState || {};
        state.isRunning = false;
        if (state.__minimalTick) {
            clearInterval(state.__minimalTick);
            state.__minimalTick = null;
        }
        state.__minimalBusy = false;
        log("Agent Stopped.");
    };

    // --- Heartbeat Loop (Watchdog) ---
    (function heartbeatLoop() {
        if (window.__autopilotState?.isRunning) {
            const timestamp = Date.now();
            window.__antigravityHeartbeat = timestamp;

            // Send heartbeat via bridge if available
            if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
                // Too noisy for console, just update global var or send specific heartbeat msg if needed.
                // For now, we'll rely on CDP Runtime.evaluate of window.__antigravityHeartbeat
            }
        }
        setTimeout(heartbeatLoop, 2000); // Pulse every 2s
    })();

    log("Core Bundle Initialized.", true);
})();
