import * as vscode from 'vscode';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { InteractionMethodRegistry, InteractionContext, InteractionResult } from './interaction-methods';

/**
 * BlindBumpHandler - Automated chat bumping using configurable interaction methods.
 *
 * Each cycle: Open Chat → Type Message → Submit
 * All three steps use the InteractionMethodRegistry, so the user can configure
 * which methods are used for each step via the Dashboard or VS Code settings.
 *
 * @module strategies/blind-bump-handler
 */
export class BlindBumpHandler {
    private timer: NodeJS.Timeout | null = null;
    private statusBar: vscode.StatusBarItem | undefined;
    private isActive = false;
    private registry: InteractionMethodRegistry;
    private cycleCount = 0;
    private lastResults: InteractionResult[] = [];

    constructor(private cdp: CDPHandler) {
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

    public start() {
        this.stop();
        this.isActive = true;
        this.cycleCount = 0;
        const cfg = config.getAll();
        const cooldown = cfg.actions.bump.cooldown || 30;
        const delay = cooldown * 1000;

        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.text = '$(pulse) AG: Init';
        this.statusBar.show();

        this.timer = setInterval(() => this.cycle(), delay + 2000);
    }

    public stop() {
        this.isActive = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.statusBar) this.statusBar.dispose();
    }

    /**
     * Returns the last cycle's interaction results for diagnostics.
     */
    public getLastResults(): InteractionResult[] {
        return this.lastResults;
    }

    /**
     * Returns a summary of all registered interaction methods.
     */
    public getMethodSummary() {
        return this.registry.getSummary();
    }

    private async cycle() {
        if (!this.isActive) return;
        const cfg = config.getAll();
        const msg = cfg.actions.bump.text || 'bump';
        if (!msg) return;

        this.cycleCount++;
        if (this.statusBar) this.statusBar.text = `$(zap) AG: Bump #${this.cycleCount}`;

        const allResults: InteractionResult[] = [];

        // Step 1: Open chat (click method)
        const ctx: InteractionContext = {
            commandId: 'workbench.action.chat.open',
            vscodeCommands: vscode.commands,
            cdpHandler: this.cdp,
            acceptPatterns: config.get<string[]>('acceptPatterns') || [],
            rejectPatterns: config.get<string[]>('rejectPatterns') || [],
            visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001
        };
        const openResults = await this.registry.executeCategory('click', ctx);
        allResults.push(...openResults);
        await new Promise(r => setTimeout(r, 500));

        // Focus chat input
        try { await vscode.commands.executeCommand('workbench.action.chat.focusInput'); }
        catch { /* ignore */ }

        // Step 2: Type message (text input method)
        const typeCtx: InteractionContext = {
            text: msg,
            cdpHandler: this.cdp,
            vscodeCommands: vscode.commands,
            visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001
        };
        const typeResults = await this.registry.executeCategory('text', typeCtx);
        allResults.push(...typeResults);
        await new Promise(r => setTimeout(r, 100));

        // Step 3: Submit (submit method)
        const submitCtx: InteractionContext = {
            cdpHandler: this.cdp,
            vscodeCommands: vscode.commands,
            visualDiffThreshold: config.get<number>('interactionVisualDiffThreshold') || 0.001
        };
        const submitResults = await this.registry.executeCategory('submit', submitCtx);
        allResults.push(...submitResults);

        this.lastResults = allResults;

        if (this.statusBar) {
            const successes = allResults.filter(r => r.success).length;
            this.statusBar.text = `$(check) AG: Bump #${this.cycleCount} (${successes}/${allResults.length})`;
        }
    }
}
