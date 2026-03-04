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
                    logToOutput('[Autopilot] Clicking Run natively');
                    await vscode.commands.executeCommand('workbench.action.terminal.chat.runCommand').then(undefined, () => { });
                    await vscode.commands.executeCommand('antigravity.terminalCommand.run').then(undefined, () => { });
                } else if (buttons.includes('expand')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Expand natively');
                    await vscode.commands.executeCommand('workbench.action.terminal.chat.viewInEditor').then(undefined, () => { });
                    await vscode.commands.executeCommand('antigravity.command.accept').then(undefined, () => { });
                } else if (buttons.includes('accept') || buttons.includes('keep')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Accept natively');
                    await vscode.commands.executeCommand('antigravity.agent.acceptAgentStep').then(undefined, () => { });
                } else if (buttons.includes('retry')) {
                    this.lastActionAt = now;
                    logToOutput('[Autopilot] Clicking Retry natively');
                    await vscode.commands.executeCommand('antigravity.agent.rejectAgentStep').then(undefined, () => { });
                }
            }

            // Handle stalled conversation (Bump)
            const bumpEnabled = config.get<boolean>('actions.bump.enabled') ?? true;
            if (bumpEnabled && !isGenerating) {
                const stalledMs = config.get<number>('timing.stalledMs') || 7000;
                if ((now - this.lastActivityAt) > stalledMs) {
                    const bumpText = config.get<string>('actions.bump.text') || 'Proceed';
                    this.lastActionAt = now;
                    this.lastActivityAt = now; // reset
                    logToOutput(`[Autopilot] Stalled for ${stalledMs}ms, executing native sendTextToChat: "${bumpText}"`);
                    await vscode.commands.executeCommand('antigravity.sendTextToChat', bumpText).then(undefined, () => { });
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
