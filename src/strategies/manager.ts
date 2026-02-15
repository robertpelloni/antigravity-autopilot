import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { SimpleStrategy } from './simple-strategy';
import { CDPStrategy } from './cdp-strategy';
import { config } from '../utils/config';

export class StrategyManager {
    private currentStrategy: IStrategy | null = null;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async start() {
        const strategyType = config.get<string>('strategy');

        // Stop previous if different
        if (this.currentStrategy && this.currentStrategy.name !== (strategyType === 'cdp' ? 'CDP Strategy' : 'Simple Strategy')) {
            await this.currentStrategy.stop();
            this.currentStrategy.dispose();
            this.currentStrategy = null;
        }

        if (!this.currentStrategy) {
            if (strategyType === 'cdp') {
                this.currentStrategy = new CDPStrategy(this.context);
            } else {
                this.currentStrategy = new SimpleStrategy();
            }
        }

        await this.currentStrategy.start();
    }

    async stop() {
        if (this.currentStrategy) {
            await this.currentStrategy.stop();
        }
    }

    async toggle() {
        if (this.currentStrategy && this.currentStrategy.isActive) {
            await this.stop();
        } else {
            await this.start();
        }
    }

    /**
     * Execute a specific action through the active strategy.
     */
    async executeAction(action: string) {
        if (this.currentStrategy?.executeAction) {
            await this.currentStrategy.executeAction(action);
        }
    }

    /**
     * Returns the current strategy's interaction method summary (if CDP).
     */
    getMethodSummary(): any[] {
        const strategy = this.currentStrategy as any;
        if (strategy && typeof strategy.getMethodSummary === 'function') {
            return strategy.getMethodSummary();
        }
        return [];
    }

    getStrategy(type: string): IStrategy | null {
        return this.currentStrategy;
    }

    dispose() {
        if (this.currentStrategy) {
            this.currentStrategy.dispose();
            this.currentStrategy = null;
        }
    }
}
