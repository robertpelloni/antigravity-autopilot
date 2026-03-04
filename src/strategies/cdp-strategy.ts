import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { logToOutput } from '../utils/output-channel';

// Legacy Type stub for extension.ts compatibility
export type CDPRuntimeState = any;

/**
 * v8.1.0 — Radically simplified CDP Strategy.
 *
 * FIVE functions, ZERO clipboard usage:
 * 1. Detect fork (Antigravity vs VS Code vs Cursor)
 * 2. Detect stalled conversation (timer-based)
 * 3. Click buttons (Run, Expand, Accept All, Keep, Retry, Allow, Continue) — via CDP DOM injection
 * 4. Type bump text — via CDP DOM injection (textarea .value direct assignment)
 * 5. Submit bump text — via CDP DOM injection (KeyboardEvent Enter on textarea)
 *
 * ALL interaction goes through cdpHandler.executeInAllSessions() — the ONE method proven to work.
 *
 * KEY DOCS (from KI):
 * - Focus hazard: CDP Input commands target active element; if chat isn't focused, they hit wrong UI
 * - Solution: Use pure script injection targeting textarea elements
 * - Must exclude search/find/filter inputs by aria-label/placeholder
 * - Use .value = text, dispatch input+change events, then synthetic Enter
 */
export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;
    private cdpHandler: CDPHandler;
    private statusBarItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;
    private controllerRoleIsLeader = false;

    // Separate throttles for clicks vs bumps
    private lastClickAt = 0;
    private lastBumpAt = 0;
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
        this.lastActivityAt = Date.now();
        this.lastClickAt = 0;
        this.lastBumpAt = 0;
        this.updateStatusBar();

        void (async () => { await this.cdpHandler.connect(); })();

        // ─── STATE EVENT HANDLER (from probe) ───
        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const isGenerating = state.isGenerating;
            const buttons: string[] = state.buttons || [];

            logToOutput('[State] Gen: ' + isGenerating + ', Buttons: ' + buttons.join(', '));

            // Track activity for stall detection
            if (isGenerating) {
                this.wasGenerating = true;
                this.lastActivityAt = now;
            } else if (this.wasGenerating) {
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Button clicks have their own separate 2s throttle
            if (now - this.lastClickAt < 2000) return;

            const enabled = !!config.get<boolean>('autopilotAutoAcceptEnabled')
                || !!config.get<boolean>('autoAllEnabled')
                || !!config.get<boolean>('autoAcceptEnabled');

            if (!enabled || buttons.length === 0 || isGenerating) return;

            // Priority order for button clicks
            const btnPriority = ['run', 'expand', 'allow', 'accept_all', 'keep', 'retry', 'continue'];
            let targetBtn: string | null = null;
            for (const b of btnPriority) {
                if (buttons.includes(b)) { targetBtn = b; break; }
            }
            if (!targetBtn) return;

            this.lastClickAt = now;
            this.lastActivityAt = now;

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

            // ─── BUTTON CLICK via CDP DOM injection (PROVEN WORKING) ───
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
                                    if (text === matchTexts[m] || title === matchTexts[m] || aria === matchTexts[m] ||
                                        text.indexOf(matchTexts[m]) >= 0) {
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

        // ─── STALL TIMER ───
        const STALL_TIMEOUT_MS = 10000;  // 10 seconds of no activity = stalled
        const BUMP_COOLDOWN_MS = 30000;  // 30 seconds between bumps
        const BUMP_TEXT = config.get<string>('actions.bump.text') || 'Proceed';

        this.stallTimer = setInterval(async () => {
            const now = Date.now();
            const activityAge = now - this.lastActivityAt;
            const bumpAge = now - this.lastBumpAt;

            logToOutput(`[TICK] active=${this.isActive} leader=${this.controllerRoleIsLeader} actAge=${activityAge}ms bumpAge=${bumpAge}ms`);

            if (!this.isActive || !this.controllerRoleIsLeader) return;
            if (activityAge < STALL_TIMEOUT_MS) return;
            if (bumpAge < BUMP_COOLDOWN_MS) return;

            this.lastBumpAt = now;
            this.lastActivityAt = now;
            logToOutput('[Bump] FIRING — stalled ' + activityAge + 'ms, sending: "' + BUMP_TEXT + '"');

            // ALL via CDP executeInAllSessions — ZERO clipboard, ZERO VS Code Input commands
            try {
                // Step 1: Focus the chat panel via VS Code command (safe, just changes focus)
                logToOutput('[Bump] Step 1: Focus chat panel via VS Code command...');
                try {
                    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                } catch {
                    // Fallback: try other focus commands
                    try { await vscode.commands.executeCommand('workbench.action.chat.open'); } catch { }
                }
                await new Promise(r => setTimeout(r, 500));

                // Step 2: Type text via CDP script injection into textarea (KI-documented method)
                // Find textarea, exclude search/find inputs, set .value directly
                logToOutput('[Bump] Step 2: DOM textarea value injection "' + BUMP_TEXT + '"...');
                const escapedText = BUMP_TEXT.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                const typeScript = `(() => {
                    try {
                        // Strategy from KI: find textarea, exclude search/find/filter by aria-label
                        function queryShadowDOMAll(selector, root) {
                            root = root || document;
                            var results = [];
                            if (root.querySelectorAll) {
                                try { results = Array.from(root.querySelectorAll(selector)); } catch(e) {}
                            }
                            var children = root.querySelectorAll ? root.querySelectorAll('*') : [];
                            for (var i = 0; i < children.length; i++) {
                                if (children[i].shadowRoot) {
                                    results = results.concat(queryShadowDOMAll(selector, children[i].shadowRoot));
                                }
                            }
                            return results;
                        }

                        // Find ALL textareas across shadow DOMs
                        var textareas = queryShadowDOMAll('textarea');
                        var chatInput = null;

                        for (var i = 0; i < textareas.length; i++) {
                            var ta = textareas[i];
                            if (!ta.isConnected) continue;
                            if (ta.clientWidth === 0 && ta.clientHeight === 0) continue;

                            // Exclude search/find/filter inputs
                            var aria = (ta.getAttribute('aria-label') || '').toLowerCase();
                            var placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
                            if (aria.indexOf('search') >= 0 || aria.indexOf('find') >= 0 || aria.indexOf('filter') >= 0) continue;
                            if (placeholder.indexOf('search') >= 0 || placeholder.indexOf('find') >= 0 || placeholder.indexOf('filter') >= 0) continue;

                            chatInput = ta;
                            break;
                        }

                        if (!chatInput) {
                            // Fallback: try contentEditable elements
                            var el = document.activeElement;
                            if (el && (el.isContentEditable || (el.closest && el.closest('[contenteditable="true"]')))) {
                                document.execCommand('insertText', false, '${escapedText}');
                                return 'inserted-execCommand-fallback';
                            }
                            return 'no-chat-textarea-found:' + textareas.length + '-total';
                        }

                        // KI-documented method: direct .value assignment + event dispatch
                        chatInput.focus();
                        chatInput.value = '${escapedText}';
                        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
                        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
                        return 'inserted-textarea-value';
                    } catch(e) {
                        return 'error:' + e.message;
                    }
                })()`;
                const typeResult = await this.cdpHandler.executeInAllSessions(typeScript).catch(() => null);
                logToOutput('[Bump] Type result: ' + JSON.stringify(typeResult));
                await new Promise(r => setTimeout(r, 300));

                // Step 3: Submit via Enter key dispatch on the textarea
                logToOutput('[Bump] Step 3: Submit via DOM Enter key...');
                const submitScript = `(() => {
                    try {
                        var el = document.activeElement;
                        if (!el) return 'no-active-element';

                        // Dispatch Enter key sequence
                        var opts = {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true};
                        el.dispatchEvent(new KeyboardEvent('keydown', opts));
                        el.dispatchEvent(new KeyboardEvent('keypress', opts));
                        el.dispatchEvent(new KeyboardEvent('keyup', opts));
                        return 'enter-dispatched';
                    } catch(e) {
                        return 'error:' + e.message;
                    }
                })()`;
                const submitResult = await this.cdpHandler.executeInAllSessions(submitScript).catch(() => null);
                logToOutput('[Bump] Submit result: ' + JSON.stringify(submitResult));

                logToOutput('[Bump] Done — all via CDP DOM injection');
            } catch (e: any) {
                logToOutput('[Bump] ERROR: ' + (e?.message || e));
            }
        }, 3000);

        vscode.window.showInformationMessage('Antigravity: CDP Strategy v8 ON');
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
