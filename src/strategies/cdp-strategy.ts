import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { BlindBumpHandler } from './blind-bump-handler';
import { InteractionMethodRegistry, InteractionContext } from './interaction-methods';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { SoundEffects } from '../utils/sound-effects';
import { logToOutput } from '../utils/output-channel';

export interface CDPRuntimeState {
    status: string;
    // ... (rest of interface unchanged)
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

    // ... (private methods unchanged)

    private isUnifiedAutoAcceptEnabled(): boolean {
        return !!config.get<boolean>('actions.autoAccept.enabled')
            || !!config.get<boolean>('automation.actions.clickAccept')
            || !!config.get<boolean>('automation.actions.clickAcceptAll')
            || !!config.get<boolean>('automation.actions.clickRun')
            || !!config.get<boolean>('automation.actions.clickExpand')
            || !!config.get<boolean>('automation.actions.clickContinue')
            || !!config.get<boolean>('automation.actions.clickSubmit')
            || !!config.get<boolean>('autopilotAutoAcceptEnabled')
            || !!config.get<boolean>('autoAllEnabled')
            || !!config.get<boolean>('autoAcceptEnabled');
    }

    private isUnifiedAutoBumpEnabled(): boolean {
        return !!config.get<boolean>('autopilotAutoBumpEnabled');
    }

    private isRunExpandContinueEnabled(): boolean {
        return !!config.get<boolean>('autopilotRunExpandContinueEnabled');
    }

    private shouldRunBlindBump(): boolean {
        const cfg = config.getAll();
        const bumpText = (cfg.actions.bump.text || '').trim();
        // The backend Blind Bump MUST ONLY RUN if the frontend auto-continue script is explicitly toggled OFF by the user.
        // If it is true, or undefined (defaulting to true), the frontend `auto-continue.ts` handles the smart resume typing.
        const isFrontendExplicitlyDisabled = cfg.autoContinueScriptEnabled === false;
        return cfg.actions.bump.enabled && isFrontendExplicitlyDisabled && bumpText.length > 0;
    }

    private syncBlindBumpHandlerState(): void {
        const shouldRun = this.shouldRunBlindBump();
        if (shouldRun && !this.blindBumpHandler) {
            this.blindBumpHandler = new BlindBumpHandler(this.cdpHandler);
            this.blindBumpHandler.start();
            return;
        }

        if (!shouldRun && this.blindBumpHandler) {
            this.blindBumpHandler.stop();
            this.blindBumpHandler = null;
        }
    }

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.appName = vscode.env.appName || 'Visual Studio Code';
        // Use the singleton client handler to ensure state is shared with commands
        const { cdpClient } = require('../providers/cdp-client');
        this.cdpHandler = cdpClient.getHandler();

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

        let connected = await this.cdpHandler.connect();
        if (!connected) {
            // Fallback
            connected = await this.cdpHandler.connect();
        }
        if (!connected) {
            vscode.window.showWarningMessage('Antigravity: CDP connection failed. Retrying in background...');
            logToOutput('[CDPStrategy] Initial CDP connect failed (filtered + unfiltered fallback).');
        }

        // Listen for frontend actions that failed DOM clicks and need Native fallback
        this.cdpHandler.on('action', async ({ group, detail }) => {
            logToOutput(`[CDPStrategy] Received fallback action from frontend: ${group} (${detail})`);
            await this.executeAction(group);
        });

        this.syncBlindBumpHandlerState();

        // Poll for CDP connection status
        const frequency = config.get<number>('automation.timing.pollIntervalMs')
            || config.get<number>('autoAcceptPollIntervalMs')
            || config.get<number>('pollFrequency')
            || 1000;

        const pollLoop = async () => {
            if (!this.isActive) return;

            this.syncBlindBumpHandlerState();

            // Reconnect if disconnected
            if (!this.cdpHandler.isConnected()) {
                let reconnectOk = await this.cdpHandler.connect();
                // Add a small backoff and only log once every 5 failures to reduce noise
                if (!reconnectOk) {
                    await new Promise(r => setTimeout(r, 2000));
                    // No need to try back-to-back inside the same poll cycle
                }
            }

            // Execute configured click interactions (auto-accept buttons)
            if (this.cdpHandler.isConnected()) {
                try {
                    await this.executeAutoAccept();
                } catch { /* ignore */ }
            }

            if (this.isActive) {
                this.pollTimer = setTimeout(pollLoop, frequency);
            }
        };

        this.pollTimer = setTimeout(pollLoop, frequency);

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
        if ((action === 'run' || action === 'expand' || action === 'continue') && !this.isRunExpandContinueEnabled()) {
            return;
        }

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
                    visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001
                });
                break;
            case 'submit':
                SoundEffects.playActionGroup('submit');
                await this.registry.executeCategory('submit', ctx);
                break;
            case 'type':
                SoundEffects.playActionGroup('type');
                await this.registry.executeCategory('text', ctx);
                break;
            case 'run':
                SoundEffects.playActionGroup('run');
                await this.createActionSafeClickRegistry(profile).executeCategory('click', {
                    ...ctx,
                    selector,
                    commandId: 'workbench.action.terminal.chat.runCommand'
                });
                break;
            case 'expand':
                SoundEffects.playActionGroup('expand');
                await this.createActionSafeClickRegistry(profile).executeCategory('click', {
                    ...ctx,
                    selector,
                    commandId: 'workbench.action.terminal.chat.viewInEditor'
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
     * Test a specific interaction method by ID.
     */


    /**
     * Auto-accept agent steps using configured interaction methods.
     */
    private async executeAutoAccept() {
        if (!this.isUnifiedAutoAcceptEnabled()) {
            return;
        }

        const profile = this.resolveUiProfile();
        const selector = this.getClickSelectorForProfile(profile);
        const clickRegistry = this.createRegistryForProfile(profile);
        const rejectPatterns = [...(config.get<string[]>('rejectPatterns') || [])];

        if (!this.isRunExpandContinueEnabled()) {
            rejectPatterns.push('run', 'continue', 'expand');
        }

        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            selector,
            acceptPatterns: config.get<string[]>('acceptPatterns') || [],
            rejectPatterns,
            visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001
            // DISABLED: commandId: 'antigravity.agent.acceptAgentStep' -> This command aliases to Customize Layout!
        };

        const success = await clickRegistry.executeCategory('click', ctx);
        if (success) {
            SoundEffects.playActionGroup('click');
        }
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
        return filtered.length > 0 ? filtered.join(', ') : '';
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

    private createActionSafeClickRegistry(profile: 'vscode' | 'antigravity' | 'cursor'): InteractionMethodRegistry {
        const cfg = config.getAll();
        const baseMethods = profile === 'antigravity'
            ? (cfg.interactionClickMethodsAntigravity || cfg.interactionClickMethods)
            : profile === 'cursor'
                ? (cfg.interactionClickMethodsCursor || cfg.interactionClickMethods)
                : (cfg.interactionClickMethodsVSCode || cfg.interactionClickMethods);

        const disallowed = new Set(['vscode-cmd', 'process-peek']);
        const clickMethods = (Array.isArray(baseMethods) ? baseMethods : [])
            .map(m => String(m || '').trim())
            .filter(Boolean)
            .filter(m => !disallowed.has(m));

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
        const screenReader = config.get('accessibility.screenReaderOptimized');

        if (this.isActive) {
            this.statusBarItem.text = screenReader ? 'Antigravity CDP: Connected' : '$(check) CDP: ON';
            this.statusBarItem.tooltip = 'Antigravity CDP Strategy Active — Click to Toggle';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = screenReader ? 'Antigravity CDP: Disconnected' : '$(circle-slash) CDP: OFF';
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
        const tracked = this.cdpHandler.getTrackedSessions();

        if (!state || typeof state !== 'object') {
            // Even if no script state, return structure if we have connections
            if (tracked.length > 0) {
                return {
                    status: 'connected',
                    timestamp: Date.now(),
                    trackedSessions: tracked
                } as any;
            }
            return null;
        }

        // Merge tracked sessions into state
        (state as any).trackedSessions = tracked;
        return state as CDPRuntimeState;
    }

    /**
     * Sends a single hybrid bump/resume message to chat.
     */
    async sendHybridBump(message: string): Promise<boolean> {
        SoundEffects.playActionGroup('bump');
        return this.cdpHandler.sendHybridBump(message);
    }

    /**
     * Executes a specific interaction method for testing purposes.
     */
    async testMethod(methodId: string, text: string): Promise<boolean> {
        if (!this.isActive) return false;

        const ctx: InteractionContext = {
            cdpHandler: this.cdpHandler,
            vscodeCommands: vscode.commands,
            text: text
        };

        // We need to resolve a selector for the test.
        // For testing, we can try to find *any* input if it's a text method, or any button if it's a click method.
        // But the registry requires a selector for some methods.
        const profile = this.resolveUiProfile();
        const selector = this.getClickSelectorForProfile(profile);

        // For text methods, we might need input selectors
        // This is a bit hacky, but valid for a test harness.
        const registryProp = (this as any).registry; // Access private registry if needed, or make it protected
        if (registryProp && typeof registryProp.executeMethod === 'function') {
            return registryProp.executeMethod(methodId, {
                ...ctx,
                selector: selector
            });
        }
        return false;
    }
}
