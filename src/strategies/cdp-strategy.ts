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

            if (autopilotEnabled && buttons.length > 0) {
                // Prioritize specific buttons
                if (buttons.includes('run')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Run natively via CDP');
                    const script = `(() => { const btn = document.querySelector('[title*="Run" i], [aria-label*="Run" i]'); if (btn) btn.click(); })();`;
                    this.cdpHandler.executeScriptInAllSessions(script).catch(() => { });
                } else if (buttons.includes('expand')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Expand natively via CDP');
                    const script = `(() => { const btn = document.querySelector('[title*="Expand" i], [aria-label*="Expand" i], [title*="Input" i]'); if (btn) btn.click(); })();`;
                    this.cdpHandler.executeScriptInAllSessions(script).catch(() => { });
                } else if (buttons.includes('accept') || buttons.includes('keep')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Accept natively via CDP');
                    const script = `(() => { const btn = document.querySelector('[title*="Accept" i], [aria-label*="Accept" i], [title*="Keep" i], [title*="Apply" i]'); if (btn) btn.click(); })();`;
                    this.cdpHandler.executeScriptInAllSessions(script).catch(() => { });
                } else if (buttons.includes('retry')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Retry natively via CDP');
                    const script = `(() => { const btn = document.querySelector('[title*="Retry" i], [aria-label*="Retry" i]'); if (btn) btn.click(); })();`;
                    this.cdpHandler.executeScriptInAllSessions(script).catch(() => { });
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
                    logToOutput(`[Autopilot] Stalled for ${stalledMs}ms, using pure CDP to type text: "${bumpText}"`);

                    // 1. Focus the chat input box
                    const focusScript = `
                        (() => {
                            const ta = document.querySelector('textarea, .monaco-editor textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i], [placeholder*="message" i]');
                            if (ta) ta.focus();
                        })();
                    `;
                    await this.cdpHandler.executeScriptInAllSessions(focusScript);

                    // 2. Insert text using raw Chromium CDP to bypass React/Monaco strictness
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await this.cdpHandler.insertTextToAll(bumpText);

                    // 3. Click the send button (or simulate Enter)
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const submitScript = `
                        (() => {
                            const sendBtn = document.querySelector('.monaco-button[title*="Send" i], button[aria-label*="Send" i], button[title*="Submit" i], .codicon-send, [title*="Continue" i]');
                            if (sendBtn) {
                                sendBtn.closest('button')?.click() || sendBtn.click();
                            } else {
                                // Fallback: dispatch enter if no button found
                                const active = document.activeElement;
                                if (active) {
                                    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                                }
                            }
                        })();
                    `;
                    this.cdpHandler.executeScriptInAllSessions(submitScript).catch(() => { });
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
