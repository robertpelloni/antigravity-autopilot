import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { logToOutput } from '../utils/output-channel';

// Legacy Type stub for backwards compatibility with extension.ts
export type CDPRuntimeState = any;

export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;
    private cdpHandler: CDPHandler;
    private statusBarItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;
    private controllerRoleIsLeader = false;

    // We track state for handling stalls
    private lastActionAt = 0;
    private lastActivityAt = Date.now();
    private wasGenerating = false;

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

        // Helper to pierce Shadow DOMs during script injection.
        // Uses var (not const/let) for maximum compat inside eval'd scripts.
        const SHADOW_DOM_HELPER = `
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
        `;

        // Helper: find a visible, connected, non-disabled button matching selectors.
        // Returns the first match or null.
        const FIND_AND_CLICK_HELPER = `
            function findAndClick(selectors) {
                var btns = queryShadowDOMAll(selectors);
                for (var i = 0; i < btns.length; i++) {
                    var b = btns[i];
                    if (b.isConnected && !b.disabled) {
                        b.click();
                        return 'clicked';
                    }
                }
                return 'not-found';
            }
        `;

        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const isGenerating = state.isGenerating;
            const buttons = state.buttons || [];

            logToOutput('[State] Gen: ' + isGenerating + ', Buttons: ' + buttons.join(', '));

            if (isGenerating) {
                this.wasGenerating = true;
                this.lastActivityAt = now;
            } else if (this.wasGenerating) {
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Throttle actions to prevent duplicate triggering
            if (now - this.lastActionAt < 2000) return;

            const autopilotEnabled = !!config.get<boolean>('autopilotAutoAcceptEnabled') || !!config.get<boolean>('autoAllEnabled') || !!config.get<boolean>('autoAcceptEnabled');

            // --- BUTTON CLICKS ---
            // All done via script injection (no CDP Input commands).
            // executeInAllSessions runs in every connected session; sessions without matching
            // buttons simply return 'not-found'.
            if (autopilotEnabled && buttons.length > 0) {
                const btnAction = buttons.includes('run') ? 'run'
                    : buttons.includes('expand') ? 'expand'
                        : (buttons.includes('accept') || buttons.includes('keep')) ? 'accept'
                            : buttons.includes('retry') ? 'retry'
                                : null;

                if (btnAction) {
                    this.lastActionAt = now;
                    const selectorMap: Record<string, string> = {
                        run: '[title*="Run" i], [aria-label*="Run" i]',
                        expand: '[title*="Expand" i], [aria-label*="Expand" i], [title*="Input" i]',
                        accept: '[title*="Accept" i], [aria-label*="Accept" i], [title*="Keep" i], [title*="Apply" i]',
                        retry: '[title*="Retry" i], [aria-label*="Retry" i]',
                    };
                    logToOutput('[Autopilot] Clicking ' + btnAction + ' via script');
                    const sel = selectorMap[btnAction];
                    const script = `(() => { ${SHADOW_DOM_HELPER} ${FIND_AND_CLICK_HELPER} return findAndClick('${sel}'); })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                }
            }

            // --- BUMP (stalled conversation) ---
            // Everything is done via script injection — focus, type, and submit all happen
            // inside the script targeting the exact DOM element. No CDP Input.insertText or
            // Input.dispatchKeyEvent, which would type into whatever element has focus in the
            // main Electron page (often the wrong element like a search box).
            const bumpEnabled = config.get<boolean>('automation.actions.autoReply') ?? true;
            if (bumpEnabled && !isGenerating) {
                const stalledMs = config.get<number>('automation.timing.autoReplyDelayMs') || 7000;
                if ((now - this.lastActivityAt) > stalledMs) {
                    const bumpText = config.get<string>('actions.bump.text') || 'Proceed';
                    this.lastActionAt = now;
                    this.lastActivityAt = now;
                    logToOutput('[Bump] Stalled ' + stalledMs + 'ms, bumping: "' + bumpText + '"');

                    // Combined script: find chat input → focus → type → submit
                    // All in one script so it's atomic within each session.
                    const bumpScript = `(() => {
                        ${SHADOW_DOM_HELPER}
                        var bumpText = ${JSON.stringify(bumpText)};

                        // Step 1: Find the chat input (skip search boxes)
                        var all = queryShadowDOMAll('textarea, [contenteditable="true"], [role="textbox"]');
                        var chatInput = null;
                        for (var i = 0; i < all.length; i++) {
                            var el = all[i];
                            if (!el.isConnected || (el.clientWidth === 0 && el.clientHeight === 0)) continue;
                            var label = (el.getAttribute('aria-label') || '').toLowerCase();
                            var ph = (el.getAttribute('placeholder') || '').toLowerCase();
                            if (label.indexOf('search') >= 0 || label.indexOf('find') >= 0 || label.indexOf('filter') >= 0) continue;
                            if (ph.indexOf('search') >= 0 || ph.indexOf('find') >= 0) continue;
                            // Prefer chat-related inputs
                            if (label.indexOf('chat') >= 0 || label.indexOf('ask') >= 0 || label.indexOf('message') >= 0 || label.indexOf('prompt') >= 0) {
                                chatInput = el;
                                break;
                            }
                            if (ph.indexOf('chat') >= 0 || ph.indexOf('ask') >= 0 || ph.indexOf('message') >= 0 || ph.indexOf('type') >= 0) {
                                chatInput = el;
                                break;
                            }
                            if (el.closest && (el.closest('.interactive-session') || el.closest('.interactive-input-part') || el.closest('.chat-widget') || el.closest('.chat-input'))) {
                                chatInput = el;
                                break;
                            }
                            if (!chatInput) chatInput = el;
                        }
                        if (!chatInput) return 'no-chat-input';

                        // Step 2: Focus and type
                        chatInput.focus();
                        if (chatInput.tagName === 'TEXTAREA' || chatInput.tagName === 'INPUT') {
                            // Native textarea: set value + fire input event
                            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                                              Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                            if (nativeSetter && nativeSetter.set) {
                                nativeSetter.set.call(chatInput, bumpText);
                            } else {
                                chatInput.value = bumpText;
                            }
                            chatInput.dispatchEvent(new Event('input', {bubbles: true}));
                            chatInput.dispatchEvent(new Event('change', {bubbles: true}));
                        } else {
                            // contenteditable: set textContent + fire input
                            chatInput.textContent = bumpText;
                            chatInput.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: bumpText}));
                        }

                        // Step 3: Submit via Enter key event on the element
                        setTimeout(function() {
                            chatInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                            chatInput.dispatchEvent(new KeyboardEvent('keypress', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                            chatInput.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                        }, 200);

                        return 'bumped:' + (chatInput.getAttribute('aria-label') || chatInput.tagName);
                    })()`;
                    const results = await this.cdpHandler.executeInAllSessions(bumpScript);
                    logToOutput('[Bump] Results: ' + JSON.stringify(results));
                }
            }
        });

        vscode.window.showInformationMessage('Antigravity: Simplified Native CDP Strategy ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;
        this.cdpHandler.disconnectAll();
        this.cdpHandler.removeAllListeners('state');
        this.updateStatusBar();
        vscode.window.showInformationMessage('Antigravity: CDP Strategy OFF');
    }

    private updateStatusBar() {
        if (this.isActive) {
            this.statusBarItem.text = '$(check) CDP: ON';
            this.statusBarItem.tooltip = 'Native CDP Strategy Active';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(circle-slash) CDP: OFF';
            this.statusBarItem.tooltip = 'Native CDP Strategy Inactive';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.statusBarItem.show();
    }

    dispose() {
        this.stop();
        this.statusBarItem.dispose();
    }

    // --- LEGACY STUBS for compatibility with untouched extension.ts commands ---
    isConnected(): boolean { return true; }
    async getRuntimeState(): Promise<CDPRuntimeState> { return {}; }
    async executeAction(action: string): Promise<void> { }
    async sendHybridBump(message: string): Promise<boolean> { return true; }
    async sendInputSubmitFallback(): Promise<boolean> { return true; }
    async testMethod(methodName: string, text?: string): Promise<boolean> { return true; }
}
