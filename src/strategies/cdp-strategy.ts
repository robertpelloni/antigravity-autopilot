import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { BlindBumpHandler } from './blind-bump-handler';
import { InteractionMethodRegistry, InteractionContext } from './interaction-methods';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';

export interface CDPRuntimeState {
    status: string;
    mode?: string;
    isRunning?: boolean;
    isIdle?: boolean;
    pendingAcceptButtons?: number;
    hasVisibleInput?: boolean;
    hasVisibleSendButton?: boolean;
    totalTabs?: number;
    doneTabs?: number;
    allTasksComplete?: boolean;
    waitingForChatMessage?: boolean;
    timestamp?: number;
    [key: string]: any;
}

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
    private appName: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.appName = vscode.env.appName || 'Visual Studio Code';
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
        const profile = this.resolveUiProfile();
        const selector = this.getClickSelectorForProfile(profile);
        const clickRegistry = this.createRegistryForProfile(profile);
        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            text: action
        };

        switch (action) {
            case 'accept':
                await clickRegistry.executeCategory('click', {
                    ...ctx,
                    selector,
                    acceptPatterns: config.get<string[]>('acceptPatterns') || [],
                    rejectPatterns: config.get<string[]>('rejectPatterns') || [],
                    visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001,
                    commandId: 'antigravity.agent.acceptAgentStep'
                });
                break;
            case 'submit':
                await this.registry.executeCategory('submit', ctx);
                break;
            case 'type':
                await this.registry.executeCategory('text', ctx);
                break;
            case 'run':
                await clickRegistry.executeCategory('click', {
                    ...ctx,
                    selector,
                    commandId: 'antigravity.clickRun'
                });
                break;
            case 'expand':
                await clickRegistry.executeCategory('click', {
                    ...ctx,
                    selector,
                    commandId: 'antigravity.clickExpand'
                });
                break;
            default:
                // Try as VS Code command
                await clickRegistry.executeCategory('click', {
                    ...ctx,
                    selector,
                    commandId: action
                });
        }
    }

    /**
     * Auto-accept agent steps using configured interaction methods.
     */
    private async executeAutoAccept() {
        const profile = this.resolveUiProfile();
        const selector = this.getClickSelectorForProfile(profile);
        const clickRegistry = this.createRegistryForProfile(profile);
        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            selector,
            acceptPatterns: config.get<string[]>('acceptPatterns') || [],
            rejectPatterns: config.get<string[]>('rejectPatterns') || [],
            visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001,
            commandId: 'antigravity.agent.acceptAgentStep'
        };

        await clickRegistry.executeCategory('click', ctx);
    }

    private resolveUiProfile(): 'vscode' | 'antigravity' | 'cursor' {
        const configured = config.get<'auto' | 'vscode' | 'antigravity' | 'cursor'>('interactionUiProfile') || 'auto';
        if (configured !== 'auto') {
            return configured;
        }

        const lower = this.appName.toLowerCase();
        if (lower.includes('antigravity')) return 'antigravity';
        if (lower.includes('cursor')) return 'cursor';
        return 'vscode';
    }

    private getClickSelectorForProfile(profile: 'vscode' | 'antigravity' | 'cursor'): string {
        const selectors = profile === 'antigravity'
            ? (config.get<string[]>('interactionClickSelectorsAntigravity') || [])
            : profile === 'cursor'
                ? (config.get<string[]>('interactionClickSelectorsCursor') || [])
                : (config.get<string[]>('interactionClickSelectorsVSCode') || []);

        const filtered = selectors.map(s => s.trim()).filter(Boolean);
        return filtered.length > 0 ? filtered.join(', ') : 'button, [role="button"], .monaco-button';
    }

    private createRegistryForProfile(profile: 'vscode' | 'antigravity' | 'cursor'): InteractionMethodRegistry {
        const cfg = config.getAll();
        const clickMethods = profile === 'antigravity'
            ? (cfg.interactionClickMethodsAntigravity || cfg.interactionClickMethods)
            : profile === 'cursor'
                ? (cfg.interactionClickMethodsCursor || cfg.interactionClickMethods)
                : (cfg.interactionClickMethodsVSCode || cfg.interactionClickMethods);

        return new InteractionMethodRegistry({
            textInput: cfg.interactionTextMethods,
            click: clickMethods,
            submit: cfg.interactionSubmitMethods,
            timings: cfg.interactionTimings,
            retryCount: cfg.interactionRetryCount,
            parallelExecution: cfg.interactionParallel
        });
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

    /**
     * Retrieves current browser-side automation state snapshot.
     */
    async getRuntimeState(): Promise<CDPRuntimeState | null> {
        const state = await this.cdpHandler.getAutomationRuntimeState();
        if (!state || typeof state !== 'object') {
            return null;
        }
        return state as CDPRuntimeState;
    }

    /**
     * Sends a single hybrid bump/resume message to chat.
     */
    async sendHybridBump(message: string): Promise<boolean> {
        return this.cdpHandler.sendHybridBump(message);
    }
}
