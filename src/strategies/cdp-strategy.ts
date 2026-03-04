import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { logToOutput } from '../utils/output-channel';

// Legacy Type stub for extension.ts compatibility
export type CDPRuntimeState = any;

/**
 * v6.0.0 — Nuclear simplified CDP Strategy.
 *
 * Does exactly 2 things:
 * 1. Clicks action buttons (Run, Expand, Accept All, Keep, Retry, Allow, Continue) when probe detects them
 * 2. Types and submits bump text when conversation is stalled
 *
 * All button detection is scoped to chat panel containers (.interactive-session, .chat-widget).
 * NO focus() calls. NO keyboard dispatching to global window.
 */
export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;
    private cdpHandler: CDPHandler;
    private statusBarItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;
    private controllerRoleIsLeader = false;

    // State tracking
    private lastActionAt = 0;
    private lastActivityAt = Date.now();
    private wasGenerating = false;
    private stallTimer: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        const { cdpClient } = require('../providers/cdp-client');
        this.cdpHandler = cdpClient.getHandler();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9999);
        this.statusBarItem.command = 'antigravity.toggleAutoAccept';
        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader);
    }

    setControllerRole(isLeader: boolean): void {
        this.controllerRoleIsLeader = !!isLeader;
        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader);
    }

    setHostWindowFocused(focused: boolean): void {
        this.cdpHandler.setHostWindowFocused(!!focused);
    }

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.updateStatusBar();

        void (async () => {
            await this.cdpHandler.connect();
        })();

        // --- STATE EVENT HANDLER (from probe) ---
        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const isGenerating = state.isGenerating;
            const buttons: string[] = state.buttons || [];

            logToOutput('[State] Gen: ' + isGenerating + ', Buttons: ' + buttons.join(', '));

            if (isGenerating) {
                this.wasGenerating = true;
                this.lastActivityAt = now;
            } else if (this.wasGenerating) {
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Throttle: no action within 3 seconds of last action
            if (now - this.lastActionAt < 3000) return;

            const enabled = !!config.get<boolean>('autopilotAutoAcceptEnabled')
                || !!config.get<boolean>('autoAllEnabled')
                || !!config.get<boolean>('autoAcceptEnabled');

            if (!enabled || buttons.length === 0 || isGenerating) return;

            // Priority order: run > expand > allow > accept_all > keep > retry > continue
            const btnPriority = ['run', 'expand', 'allow', 'accept_all', 'keep', 'retry', 'continue'];
            let targetBtn: string | null = null;
            for (const b of btnPriority) {
                if (buttons.includes(b)) { targetBtn = b; break; }
            }
            if (!targetBtn) return;

            this.lastActionAt = now;
            this.lastActivityAt = now;

            // Map button ID to exact text to match in the click script
            const textMap: Record<string, string[]> = {
                run: ['run', 'run tool'],
                expand: ['expand', 'requires input'],
                allow: ['allow', 'always allow'],
                accept_all: ['accept all', 'apply all'],
                keep: ['keep'],
                retry: ['retry'],
                continue: ['continue'],
            };
            const matchTexts = textMap[targetBtn] || [targetBtn];

            logToOutput('[Autopilot] Clicking: ' + targetBtn);

            // Script that finds and clicks the EXACT button inside chat containers
            const clickScript = `(() => {
                var matchTexts = ${JSON.stringify(matchTexts)};
                function findChatContainers() {
                    var containers = [];
                    var queue = [document];
                    while (queue.length > 0) {
                        var root = queue.shift();
                        try {
                            var found = root.querySelectorAll('.interactive-session, .chat-widget, .interactive-input-part, [class*="chat-editor"]');
                            for (var i = 0; i < found.length; i++) containers.push(found[i]);
                            var all = root.querySelectorAll('*');
                            for (var j = 0; j < all.length; j++) {
                                try { if (all[j].shadowRoot) queue.push(all[j].shadowRoot); } catch(e) {}
                            }
                        } catch(e) {}
                    }
                    return containers;
                }
                var containers = findChatContainers();
                for (var c = 0; c < containers.length; c++) {
                    try {
                        var btns = containers[c].querySelectorAll('button, [role="button"], .monaco-button');
                        for (var i = 0; i < btns.length; i++) {
                            try {
                                var b = btns[i];
                                if (!b.isConnected || b.disabled) continue;
                                if (b.clientWidth === 0 && b.clientHeight === 0) continue;
                                var text = (b.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                                var title = (b.getAttribute('title') || '').toLowerCase().trim();
                                var aria = (b.getAttribute('aria-label') || '').toLowerCase().trim();
                                for (var m = 0; m < matchTexts.length; m++) {
                                    if (text === matchTexts[m] || title === matchTexts[m] || aria === matchTexts[m]) {
                                        b.click();
                                        return 'clicked:' + text;
                                    }
                                }
                            } catch(e) {}
                        }
                    } catch(e) {}
                }
                return 'not-found';
            })()`;

            const results = await this.cdpHandler.executeInAllSessions(clickScript).catch(() => null);
            logToOutput('[Click] ' + targetBtn + ' => ' + JSON.stringify(results));
        });

        // --- INDEPENDENT STALL TIMER (HARDCODED — zero config dependencies) ---
        const STALL_TIMEOUT_MS = 10000;  // 10 seconds of no activity = stalled
        const BUMP_COOLDOWN_MS = 30000;  // 30 seconds between bumps
        const BUMP_TEXT = config.get<string>('actions.bump.text') || 'Proceed';

        this.stallTimer = setInterval(async () => {
            const now = Date.now();
            const activityAge = now - this.lastActivityAt;
            const actionAge = now - this.lastActionAt;

            // UNCONDITIONAL log — this MUST appear every 3 seconds to prove the timer runs
            logToOutput(`[TICK] active=${this.isActive} leader=${this.controllerRoleIsLeader} actAge=${activityAge}ms actionAge=${actionAge}ms`);

            if (!this.isActive || !this.controllerRoleIsLeader) return;
            if (activityAge < STALL_TIMEOUT_MS) return;
            if (actionAge < BUMP_COOLDOWN_MS) return;

            this.lastActionAt = now;
            this.lastActivityAt = now;
            logToOutput('[Bump] FIRING — stalled ' + activityAge + 'ms, sending: "' + BUMP_TEXT + '"');

            try {
                // Diagnostic + multi-strategy bump script
                const bumpScript = `(() => {
                    var bumpText = ${JSON.stringify(BUMP_TEXT)};
                    var diag = {};

                    // ---- STRATEGY 1: Scoped to chat containers ----
                    var chatSelectors = [
                        '.interactive-session', '.chat-widget', '.interactive-input-part',
                        '[class*="chat-editor"]', '[class*="chat-input"]',
                        '.aichat-input', '.aichat', '[class*="aichat"]',
                        '[class*="interactive"]'
                    ].join(', ');
                    var containers = [];
                    try {
                        containers = Array.from(document.querySelectorAll(chatSelectors));
                    } catch(e) {}
                    diag.containers = containers.length;
                    diag.containerClasses = containers.slice(0,3).map(function(c) { return c.className.substring(0,80); });

                    var chatInput = null;
                    // Look inside containers for inputs
                    for (var c = 0; c < containers.length && !chatInput; c++) {
                        try {
                            var inputs = containers[c].querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], .monaco-editor textarea');
                            for (var i = 0; i < inputs.length; i++) {
                                var el = inputs[i];
                                if (!el.isConnected || el.clientWidth === 0 && el.clientHeight === 0) continue;
                                var label = (el.getAttribute('aria-label') || '').toLowerCase();
                                if (label.indexOf('search') >= 0 || label.indexOf('find') >= 0 || label.indexOf('filter') >= 0) continue;
                                chatInput = el;
                                break;
                            }
                        } catch(e) {}
                    }
                    diag.strategy1 = chatInput ? 'found' : 'miss';

                    // ---- STRATEGY 2: Look for Monaco editor textareas in whole document ----
                    if (!chatInput) {
                        try {
                            var monacoTextareas = document.querySelectorAll('.monaco-editor textarea.inputarea');
                            diag.monacoTextareas = monacoTextareas.length;
                            for (var m = 0; m < monacoTextareas.length; m++) {
                                var mt = monacoTextareas[m];
                                if (!mt.isConnected) continue;
                                // Find the closest ancestor with 'chat' or 'interactive' or 'input-part' in class
                                var ancestor = mt.closest('[class*="chat"], [class*="interactive"], [class*="input-part"], [class*="aichat"]');
                                if (ancestor) {
                                    chatInput = mt;
                                    diag.strategy2 = 'found-via-ancestor:' + ancestor.className.substring(0,50);
                                    break;
                                }
                            }
                            if (!chatInput) diag.strategy2 = 'miss';
                        } catch(e) { diag.strategy2 = 'error:' + e.message; }
                    }

                    // ---- STRATEGY 3: Any textarea or contenteditable in whole doc, skip search/find ----
                    if (!chatInput) {
                        try {
                            var allInputs = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
                            diag.allInputs = allInputs.length;
                            var inputLabels = [];
                            for (var a = 0; a < allInputs.length; a++) {
                                var ai = allInputs[a];
                                var lbl = (ai.getAttribute('aria-label') || ai.getAttribute('placeholder') || ai.tagName).substring(0,40);
                                inputLabels.push(lbl + '(' + ai.clientWidth + 'x' + ai.clientHeight + ')');
                                if (!ai.isConnected || ai.clientWidth === 0 && ai.clientHeight === 0) continue;
                                var l2 = (ai.getAttribute('aria-label') || '').toLowerCase();
                                if (l2.indexOf('search') >= 0 || l2.indexOf('find') >= 0 || l2.indexOf('filter') >= 0) continue;
                                // Take the last visible non-search input (likely the chat input at the bottom)
                                chatInput = ai;
                            }
                            diag.inputLabels = inputLabels;
                            diag.strategy3 = chatInput ? 'found' : 'miss';
                        } catch(e) { diag.strategy3 = 'error:' + e.message; }
                    }

                    if (!chatInput) return 'no-chat-input|diag:' + JSON.stringify(diag);

                    // ---- TYPE TEXT ----
                    try {
                        if (chatInput.tagName === 'TEXTAREA' || chatInput.tagName === 'INPUT') {
                            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                                         Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                            if (setter && setter.set) setter.set.call(chatInput, bumpText);
                            else chatInput.value = bumpText;
                            chatInput.dispatchEvent(new Event('input', {bubbles: true}));
                        } else {
                            chatInput.textContent = bumpText;
                            chatInput.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: bumpText}));
                        }
                    } catch(e) { return 'type-error:' + e.message + '|diag:' + JSON.stringify(diag); }

                    // ---- SUBMIT VIA ENTER ----
                    setTimeout(function() {
                        try {
                            chatInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                        } catch(e) {}
                    }, 200);

                    return 'bumped:' + (chatInput.getAttribute('aria-label') || chatInput.tagName) + '|diag:' + JSON.stringify(diag);
                })()`;

                const results = await this.cdpHandler.executeInAllSessions(bumpScript).catch((e: any) => 'exec-error:' + (e?.message || e));
                logToOutput('[Bump] Result: ' + JSON.stringify(results));
            } catch (e: any) {
                logToOutput('[Bump] ERROR: ' + (e?.message || e));
            }
        }, 3000);

        vscode.window.showInformationMessage('Antigravity: CDP Strategy v6 ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;
        if (this.stallTimer) { clearInterval(this.stallTimer); this.stallTimer = null; }
        this.cdpHandler.disconnectAll();
        this.cdpHandler.removeAllListeners('state');
        this.updateStatusBar();
    }

    private updateStatusBar() {
        if (this.isActive) {
            this.statusBarItem.text = '$(check) CDP: ON';
            this.statusBarItem.tooltip = 'CDP Strategy Active';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(circle-slash) CDP: OFF';
            this.statusBarItem.tooltip = 'CDP Strategy Inactive';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.statusBarItem.show();
    }

    dispose() { this.stop(); this.statusBarItem.dispose(); }

    // --- STUBS for extension.ts compatibility ---
    isConnected(): boolean { return this.cdpHandler.isConnected(); }
    async getRuntimeState(): Promise<CDPRuntimeState> { return {}; }
    async executeAction(action: string): Promise<void> { }
    async sendHybridBump(message: string): Promise<boolean> { return true; }
    async sendInputSubmitFallback(): Promise<boolean> { return true; }
    async testMethod(methodName: string, text?: string): Promise<boolean> { return true; }
}
