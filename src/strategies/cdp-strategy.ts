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
                // Stopped generating just now
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Throttle actions tightly to prevent duplicate triggering
            if (now - this.lastActionAt < 1500) return;

            // Unified action flag
            const autopilotEnabled = !!config.get<boolean>('autopilotAutoAcceptEnabled') || !!config.get<boolean>('autoAllEnabled') || !!config.get<boolean>('autoAcceptEnabled');

            // Helper to pierce Shadow DOMs during script injection
            const SHADOW_DOM_HELPER = `
                function queryShadowDOMAll(selector, root) {
                    root = root || document;
                    let results = [];
                    if (root.querySelectorAll) {
                        try { results = Array.from(root.querySelectorAll(selector)); } catch(e) {}
                    }
                    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
                    for (let i = 0; i < all.length; i++) {
                        if (all[i].shadowRoot) {
                            results = results.concat(queryShadowDOMAll(selector, all[i].shadowRoot));
                        }
                    }
                    return results;
                }
            `;

            if (autopilotEnabled && buttons.length > 0) {
                // Prioritize specific buttons
                if (buttons.includes('run')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Run natively via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} const btns = queryShadowDOMAll('[title*="Run" i], [aria-label*="Run" i]'); const btn = btns.find(b => b.isConnected && !b.disabled); if (btn) { btn.click(); return 'clicked'; } return 'not found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('expand')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Expand natively via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} const btns = queryShadowDOMAll('[title*="Expand" i], [aria-label*="Expand" i], [title*="Input" i]'); const btn = btns.find(b => b.isConnected && !b.disabled); if (btn) { btn.click(); return 'clicked'; } return 'not found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('accept') || buttons.includes('keep')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Accept natively via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} const btns = queryShadowDOMAll('[title*="Accept" i], [aria-label*="Accept" i], [title*="Keep" i], [title*="Apply" i]'); const btn = btns.find(b => b.isConnected && !b.disabled); if (btn) { btn.click(); return 'clicked'; } return 'not found'; })()`;
                    this.cdpHandler.executeInAllSessions(script).catch(() => { });
                } else if (buttons.includes('retry')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Retry natively via CDP');
                    const script = `(() => { ${SHADOW_DOM_HELPER} const btns = queryShadowDOMAll('[title*="Retry" i], [aria-label*="Retry" i]'); const btn = btns.find(b => b.isConnected && !b.disabled); if (btn) { btn.click(); return 'clicked'; } return 'not found'; })()`;
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
                    this.lastActivityAt = now; // reset
                    logToOutput(`[Autopilot] Stalled for ${stalledMs}ms, bumping with: "${bumpText}"`);

                    // 0. Check if input already has text (prevent duplicate typing)
                    const checkScript = `(() => {
                        ${SHADOW_DOM_HELPER}
                        const els = queryShadowDOMAll('textarea, [contenteditable="true"], [role="textbox"]');
                        const ta = els.find(t => t.isConnected && (t.offsetParent !== null || t.clientWidth > 0));
                        if (!ta) return 'no-input';
                        const val = (ta.value || ta.textContent || '').trim();
                        return val.length > 0 ? 'has-text' : 'empty';
                    })()`;
                    const checkResults = await this.cdpHandler.executeInAllSessions(checkScript);
                    const hasText = checkResults.some(r => r === 'has-text');

                    if (hasText) {
                        logToOutput('[Autopilot] Input already has text, skipping type, going straight to submit');
                    } else {
                        // 1. Focus the chat input
                        const focusScript = `(() => {
                            ${SHADOW_DOM_HELPER}
                            const els = queryShadowDOMAll('textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i]');
                            const ta = els.find(t => t.isConnected && (t.offsetParent !== null || t.clientWidth > 0));
                            if (ta) { ta.focus(); return 'focused'; }
                            return 'not-found';
                        })()`;
                        await this.cdpHandler.executeInAllSessions(focusScript);

                        // 2. Insert text using raw CDP Input.insertText
                        await new Promise(resolve => setTimeout(resolve, 100));
                        await this.cdpHandler.insertTextToAll(bumpText);
                    }

                    // 3. Submit: Click send button OR use CDP Enter key
                    await new Promise(resolve => setTimeout(resolve, 200));
                    const submitScript = `(() => {
                        ${SHADOW_DOM_HELPER}
                        const btns = queryShadowDOMAll('[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], button[type="submit"], .codicon-send, .send-button');
                        const sendBtn = btns.find(b => b.isConnected && !b.disabled && (b.offsetParent !== null || b.clientWidth > 0));
                        if (sendBtn) {
                            const target = sendBtn.closest('button') || sendBtn;
                            target.click();
                            return 'clicked';
                        }
                        return 'no-button';
                    })()`;
                    const submitResults = await this.cdpHandler.executeInAllSessions(submitScript);
                    const clicked = submitResults.some(r => r === 'clicked');

                    if (!clicked) {
                        // Fallback: use raw CDP Input.dispatchKeyEvent for Enter
                        logToOutput('[Autopilot] No send button found, using CDP Enter key');
                        await this.cdpHandler.dispatchKeyEventToAll({
                            type: 'keyDown', key: 'Enter', code: 'Enter',
                            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                        });
                        await this.cdpHandler.dispatchKeyEventToAll({
                            type: 'keyUp', key: 'Enter', code: 'Enter',
                            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
                        });
                    }
                }
            }
        });

        vscode.window.showInformationMessage('Antigravity: Simplified Native CDP Strategy ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;
        this.cdpHandler.disconnectAll();
        // Clear all listeners so we don't leak when toggling
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
