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

    // Helper to pierce Shadow DOMs during script injection.
    private readonly SHADOW_DOM_HELPER = `
        function queryShadowDOMAll(selector, root) {
            root = root || document;
            var results = [];
            try {
                if (root.querySelectorAll) {
                    results = Array.from(root.querySelectorAll(selector));
                }
                var children = root.querySelectorAll ? root.querySelectorAll('*') : [];
                for (var i = 0; i < children.length; i++) {
                    try {
                        if (children[i].shadowRoot) {
                            results = results.concat(queryShadowDOMAll(selector, children[i].shadowRoot));
                        }
                    } catch(e) {}
                }
            } catch(e) {}
            return results;
        }
    `;

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.updateStatusBar();

        void (async () => {
            await this.cdpHandler.connect();
        })();

        // --- STATE EVENT HANDLER ---
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

            // Throttle actions
            if (now - this.lastActionAt < 2000) return;

            const autopilotEnabled = !!config.get<boolean>('autopilotAutoAcceptEnabled') || !!config.get<boolean>('autoAllEnabled') || !!config.get<boolean>('autoAcceptEnabled');

            // --- BUTTON CLICKS ---
            if (autopilotEnabled && buttons.length > 0) {
                const btnAction = buttons.includes('run') ? 'run'
                    : buttons.includes('expand') ? 'expand'
                        : (buttons.includes('accept') || buttons.includes('keep')) ? 'accept'
                            : buttons.includes('retry') ? 'retry'
                                : null;

                if (btnAction) {
                    this.lastActionAt = now;
                    this.lastActivityAt = now; // clicking = activity
                    const selectorMap: Record<string, string> = {
                        run: 'button, [role="button"]',
                        expand: 'button, [role="button"]',
                        accept: 'button, [role="button"]',
                        retry: 'button, [role="button"]',
                    };
                    // Use text matching in the script instead of CSS selectors for reliability
                    const textMatch: Record<string, string> = {
                        run: 'run',
                        expand: 'expand',
                        accept: 'accept',
                        retry: 'retry',
                    };
                    logToOutput('[Autopilot] Clicking ' + btnAction + ' via script');
                    const matchText = textMatch[btnAction];
                    const script = `(() => {
                        ${this.SHADOW_DOM_HELPER}
                        var btns = queryShadowDOMAll('button, [role="button"], .monaco-button');
                        for (var i = 0; i < btns.length; i++) {
                            try {
                                var b = btns[i];
                                if (!b.isConnected || b.disabled) continue;
                                var text = ((b.textContent || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
                                if (text.indexOf('${matchText}') >= 0) {
                                    b.click();
                                    return 'clicked:' + text.substring(0, 40);
                                }
                            } catch(e) {}
                        }
                        return 'not-found';
                    })()`;
                    const results = await this.cdpHandler.executeInAllSessions(script).catch(() => null);
                    logToOutput('[Click] Results: ' + JSON.stringify(results));
                }
            }
        });

        // --- INDEPENDENT STALL TIMER ---
        // Runs every 3 seconds regardless of state events.
        // If no activity for stalledMs, bump the conversation.
        this.stallTimer = setInterval(async () => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const bumpEnabled = config.get<boolean>('automation.actions.autoReply') ?? true;
            if (!bumpEnabled) return;

            const now = Date.now();
            const stalledMs = config.get<number>('automation.timing.autoReplyDelayMs') || 7000;

            if ((now - this.lastActivityAt) > stalledMs && (now - this.lastActionAt) > stalledMs) {
                const bumpText = config.get<string>('actions.bump.text') || 'Proceed';
                this.lastActionAt = now;
                this.lastActivityAt = now;
                logToOutput('[Bump] Stalled ' + stalledMs + 'ms, bumping: "' + bumpText + '"');

                // Combined script: find chat input → type → submit
                // NO focus() call — we don't want to steal the user's cursor.
                // We directly manipulate the element's value/textContent.
                const bumpScript = `(() => {
                    ${this.SHADOW_DOM_HELPER}
                    var bumpText = ${JSON.stringify(bumpText)};

                    // Find chat input (skip search boxes)
                    var all = queryShadowDOMAll('textarea, [contenteditable="true"], [role="textbox"]');
                    var chatInput = null;
                    for (var i = 0; i < all.length; i++) {
                        try {
                            var el = all[i];
                            if (!el.isConnected) continue;
                            if (el.clientWidth === 0 && el.clientHeight === 0) continue;
                            var label = (el.getAttribute('aria-label') || '').toLowerCase();
                            var ph = (el.getAttribute('placeholder') || '').toLowerCase();
                            // Skip search/find/filter
                            if (label.indexOf('search') >= 0 || label.indexOf('find') >= 0 || label.indexOf('filter') >= 0) continue;
                            if (ph.indexOf('search') >= 0 || ph.indexOf('find') >= 0) continue;
                            // Prefer chat-related inputs
                            if (label.indexOf('chat') >= 0 || label.indexOf('ask') >= 0 || label.indexOf('message') >= 0 || label.indexOf('prompt') >= 0) {
                                chatInput = el; break;
                            }
                            if (ph.indexOf('chat') >= 0 || ph.indexOf('ask') >= 0 || ph.indexOf('message') >= 0 || ph.indexOf('type') >= 0) {
                                chatInput = el; break;
                            }
                            // Check parent containers
                            if (el.closest && (el.closest('.interactive-session') || el.closest('.interactive-input-part') || el.closest('.chat-widget') || el.closest('.chat-input'))) {
                                chatInput = el; break;
                            }
                            // Fallback: first non-search input
                            if (!chatInput) chatInput = el;
                        } catch(e) {}
                    }
                    if (!chatInput) return 'no-chat-input';

                    // Type via DOM manipulation (no focus() — don't steal user cursor)
                    if (chatInput.tagName === 'TEXTAREA' || chatInput.tagName === 'INPUT') {
                        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                                     Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                        if (setter && setter.set) {
                            setter.set.call(chatInput, bumpText);
                        } else {
                            chatInput.value = bumpText;
                        }
                        chatInput.dispatchEvent(new Event('input', {bubbles: true}));
                        chatInput.dispatchEvent(new Event('change', {bubbles: true}));
                    } else {
                        chatInput.textContent = bumpText;
                        chatInput.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: bumpText}));
                    }

                    // Submit via Enter key
                    setTimeout(function() {
                        try {
                            chatInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                            chatInput.dispatchEvent(new KeyboardEvent('keypress', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                            chatInput.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                        } catch(e) {}
                    }, 200);

                    return 'bumped:' + (chatInput.getAttribute('aria-label') || chatInput.tagName);
                })()`;
                const results = await this.cdpHandler.executeInAllSessions(bumpScript).catch(() => null);
                logToOutput('[Bump] Results: ' + JSON.stringify(results));
            }
        }, 3000);

        vscode.window.showInformationMessage('Antigravity: Simplified Native CDP Strategy ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;
        if (this.stallTimer) {
            clearInterval(this.stallTimer);
            this.stallTimer = null;
        }
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
