
import { createLogger } from '../utils/logger';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const log = createLogger('ProgressTracker');
const execAsync = promisify(exec);

export type ProgressErrorType = 'transport' | 'parse' | 'timeout' | 'policy' | 'unknown';

export interface ProgressErrorTaxonomy {
    transport: number;
    parse: number;
    timeout: number;
    policy: number;
    unknown: number;
}

export interface LoopStats {
    totalLoops: number;
    successfulLoops: number;
    failedLoops: number;
    modelSwitches: number;
    startTime: number;
    filesChanged: number;
    promptsSent: number;
    errorTaxonomy: ProgressErrorTaxonomy;
}

export class ProgressTracker {
    private workspaceRoot: string | null = null;

    private stats: LoopStats = {
        totalLoops: 0,
        successfulLoops: 0,
        failedLoops: 0,
        modelSwitches: 0,
        startTime: Date.now(),
        filesChanged: 0,
        promptsSent: 0,
        errorTaxonomy: {
            transport: 0,
            parse: 0,
            timeout: 0,
            policy: 0,
            unknown: 0
        }
    };

    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            this.workspaceRoot = folders[0].uri.fsPath;
        }
    }

    startSession() {
        this.stats = {
            totalLoops: 0,
            successfulLoops: 0,
            failedLoops: 0,
            modelSwitches: 0,
            startTime: Date.now(),
            filesChanged: 0,
            promptsSent: 0,
            errorTaxonomy: {
                transport: 0,
                parse: 0,
                timeout: 0,
                policy: 0,
                unknown: 0
            }
        };
        log.info('Session progress tracking started');
    }

    private async getFilesChanged(): Promise<number> {
        if (!this.workspaceRoot) {
            return 0;
        }

        try {
            const { stdout } = await execAsync('git diff --name-only', {
                cwd: this.workspaceRoot,
                timeout: 5000,
            });
            const files = stdout.split('\n').map(line => line.trim()).filter(Boolean);
            return files.length;
        } catch {
            return 0;
        }
    }

    private hashResponse(text: string): string {
        return createHash('sha256').update(text).digest('hex').slice(0, 16);
    }

    async recordLoop(result: { modelUsed: string; hasErrors: boolean; responseText?: string; errorType?: ProgressErrorType }): Promise<{ filesChanged: number; hasErrors: boolean; responseLength: number; responseHash: string }> {
        this.stats.totalLoops++;
        if (result.hasErrors) {
            this.stats.failedLoops++;
            const type: ProgressErrorType = result.errorType || 'unknown';
            this.stats.errorTaxonomy[type] = (this.stats.errorTaxonomy[type] || 0) + 1;
        } else {
            this.stats.successfulLoops++;
        }

        const filesChanged = await this.getFilesChanged();
        const responseText = String(result.responseText || '');
        const responseLength = responseText.length;
        const responseHash = this.hashResponse(responseText);

        this.stats.filesChanged += filesChanged;

        return {
            filesChanged,
            hasErrors: result.hasErrors,
            responseLength,
            responseHash
        };
    }

    recordModelSwitch() {
        this.stats.modelSwitches++;
    }

    recordPromptSent() {
        this.stats.promptsSent++;
    }

    getSummary(): string {
        const duration = (Date.now() - this.stats.startTime) / 1000 / 60;
        const successRate = this.stats.totalLoops > 0
            ? ((this.stats.successfulLoops / this.stats.totalLoops) * 100).toFixed(1)
            : '0.0';
        return `
Session Duration: ${duration.toFixed(1)} mins
Total Loops: ${this.stats.totalLoops}
Success Rate: ${successRate}%
Model Switches: ${this.stats.modelSwitches}
Prompts Sent: ${this.stats.promptsSent}
Error Types: transport=${this.stats.errorTaxonomy.transport}, parse=${this.stats.errorTaxonomy.parse}, timeout=${this.stats.errorTaxonomy.timeout}, policy=${this.stats.errorTaxonomy.policy}, unknown=${this.stats.errorTaxonomy.unknown}
        `.trim();
    }

    getStats(): LoopStats {
        return { ...this.stats };
    }

    getDurationMinutes(): number {
        return (Date.now() - this.stats.startTime) / 1000 / 60;
    }
}

export const progressTracker = new ProgressTracker();
