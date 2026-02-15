
import * as vscode from 'vscode';
import { config } from '../../utils/config';
import { InteractionMethodRegistry, InteractionContext } from '../../strategies/interaction-methods';

/**
 * Clicker Module
 * Delegates click operations to the InteractionMethodRegistry.
 * Supports DOM selectors, CDP mouse events, VS Code commands,
 * script force clicks, and coordinate clicks.
 *
 * @module modules/clicker
 */
export class Clicker {
    private registry: InteractionMethodRegistry;

    constructor(registry?: InteractionMethodRegistry) {
        const cfg = config.getAll();
        this.registry = registry || new InteractionMethodRegistry({
            click: cfg.interactionClickMethods,
            textInput: cfg.interactionTextMethods,
            submit: cfg.interactionSubmitMethods,
            timings: cfg.interactionTimings,
            retryCount: cfg.interactionRetryCount,
            parallelExecution: cfg.interactionParallel
        });
    }

    /**
     * Click at absolute coordinates using all enabled click methods.
     */
    async click(x: number, y: number, cdpHandler?: any) {
        const ctx: InteractionContext = {
            coordinates: { x, y },
            cdpHandler
        };
        return this.registry.executeCategory('click', ctx);
    }

    /**
     * Click a DOM element by CSS selector using enabled click methods.
     */
    async clickElement(selector: string, cdpHandler?: any) {
        const ctx: InteractionContext = {
            selector,
            cdpHandler
        };
        return this.registry.executeCategory('click', ctx);
    }

    /**
     * Execute a VS Code command (click-equivalent for native controls).
     */
    async executeCommand(commandId: string) {
        const ctx: InteractionContext = {
            commandId,
            vscodeCommands: vscode.commands
        };
        return this.registry.executeCategory('click', ctx);
    }

    /**
     * Returns summary of all registered click methods and their status.
     */
    getSummary() {
        return this.registry.getSummary().filter(m => m.category === 'click');
    }
}
