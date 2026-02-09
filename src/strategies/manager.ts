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

    getStrategy(type: string): IStrategy | null {
        // Return current if matches constraint or generic
        // For now, Antigravity only has one active strategy at a time
        return this.currentStrategy;
    }
}
