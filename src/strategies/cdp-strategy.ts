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

        // Helper to pierce Shadow DOMs during script injection
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

        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const isGenerating = state.isGenerating;
            const buttons = state.buttons || [];

            logToOutput(`[State] Gen: ${isGenerating}, Buttons: ${buttons.join(', ')}`);

            if (isGenerating) {
                this.wasGenerating = true;
                this.lastActivityAt = now;
            } else if (this.wasGenerating) {
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Throttle actions to prevent duplicate triggering
            if (now - this.lastActionAt < 1500) return;

            // Unified action flag
            const autopilotEnabled = !!config.get<boolean>('autopilotAutoAcceptEnabled') || !!config.get<boolean>('autoAllEnabled') || !!config.get<boolean>('autoAcceptEnabled');

            if (autopilotEnabled && buttons.length > 0) {
                if (buttons.includes('run')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Run via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} var btns = queryShadowDOMAll('[title*="Run" i], [aria-label*="Run" i]'); var btn = btns.find(function(b) { return b.isConnected && !b.disabled; }); if (btn) { btn.click(); return 'clicked'; } return 'not-found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('expand')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Expand via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} var btns = queryShadowDOMAll('[title*="Expand" i], [aria-label*="Expand" i], [title*="Input" i]'); var btn = btns.find(function(b) { return b.isConnected && !b.disabled; }); if (btn) { btn.click(); return 'clicked'; } return 'not-found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('accept') || buttons.includes('keep')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Accept via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} var btns = queryShadowDOMAll('[title*="Accept" i], [aria-label*="Accept" i], [title*="Keep" i], [title*="Apply" i]'); var btn = btns.find(function(b) { return b.isConnected && !b.disabled; }); if (btn) { btn.click(); return 'clicked'; } return 'not-found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('retry')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Retry via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} var btns = queryShadowDOMAll('[title*="Retry" i], [aria-label*="Retry" i]'); var btn = btns.find(function(b) { return b.isConnected && !b.disabled; }); if (btn) { btn.click(); return 'clicked'; } return 'not-found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                }
            }

            // Handle stalled conversation (Bump)
            const bumpEnabled = config.get<boolean>('automation.actions.autoReply') ?? true;
            if (bumpEnabled && !isGenerating) {
                const stalledMs = config.get<number>('automation.timing.autoReplyDelayMs') || 7000;
                if ((now - this.lastActivityAt) > stalledMs) {
                    const bumpText = config.get<string>('actions.bump.text') || 'Proceed';
                    this.lastActionAt = now;
                    this.lastActivityAt = now;
                    logToOutput('[Bump] Stalled ' + stalledMs + 'ms, bumping: "' + bumpText + '"');

                    // Step 1: Focus ONLY the chat input (exclude search boxes)
                    const focusScript = `(() => {
                        ${SHADOW_DOM_HELPER}
                        var all = queryShadowDOMAll('textarea, [contenteditable="true"], [role="textbox"]');
                        var chatInput = null;
                        for (var i = 0; i < all.length; i++) {
                            var el = all[i];
                            if (!el.isConnected || (el.clientWidth === 0 && el.clientHeight === 0)) continue;
                            var label = (el.getAttribute('aria-label') || '').toLowerCase();
                            var ph = (el.getAttribute('placeholder') || '').toLowerCase();
                            // Skip search/find/filter inputs
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
                            // Check for chat container
                            if (el.closest && (el.closest('.interactive-session') || el.closest('.interactive-input-part') || el.closest('.chat-widget') || el.closest('.chat-input'))) {
                                chatInput = el;
                                break;
                            }
                            // Generic fallback (non-search textarea)
                            if (!chatInput) chatInput = el;
                        }
                        if (chatInput) {
                            chatInput.focus();
                            return 'focused:' + (chatInput.getAttribute('aria-label') || chatInput.tagName || 'unknown');
                        }
                        return 'no-chat-input:' + all.length + '-total';
                    })()`;
                    const focusResults = await this.cdpHandler.executeInAllSessions(focusScript);
                    logToOutput('[Bump] Focus: ' + JSON.stringify(focusResults));

                    // Step 2: Type text via CDP Input.insertText
                    await new Promise(resolve => setTimeout(resolve, 150));
                    await this.cdpHandler.insertTextToAll(bumpText);
                    logToOutput('[Bump] Typed text');

                    // Step 3: Submit via CDP Enter key (rawKeyDown + char + keyUp)
                    await new Promise(resolve => setTimeout(resolve, 200));
                    await this.cdpHandler.dispatchKeyEventToAll({
                        type: 'rawKeyDown', key: 'Enter', code: 'Enter',
                        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                    });
                    await new Promise(resolve => setTimeout(resolve, 30));
                    await this.cdpHandler.dispatchKeyEventToAll({
                        type: 'char', text: '\r', key: 'Enter',
                        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                    });
                    await new Promise(resolve => setTimeout(resolve, 30));
                    await this.cdpHandler.dispatchKeyEventToAll({
                        type: 'keyUp', key: 'Enter', code: 'Enter',
                        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                    });
                    logToOutput('[Bump] Enter dispatched');
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
