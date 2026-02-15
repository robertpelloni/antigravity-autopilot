import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { BlindBumpHandler } from './blind-bump-handler';
import { InteractionMethodRegistry, InteractionContext } from './interaction-methods';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';

/**
 * CDP Strategy
 * Uses Chrome DevTools Protocol for browser automation.
 * Manages the BlindBumpHandler and provides interaction method
 * configuration through the InteractionMethodRegistry.
 *
 * @module strategies/cdp-strategy
 */
export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;

    private blindBumpHandler: BlindBumpHandler | null = null;
    private cdpHandler: CDPHandler;
    private statusBarItem: vscode.StatusBarItem;
    private pollTimer: NodeJS.Timeout | null = null;
    private registry: InteractionMethodRegistry;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.cdpHandler = new CDPHandler();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9999);
        this.statusBarItem.command = 'antigravity.toggleAutoAccept';

        const cfg = config.getAll();
        this.registry = new InteractionMethodRegistry({
            textInput: cfg.interactionTextMethods,
            click: cfg.interactionClickMethods,
            submit: cfg.interactionSubmitMethods,
            timings: cfg.interactionTimings,
            retryCount: cfg.interactionRetryCount,
            parallelExecution: cfg.interactionParallel
        });
    }

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.updateStatusBar();

        // Connect to CDP
        const connected = await this.cdpHandler.connect();
        if (!connected) {
            vscode.window.showWarningMessage('Antigravity: CDP connection failed. Retrying in background...');
        }

        // Start blind bump handler
        this.blindBumpHandler = new BlindBumpHandler(this.cdpHandler);
        this.blindBumpHandler.start();

        // Poll for CDP connection status
        const frequency = config.get<number>('pollFrequency') || 1000;
        this.pollTimer = setInterval(async () => {
            if (!this.isActive) return;

            // Reconnect if disconnected
            if (!this.cdpHandler.isConnected()) {
                await this.cdpHandler.connect();
            }

            // Execute configured click interactions (auto-accept buttons)
            if (this.cdpHandler.isConnected()) {
                try {
                    await this.executeAutoAccept();
                } catch { /* ignore */ }
            }
        }, frequency);

        vscode.window.showInformationMessage('Antigravity: CDP Strategy ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        if (this.blindBumpHandler) {
            this.blindBumpHandler.stop();
            this.blindBumpHandler = null;
        }

        this.cdpHandler.disconnectAll();
        this.updateStatusBar();
        vscode.window.showInformationMessage('Antigravity: CDP Strategy OFF');
    }

    async executeAction(action: string): Promise<void> {
        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            text: action
        };

        switch (action) {
            case 'accept':
                await this.registry.executeCategory('click', {
                    ...ctx,
                    commandId: 'antigravity.agent.acceptAgentStep'
                });
                break;
            case 'submit':
                await this.registry.executeCategory('submit', ctx);
                break;
            case 'type':
                await this.registry.executeCategory('text', ctx);
                break;
            default:
                // Try as VS Code command
                await this.registry.executeCategory('click', {
                    ...ctx,
                    commandId: action
                });
        }
    }

    /**
     * Auto-accept agent steps using configured interaction methods.
     */
    private async executeAutoAccept() {
        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            commandId: 'antigravity.agent.acceptAgentStep'
        };

        // Try VS Code commands first
        try {
            await vscode.commands.executeCommand('antigravity.agent.acceptAgentStep');
        } catch { /* ignore */ }

        // Also try terminal accept
        try {
            await vscode.commands.executeCommand('antigravity.terminal.accept');
        } catch { /* ignore */ }
    }

    private updateStatusBar() {
        if (this.isActive) {
            this.statusBarItem.text = '$(check) CDP: ON';
            this.statusBarItem.tooltip = 'Antigravity CDP Strategy Active — Click to Toggle';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(circle-slash) CDP: OFF';
            this.statusBarItem.tooltip = 'Antigravity CDP Strategy Inactive — Click to Toggle';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.statusBarItem.show();
    }

    dispose() {
        this.stop();
        this.statusBarItem.dispose();
    }

    /**
     * Returns the interaction method summary for diagnostics.
     */
    getMethodSummary() {
        return this.registry.getSummary();
    }

    /**
     * Returns the CDP connection status.
     */
    isConnected(): boolean {
        return this.cdpHandler.isConnected();
    }
}
