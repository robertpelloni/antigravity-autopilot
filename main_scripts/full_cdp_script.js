
(function () {
    "use strict";

    if (typeof window === 'undefined') return;

    const Analytics = (function () {

        const TERMINAL_KEYWORDS = ['run', 'execute', 'command', 'terminal'];
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
            return window.__autoAllState?.stats || createDefaultStats();
        }

        function getStatsMutable() {
            return window.__autoAllState.stats;
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
            const state = window.__autoAllState;
            if (state && state.stats) {

                state.stats.isWindowFocused = true;
                log('[Focus] Initialized (awaiting extension sync)');
            }
        }

        function initialize(log) {
            if (!window.__autoAllState) {
                window.__autoAllState = {
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
            } else if (!window.__autoAllState.stats) {
                window.__autoAllState.stats = createDefaultStats();
                log('[Analytics] Stats added to existing state');
            } else {
                const s = window.__autoAllState.stats;
                if (s.actionsWhileAway === undefined) s.actionsWhileAway = 0;
                if (s.isWindowFocused === undefined) s.isWindowFocused = true;
                if (s.fileEditsThisSession === undefined) s.fileEditsThisSession = 0;
                if (s.terminalCommandsThisSession === undefined) s.terminalCommandsThisSession = 0;
            }

            initializeFocusState(log);

            if (!window.__autoAllState.stats.sessionStartTime) {
                window.__autoAllState.stats.sessionStartTime = Date.now();
            }

            log('[Analytics] Initialized');

            // Phase 39: Manual Trigger API
            window.__autoAllState.forceAction = async function (action) {
                log(`[ForceAction] Received manual trigger: ${action}`);
                let selectors = [];
                if (action === 'run') selectors = ['[title*="Run"]', '[aria-label*="Run"]', '[title*="Execute"]', '[aria-label*="Execute"]', '.codicon-play', '.codicon-run', '.codicon-debug-start', '.run-button', '.debug-action', '[id*="run"]'];
                else if (action === 'expand') selectors = ['[title*="Expand"]', '[aria-label*="Expand"]', '.codicon-chevron-right', '.monaco-list-row.collapsed', '.monaco-tl-twistie'];
                else if (action === 'accept') selectors = ['[title*="Accept"]', '[aria-label*="Accept"]', '[title*="Apply"]', '[aria-label*="Apply"]', '[title*="Insert"]', '[aria-label*="Insert"]', '.codicon-check', '.codicon-diff-insert', '.start-inline-chat-button'];

                if (selectors.length > 0) {
                    await performClick(selectors);
                    return true;
                }
                return false;
            };

            window.__autoAllState.forceSubmit = async function () {
                log('[ForceSubmit] Attempting to click submit button...');
                const selectors = ['[title*="Send"]', '[aria-label*="Send"]', '.codicon-send', 'button[aria-label="Send"]'];
                await performClick(selectors);
                return true;
            };
        }


        function setFocusState(isFocused, log) {
            const state = window.__autoAllState;
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

    const debugLog = (msg) => {
        try {
            if (window.__antigravityConfig?.debug?.verboseLogging && typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                window.__ANTIGRAVITY_BRIDGE__(`__ANTIGRAVITY_DEBUG_LOG__:${msg}`);
            }
        } catch (e) { }
    };

    const playSound = (effect) => {
        try {
            if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                window.__ANTIGRAVITY_BRIDGE__(`__ANTIGRAVITY_PLAY_SOUND__:${effect}`);
            }
        } catch (e) { }
    };

    const log = (msg, isSuccess = false) => {
        debugLog(msg);
        console.log(`[autoAll] ${msg}`);
    };

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
        getDocuments().forEach(doc => {
            try { results.push(...Array.from(doc.querySelectorAll(selector))); } catch (e) { }
        });
        return results;
    };

    const UI_SELECTORS = {
        shared: {
            click: [
                'button',
                '[role="button"]',
                '.monaco-button',
                '[class*="button"]',
                '.codicon-play',
                '.codicon-debug-start',
                '.codicon-run',
                '[aria-label*="Run"]',
                '[title*="Run"]',
                '[aria-label*="Accept"]',
                '[title*="Accept"]',
                '[aria-label*="Allow"]',
                '[title*="Allow"]'
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
                '#antigravity\\.agentPanel button',
                '#antigravity\\.agentPanel [role="button"]',
                '.bg-ide-button-background',
                'button.grow',
                '.monaco-action-bar .action-label'
            ],
            sendButtons: [
                '#antigravity\\.agentPanel button[aria-label*="Send"]',
                '#antigravity\\.agentPanel button[title*="Send"]'
            ],
            textInputs: [
                '#antigravity\\.agentPanel textarea',
                '#antigravity\\.agentPanel [contenteditable="true"]'
            ]
        },
        cursor: {
            click: [
                '#workbench\\.parts\\.auxiliarybar button',
                '#workbench\\.parts\\.auxiliarybar [role="button"]',
                '.chat-session-item [role="button"]',
                '[class*="anysphere"]'
            ],
            sendButtons: [
                '#workbench\\.parts\\.auxiliarybar button[aria-label*="Send"]',
                '.interactive-editor button[aria-label*="Send"]'
            ],
            textInputs: [
                '#workbench\\.parts\\.auxiliarybar textarea',
                '.interactive-editor textarea',
                '.interactive-editor [contenteditable="true"]'
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
        const mode = (window.__autoAllState?.currentMode || 'cursor').toLowerCase();
        if (mode === 'antigravity' || mode === 'cursor' || mode === 'vscode') return mode;
        return 'vscode';
    }

    function mergeSelectorSets(mode, category) {
        const shared = (UI_SELECTORS.shared[category] || []).slice();
        const modeSpecific = (UI_SELECTORS[mode] && UI_SELECTORS[mode][category]) ? UI_SELECTORS[mode][category] : [];
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

    function isValidInteractionTarget(el) {
        if (!el) return false;

        // EXCLUSION: Never interact with Command Palette / Quick Pick
        if (el.closest('.quick-input-widget') ||
            el.closest('.monaco-quick-input-container') ||
            el.closest('.suggest-widget') ||
            el.closest('.rename-box')) {
            // log(`[Safety] Ignoring element in Quick Input/Suggest widget: ${el.tagName}`);
            return false;
        }

        // EXCLUSION: Never interact with Settings editor inputs (too dangerous)
        if (el.closest('.settings-editor')) {
            return false;
        }

        return true;
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
                el.value = value;
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

    async function submitWithKeys() {
        const target = document.activeElement;
        if (!target) return false;

        const combos = [
            { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
            { key: 'Enter', code: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
            { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
            { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }
        ];

        let submitted = false;
        for (const combo of combos) {
            try {
                const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...combo });
                const press = new KeyboardEvent('keypress', { bubbles: true, cancelable: true, ...combo });
                const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...combo });
                target.dispatchEvent(down);
                target.dispatchEvent(press);
                target.dispatchEvent(up);
                submitted = true;
                await workerDelay(40);
            } catch (e) { }
        }

        if (submitted) playSound('submit');
        return true;
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

    function getRuntimeStateSnapshot() {
        const state = window.__autoAllState || {};
        const mode = getCurrentMode();
        const profileCoverage = {
            antigravity: getProfileCoverage('antigravity'),
            vscode: getProfileCoverage('vscode'),
            cursor: getProfileCoverage('cursor')
        };
        const activeCoverage = profileCoverage[mode] || getProfileCoverage(mode);

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

        // Send command to Extension via Console Bridge
        // Send command to Extension via Bridge (Binding preferred)
        const payload = `__ANTIGRAVITY_CLICK__:${centerX}:${centerY}`;
        if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
            window.__ANTIGRAVITY_BRIDGE__(payload);
            log(`[Bridge] Sent Click via Binding: ${centerX},${centerY}`);
        } else {
            console.log(payload);
            log(`[Bridge] Sent Click via Console: ${centerX},${centerY}`);
        }

        // Also fire standard click for immediate UI feedback (hover states etc)
        try { el.click(); } catch (e) { }
        playSound('click');

        const timing = window.__antigravityConfig?.timing || {};
        const throttle = timing.actionThrottleMs || 100;
        await workerDelay(throttle);
        return true;
    }

    async function remoteType(text) {
        if (!text) return;
        sendCommandToExtension(`__ANTIGRAVITY_TYPE__:${text}`);
        playSound('type');
        await workerDelay(50);
    }

    function sendCommandToBridge(commandId, args) {
        let payload = `__ANTIGRAVITY_COMMAND__:${commandId}`;
        if (args) {
            payload += `|${JSON.stringify(args)}`;
        }
        sendCommandToExtension(payload);
    }

    function sendCommandToExtension(payload) {
        if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
            window.__ANTIGRAVITY_BRIDGE__(payload);
            log(`[Bridge] Sent: ${payload}`);
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

    const deduplicateNames = (names) => {
        const counts = {};
        return names.map(name => {
            if (counts[name] === undefined) {
                counts[name] = 1;
                return name;
            } else {
                counts[name]++;
                return `${name} (${counts[name]})`;
            }
        });
    };

    const updateTabNames = (tabs) => {
        const rawNames = Array.from(tabs).map(tab => stripTimeSuffix(tab.textContent));
        const tabNames = deduplicateNames(rawNames);

        if (JSON.stringify(window.__autoAllState.tabNames) !== JSON.stringify(tabNames)) {
            log(`updateTabNames: Detected ${tabNames.length} tabs: ${tabNames.join(', ')}`);
            window.__autoAllState.tabNames = tabNames;
        }
    };

    const updateConversationCompletionState = (rawTabName, status) => {
        const tabName = stripTimeSuffix(rawTabName);
        const current = window.__autoAllState.completionStatus[tabName];
        if (current !== status) {
            log(`[State] ${tabName}: ${current} → ${status}`);
            window.__autoAllState.completionStatus[tabName] = status;
        }
    };

    const OVERLAY_ID = '__autoAllBgOverlay';
    const STYLE_ID = '__autoAllBgStyles';
    const STYLES = `
        #__autoAllBgOverlay { position: fixed; background: rgba(0, 0, 0, 0.98); z-index: 2147483647; font-family: sans-serif; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; pointer-events: none; opacity: 0; transition: opacity 0.3s; }
        #__autoAllBgOverlay.visible { opacity: 1; }
        .aab-slot { margin-bottom: 12px; width: 80%; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; }
        .aab-header { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
        .aab-progress-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; }
        .aab-progress-fill { height: 100%; width: 20%; background: #6b7280; transition: width 0.3s, background 0.3s; }
        .aab-slot.working .aab-progress-fill { background: #a855f7; }
        .aab-slot.done .aab-progress-fill { background: #22c55e; }
        .aab-slot .status-text { color: #6b7280; }
        .aab-slot.working .status-text { color: #a855f7; }
        .aab-slot.done .status-text { color: #22c55e; }
    `;

    function showOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            log('[Overlay] Already exists, skipping creation');
            return;
        }

        log('[Overlay] Creating overlay...');
        const state = window.__autoAllState;

        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = STYLES;
            document.head.appendChild(style);
            log('[Overlay] Styles injected');
        }

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;

        const container = document.createElement('div');
        container.id = 'aab-c';
        container.style.cssText = 'width:100%; display:flex; flex-direction:column; align-items:center;';
        overlay.appendChild(container);

        document.body.appendChild(overlay);
        log('[Overlay] Overlay appended to body');

        const ide = state.currentMode || 'cursor';
        let panel = null;
        if (ide === 'antigravity') {
            panel = queryAll('#antigravity\\.agentPanel').find(p => p.offsetWidth > 50);
        } else {
            panel = queryAll('#workbench\\.parts\\.auxiliarybar').find(p => p.offsetWidth > 50);
        }

        if (panel) {
            log(`[Overlay] Found panel for ${ide}, syncing position`);
            const sync = () => {
                const r = panel.getBoundingClientRect();
                Object.assign(overlay.style, { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
            };
            sync();
            new ResizeObserver(sync).observe(panel);
        } else {
            log('[Overlay] No panel found, using fullscreen');
            Object.assign(overlay.style, { top: '0', left: '0', width: '100%', height: '100%' });
        }

        const waitingDiv = document.createElement('div');
        waitingDiv.className = 'aab-waiting';
        waitingDiv.style.cssText = 'color:#888; font-size:12px;';
        waitingDiv.textContent = 'Scanning for conversations...';
        container.appendChild(waitingDiv);

        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    function updateOverlay() {
        const state = window.__autoAllState;
        const container = document.getElementById('aab-c');

        if (!container) {
            log('[Overlay] updateOverlay: No container found, skipping');
            return;
        }

        log(`[Overlay] updateOverlay call: tabNames count=${state.tabNames?.length || 0}`);
        const newNames = state.tabNames || [];

        if (newNames.length === 0) {
            if (!container.querySelector('.aab-waiting')) {
                container.textContent = '';
                const waitingDiv = document.createElement('div');
                waitingDiv.className = 'aab-waiting';
                waitingDiv.style.cssText = 'color:#888; font-size:12px;';
                waitingDiv.textContent = 'Scanning for conversations...';
                container.appendChild(waitingDiv);
            }
            return;
        }

        const waiting = container.querySelector('.aab-waiting');
        if (waiting) waiting.remove();

        const currentSlots = Array.from(container.querySelectorAll('.aab-slot'));

        currentSlots.forEach(slot => {
            const name = slot.getAttribute('data-name');
            if (!newNames.includes(name)) slot.remove();
        });

        newNames.forEach(name => {
            const status = state.completionStatus[name];
            const isDone = status === 'done';

            const statusClass = isDone ? 'done' : 'working';
            const statusText = isDone ? 'COMPLETED' : 'IN PROGRESS';
            const progressWidth = isDone ? '100%' : '66%';

            let slot = container.querySelector(`.aab-slot[data-name="${name}"]`);

            if (!slot) {
                slot = document.createElement('div');
                slot.className = `aab-slot ${statusClass}`;
                slot.setAttribute('data-name', name);

                const header = document.createElement('div');
                header.className = 'aab-header';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                header.appendChild(nameSpan);

                const statusSpan = document.createElement('span');
                statusSpan.className = 'status-text';
                statusSpan.textContent = statusText;
                header.appendChild(statusSpan);

                slot.appendChild(header);

                const track = document.createElement('div');
                track.className = 'aab-progress-track';

                const fill = document.createElement('div');
                fill.className = 'aab-progress-fill';
                fill.style.width = progressWidth;
                track.appendChild(fill);

                slot.appendChild(track);
                container.appendChild(slot);
                log(`[Overlay] Created slot: ${name} (${statusText})`);
            } else {

                slot.className = `aab-slot ${statusClass}`;

                const statusSpan = slot.querySelector('.status-text');
                if (statusSpan) statusSpan.textContent = statusText;

                const bar = slot.querySelector('.aab-progress-fill');
                if (bar) bar.style.width = progressWidth;
            }
        });

        // Add Bump Timer Display
        let timerSlot = container.querySelector('.aab-timer-slot');
        if (!timerSlot) {
            timerSlot = document.createElement('div');
            timerSlot.className = 'aab-timer-slot';
            timerSlot.style.cssText = 'font-size: 10px; color: #888; margin-top: 8px; text-align: center;';
            container.appendChild(timerSlot);
        }

        if (state.bumpEnabled) {
            const now = Date.now();
            const cooldown = state.autoApproveDelay || 30000;
            // logic: max delay - (now - lastAction)
            let referenceTime = Math.max(lastClickTime || state.stats.sessionStartTime, lastBumpTime || 0);
            const timeSinceRef = now - referenceTime;
            const remaining = Math.max(0, Math.ceil((cooldown - timeSinceRef) / 1000));

            if (remaining > 0) {
                timerSlot.textContent = `Auto-Bump in ${remaining}s...`;
                timerSlot.style.color = '#aaa';
            } else {
                timerSlot.textContent = `Auto-Bump: Ready`;
                timerSlot.style.color = '#4ade80';
            }
        } else {
            timerSlot.textContent = '';
        }
    }

    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            log('[Overlay] Hiding overlay...');
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        }
    }

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
        const state = window.__autoAllState;
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
        let text = (el.textContent || "").trim().toLowerCase();

        // Fallback: If text is empty, check aria-label or title (common for icon-only buttons like "Run")
        if (text.length === 0) {
            text = (el.getAttribute('aria-label') || "").trim().toLowerCase();
        }
        if (text.length === 0) {
            text = (el.getAttribute('title') || "").trim().toLowerCase();
        }

        if (text.length === 0 || text.length > 50) return false;

        // Use configured patterns from state if available, otherwise use defaults
        const state = window.__autoAllState || {};
        const defaultPatterns = ['accept', 'accept all', 'run', 'run command', 'retry', 'apply', 'execute', 'confirm', 'allow once', 'allow', 'proceed', 'continue', 'yes', 'ok', 'save', 'approve', 'overwrite'];

        // Safety: Do not click buttons in the Extensions view or Source Control (unless specific)
        if (el.closest && (el.closest('.extensions-viewlet') || el.closest('[id="workbench.view.extensions"]'))) {
            log(`[SAFETY] Skipping button in Extensions view: "${text}"`);
            return false;
        }
        const patterns = state.acceptPatterns || defaultPatterns;

        const defaultRejects = ['skip', 'reject', 'cancel', 'close', 'refine', 'deny', 'no', 'dismiss', 'abort', 'ask every time', 'always run', 'always allow', 'stop', 'pause', 'disconnect'];
        const rejects = state.rejectPatterns ? [...defaultRejects, ...state.rejectPatterns] : defaultRejects;

        if (rejects.some(r => text.includes(r))) return false;
        if (!patterns.some(p => text.includes(p))) return false;

        const isCommandButton = text.includes('run') || text.includes('execute') || text.includes('accept');

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
                log('Detected SCM Accept All -> Using Command');
                sendCommandToBridge('git.stageAll');
                return true;
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
                    requestAnimationFrame(check);
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
        // Expand collapsed sections ONLY within the chat/response area
        // IMPORTANT: Do NOT query globally — that would click file explorer, sidebar, etc.
        const expandTargets = [];
        let clicked = 0;

        // Scope: broad search within the active editor/workbench area
        // We look for any element with aria-expanded="false" that is inside a relevant container
        const workbench = document.querySelector('.monaco-workbench') || document.body;

        // 1. Generic aria-expanded check (most reliable)
        const candidates = workbench.querySelectorAll('[aria-expanded="false"]');
        for (const el of candidates) {
            if (!isElementVisible(el)) continue;

            // Filter out obvious noise (like file explorer trees if we are not focused there)
            // But keep it broad enough to catch chat response toggles
            if (el.matches('.monaco-list-row, .monaco-tl-row, .monaco-tree-row')) {
                // Check if it looks like a "step" or "run" item
                const text = (el.textContent || '').toLowerCase();
                if (text.includes('run') || text.includes('step') || text.includes('command') || text.includes('terminal')) {
                    expandTargets.push(el);
                }
            } else {
                // Chevrons/Buttons
                expandTargets.push(el);
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
                        await workerDelay(100); // Wait for UI debounce

                        // Try finding send button
                        const sendEl = findVisibleElementBySelectors(getUnifiedSendButtonSelectors(profile));
                        if (sendEl) {
                            log(`[Chat] Found send button, clicking...`);
                            await remoteClick(sendEl);
                            await workerDelay(500); // Wait for reaction
                            return true;
                        } else {
                            log(`[Chat] Send button not found, trying Enter key...`);
                        }

                        // Method B: Keyboard Submit (Enter)
                        const success = await submitWithKeys();
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
        console.log('__ANTIGRAVITY_HYBRID_BUMP__:' + text);
        // Also try legacy type command just in case
        console.log('__ANTIGRAVITY_TYPE__:' + text);
        return true; // We assume bridge handles it
    }

    let lastBumpTime = 0;
    let lastClickTime = 0;

    async function autoBump() {
        const state = window.__autoAllState;
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

    async function performClick(selectors) {
        debugLog(`[performClick] Started for selectors: ${JSON.stringify(selectors)}`);
        // PRE-CHECK: Expand any collapsed sections that might be hiding buttons
        await expandCollapsedSections();

        let found = [];
        selectors.forEach(s => queryAll(s).forEach(el => {
            if (isValidInteractionTarget(el)) found.push(el);
        }));

        if (found.length === 0) {
            const fallbackSelectors = [
                ...getUnifiedClickSelectors('vscode'),
                ...getUnifiedClickSelectors('antigravity'),
                ...getUnifiedClickSelectors('cursor'),
                // User Requested "Gold Standard" coverage:
                '[aria-label*="Allow"]', '[title*="Allow"]', 'button:contains("Allow")',
                '[aria-label*="Accept All"]', '[title*="Accept All"]', 'button:contains("Accept All")',
                '[aria-label*="Yes"]', '[title*="Yes"]',
                '.monaco-button:contains("Allow")',
                '.monaco-button:contains("Accept")'
            ];
            [...new Set(fallbackSelectors)].forEach(s => queryAll(s).forEach(el => {
                if (isValidInteractionTarget(el)) found.push(el);
            }));
        }

        // If nothing found, try expanding ONE MORE TIME aggressively, then search again
        if (found.length === 0) {
            const expanded = await expandCollapsedSections();
            if (expanded) {
                selectors.forEach(s => queryAll(s).forEach(el => found.push(el)));

                if (found.length === 0) {
                    const fallbackSelectors = [
                        ...getUnifiedClickSelectors('vscode'),
                        ...getUnifiedClickSelectors('antigravity'),
                        ...getUnifiedClickSelectors('cursor')
                    ];
                    [...new Set(fallbackSelectors)].forEach(s => queryAll(s).forEach(el => {
                        if (isValidInteractionTarget(el)) found.push(el);
                    }));
                }
            }
        }

        debugLog(`[performClick] Expansion and fallback completed. Found ${found.length} elements.`);
        let clicked = 0;
        let verified = 0;
        const uniqueFound = [...new Set(found)];

        for (const el of uniqueFound) {
            // FILTER: Only interact with buttons matching allowlist/rejectlist
            if (!isAcceptButton(el)) {
                // log(`[Filter] Skipping non-accept button: "${el.textContent?.substring(0, 20)}..."`);
                continue;
            }

            // Stuck Button Detection
            const state = window.__autoAllState;
            if (!state.clickHistory) state.clickHistory = { signature: '', count: 0 };

            if (isAcceptButton(el)) {
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

                                log('[Hybrid] Focusing terminal...');
                                sendCommandToBridge('workbench.action.terminal.focus');
                                await workerDelay(100);

                                log('[Hybrid] Pasting...');
                                sendCommandToBridge('workbench.action.terminal.paste');
                                await workerDelay(100);

                                // Send Enter?
                                await workerDelay(100);
                                log('[Hybrid] Pressing Enter manually');
                                sendCommandToBridge('workbench.action.terminal.chat.accept');

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
                    log('Detected SCM Accept -> Sending git.stageAll');
                    sendCommandToBridge('git.stageAll');

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
                        log(`[StuckGuard] Button stubborn (2nd attempt). Trying Keypress Fallback...`);
                        triggerKeypressFallback(el);
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
        const state = window.__autoAllState;
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

    async function cursorLoop(sid) {
        log('[Loop] cursorLoop STARTED');
        let index = 0;
        let cycle = 0;
        while (window.__autoAllState.isRunning && window.__autoAllState.sessionID === sid) {
            try {
                const timing = window.__antigravityConfig?.timing || {};
                const pollInterval = timing.pollIntervalMs || 800;
                const throttle = timing.actionThrottleMs || 100;
                const cooldown = timing.cooldownMs || 3000;

                // Gold Standard: Update Coverage Metrics for Self-Test
                updateProfileCoverage();

                // 2. Click Feedback Buttons (if enabled)
                if (window.__antigravityConfig && window.__antigravityConfig.clickFeedback) {
                    await performClick(getUnifiedFeedbackSelectors('cursor'), { skipAcceptCheck: true });
                }

                const clicked = await performClick(getUnifiedClickSelectors('cursor'));
                if (clicked > 0) {
                    log(`[Loop] Cycle ${cycle}: Clicked ${clicked} buttons`);
                } else {
                    const bumped = await autoBump();
                    if (bumped) {
                        log(`[Loop] Cycle ${cycle}: Auto-bumped conversation`);
                        await workerDelay(cooldown);
                    }
                }

                await workerDelay(pollInterval);

                const tabSelectors = [
                    '#workbench\\.parts\\.auxiliarybar ul[role="tablist"] li[role="tab"]',
                    '.monaco-pane-view .monaco-list-row[role="listitem"]',
                    'div[role="tablist"] div[role="tab"]',
                    '.chat-session-item'
                ];

                let tabs = [];
                for (const selector of tabSelectors) {
                    tabs = queryAll(selector);
                    if (tabs.length > 0) {
                        log(`[Loop] Cycle ${cycle}: Found ${tabs.length} tabs using selector: ${selector}`);
                        break;
                    }
                }

                if (tabs.length === 0) {
                    log(`[Loop] Cycle ${cycle}: No tabs found in any known locations.`);
                }

                updateTabNames(tabs);

                if (tabs.length > 0) {
                    const targetTab = tabs[index % tabs.length];
                    const tabLabel = targetTab.getAttribute('aria-label') || targetTab.textContent?.trim() || 'unnamed tab';
                    log(`[Loop] Cycle ${cycle}: Clicking tab "${tabLabel}"`);
                    targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                    index++;
                }

                const state = window.__autoAllState;
                log(`[Loop] Cycle ${cycle}: State = { tabs: ${state.tabNames?.length || 0}, isRunning: ${state.isRunning}, sid: ${state.sessionID} }`);

                updateOverlay();

                const waitTime = window.__autoAllState.threadWaitInterval || 5000;
                log(`[Loop] Cycle ${cycle}: Overlay updated, waiting ${waitTime}ms...`);
                await workerDelay(waitTime);
            } catch (loopErr) {
                log(`[Loop] Cycle ${cycle}: ERROR - ${loopErr.message}`);
                await workerDelay(2000);
            }
        }
        log('[Loop] cursorLoop STOPPED');
    }

    async function antigravityLoop(sid) {
        log('[Loop] antigravityLoop STARTED');
        let index = 0;
        let cycle = 0;

        while (window.__autoAllState.isRunning && window.__autoAllState.sessionID === sid) {
            try {
                cycle++;
                log(`[Loop] Cycle ${cycle}: Starting...`);

                // Expand any collapsed sections (e.g. "Step Requires Input")
                await expandCollapsedSections();

                // 2. Click Feedback Buttons (if enabled)
                if (window.__antigravityConfig && window.__antigravityConfig.clickFeedback) {
                    await performClick(getUnifiedFeedbackSelectors('antigravity'), { skipAcceptCheck: true });
                }

                // Just click accept buttons directly - no dropdown interaction needed
                // Added selectors for Diff Editor actions and SCM titles
                const clicked = await performClick(getUnifiedClickSelectors('antigravity'));
                if (clicked > 0) {
                    log(`[Loop] Cycle ${cycle}: Clicked ${clicked} accept buttons`);
                } else {
                    // No buttons found — check if AI is idle and auto-bump
                    const bumped = await autoBump();
                    if (bumped) {
                        log(`[Loop] Cycle ${cycle}: Auto-bumped conversation`);
                        await workerDelay(3000);
                    }
                }

                await workerDelay(1500);

                const tabs = queryAll('button.grow');
                log(`[Loop] Cycle ${cycle}: Found ${tabs.length} tabs`);
                updateTabNames(tabs);

                if (tabs.length > 1) {
                    const targetTab = tabs[index % tabs.length];
                    const tabName = stripTimeSuffix(targetTab.textContent);

                    const state = window.__autoAllState;
                    if (state.completionStatus[tabName] !== 'done') {
                        log(`[Loop] Cycle ${cycle}: Switching to tab "${tabName}"`);
                        targetTab.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
                        index++;

                        await workerDelay(2000);

                        const badges = queryAll('span').filter(s => {
                            const t = s.textContent.trim();
                            return t === 'Good' || t === 'Bad';
                        });

                        if (badges.length > 0) {
                            updateConversationCompletionState(tabName, 'done');
                            log(`[Loop] Cycle ${cycle}: Tab "${tabName}" marked as DONE`);
                        }
                    } else {

                        index++;
                        log(`[Loop] Cycle ${cycle}: Skipping completed tab "${tabName}"`);
                    }
                }

                updateOverlay();

                const waitTime = window.__autoAllState.threadWaitInterval || 5000;
                await workerDelay(waitTime);
            } catch (loopErr) {
                log(`[Loop] antigravityLoop Cycle ${cycle}: ERROR - ${loopErr.message}`);
                await workerDelay(2000);
            }
        }
        log('[Loop] antigravityLoop STOPPED');
    }

    window.__autoAllUpdateBannedCommands = function (bannedList) {
        const state = window.__autoAllState;
        state.bannedCommands = Array.isArray(bannedList) ? bannedList : [];
        log(`[Config] Updated banned commands list: ${state.bannedCommands.length} patterns`);
        if (state.bannedCommands.length > 0) {
            log(`[Config] Banned patterns: ${state.bannedCommands.join(', ')}`);
        }
    };

    window.__autoAllUpdateAcceptPatterns = function (patternList) {
        const state = window.__autoAllState;
        state.acceptPatterns = Array.isArray(patternList) && patternList.length > 0 ? patternList : null;
        log(`[Config] Updated accept patterns: ${state.acceptPatterns ? state.acceptPatterns.length + ' patterns' : 'using defaults'}`);
    };

    window.__autoAllUpdateRejectPatterns = function (patternList) {
        const state = window.__autoAllState;
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

    window.__autoAllGetRuntimeState = function () {
        try {
            return getRuntimeStateSnapshot();
        } catch (e) {
            log(`[State] Failed to compute runtime state: ${e.message}`);
            return {
                status: 'error',
                isRunning: !!window.__autoAllState?.isRunning,
                error: String(e.message || e),
                timestamp: Date.now()
            };
        }
    };

    window.__autoAllSetFocusState = function (isFocused) {
        Analytics.setFocusState(isFocused, log);
    };

    // Helper for visual feedback
    window.showAutoAllToast = function (text, duration = 3000, color = 'rgba(0,100,0,0.8)') {
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed;top:10px;right:10px;z-index:99999;background:${color};color:white;padding:10px;border-radius:5px;font-family:sans-serif;pointer-events:none;transition:opacity 1s;`;
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 1000); }, duration);
    };

    window.__autoAllStart = async function (config) {
        try {
            const ide = (config.ide || 'cursor').toLowerCase();
            const isPro = config.isPro !== false;
            const isBG = config.isBackgroundMode === true;

            // Visual confirmation of injection
            window.showAutoAllToast('Antigravity v4.2.6 Active 🚀');

            if (config.bannedCommands) {
                window.__autoAllUpdateBannedCommands(config.bannedCommands);
            }
            if (config.acceptPatterns) {
                window.__autoAllUpdateAcceptPatterns(config.acceptPatterns);
            }
            if (config.rejectPatterns) {
                window.__autoAllUpdateRejectPatterns(config.rejectPatterns);
            }

            log(`__autoAllStart called: ide=${ide}, isPro=${isPro}, isBG=${isBG}`);

            const state = window.__autoAllState;

            // If already running, just update config and return — do NOT restart
            // The 5-second poll timer calls this repeatedly; restarting would kill the loop
            if (state.isRunning) {
                // Update config values in-place (hot reload)
                state.bumpMessage = config.bumpMessage || '';
                state.autoApproveDelay = (config.autoApproveDelay || 30) * 1000;
                state.bumpEnabled = !!config.bumpMessage;
                state.threadWaitInterval = (config.threadWaitInterval || 5) * 1000;
                log(`[Config] Hot-reloaded config (loop still running)`);
                return;
            }

            state.isRunning = true;
            state.currentMode = ide;
            state.isBackgroundMode = isBG;
            state.sessionID++;
            const sid = state.sessionID;

            // Store user config in state for bump/loops to use
            state.bumpMessage = config.bumpMessage || '';
            state.bumpMessage = config.bumpMessage || '';
            state.autoApproveDelay = (config.autoApproveDelay || 10) * 1000; // Default 10s
            state.bumpEnabled = !!config.bumpMessage;
            state.threadWaitInterval = (config.threadWaitInterval || 3) * 1000;
            state.bumpEnabled = !!config.bumpMessage;
            state.threadWaitInterval = (config.threadWaitInterval || 5) * 1000;
            log(`[Config] bumpMessage="${state.bumpMessage}", autoApproveDelay=${state.autoApproveDelay}ms, threadWait=${state.threadWaitInterval}ms`);

            if (!state.stats.sessionStartTime) {
                state.stats.sessionStartTime = Date.now();
            }

            log(`Agent Loaded (IDE: ${ide}, BG: ${isBG}, isPro: ${isPro})`, true);

            if (isBG && isPro) {
                log(`[BG] Starting background loop (no overlay)...`);

                log(`[BG] Starting ${ide} loop...`);
                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else if (isBG && !isPro) {
                log(`[BG] Background mode without Pro...`);

                if (ide === 'cursor') cursorLoop(sid);
                else antigravityLoop(sid);
            } else {
                hideOverlay();
                log(`Starting static poll loop...`);
                (async function staticLoop() {
                    while (state.isRunning && state.sessionID === sid) {
                        try {
                            const clicks = await performClick(getUnifiedClickSelectors(getCurrentMode()));
                            if (clicks === 0) await autoBump();
                            await workerDelay(config.pollInterval || 1000);
                        } catch (loopErr) {
                            log(`[Loop] staticLoop ERROR: ${loopErr.message}`);
                            await workerDelay(2000);
                        }
                    }
                })();
            }
        } catch (e) {
            log(`ERROR in __autoAllStart: ${e.message}`);
            console.error('[autoAll] Start error:', e);
        }
    };

    window.__autoAllStop = function () {
        window.__autoAllState.isRunning = false;
        hideOverlay();
        log("Agent Stopped.");
    };

    // --- Heartbeat Loop (Watchdog) ---
    (function heartbeatLoop() {
        if (window.__autoAllState?.isRunning) {
            const timestamp = Date.now();
            window.__antigravityHeartbeat = timestamp;

            // Send heartbeat via bridge if available
            if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                // Too noisy for console, just update global var or send specific heartbeat msg if needed.
                // For now, we'll rely on CDP Runtime.evaluate of window.__antigravityHeartbeat
            }
        }
        setTimeout(heartbeatLoop, 2000); // Pulse every 2s
    })();

    log("Core Bundle Initialized.", true);
})();
