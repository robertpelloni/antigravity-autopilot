
import * as vscode from 'vscode';
import * as path from 'path';
import { DashboardPanel } from './ui/dashboard';
import { config } from './utils/config';
import { createLogger } from './utils/logger';
import { autonomousLoop } from './core/autonomous-loop';
// import { circuitBreaker } from './core/circuit-breaker'; // Removed unused import
import { progressTracker } from './core/progress-tracker';
import { mcpServer } from './modules/mcp/server';
import { voiceControl } from './modules/voice/control';
import { CDPHandler } from './services/cdp/cdp-handler';

import { StrategyManager } from './strategies/manager';
import { testGenerator } from './core/test-generator';
import { codeReviewer } from './core/code-reviewer';
import { agentOrchestrator } from './core/agent-orchestrator';
import { memoryManager } from './core/memory-manager';
import { projectManager } from './providers/project-manager';

import { StatusBarManager } from './ui/status-bar';
import { CDPStrategy, CDPRuntimeState } from './strategies/cdp-strategy';

const log = createLogger('Extension');
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('Antigravity Unified: Activation Started!');
    console.log('Antigravity Unified: Activation Started!');
    log.info('Antigravity Autopilot (Unified) activating...');

    // Initialize UI
    statusBar = new StatusBarManager(context);

    // Initialize Managers
    const strategyManager = new StrategyManager(context);

    const resolveCDPStrategy = (): CDPStrategy | null => {
        const strategy = strategyManager.getStrategy('cdp') as any;
        if (strategy && typeof strategy.getRuntimeState === 'function') {
            return strategy as CDPStrategy;
        }
        return null;
    };

    const refreshRuntimeState = async () => {
        try {
            const cdp = resolveCDPStrategy();
            if (!cdp || !cdp.isConnected()) {
                statusBar.updateRuntimeState(null);
                return;
            }

            const runtimeState = await cdp.getRuntimeState();
            statusBar.updateRuntimeState(runtimeState);
        } catch {
            statusBar.updateRuntimeState(null);
        }
    };

    // Wire up Status Bar to Autonomous Loop
    autonomousLoop.setStatusCallback(status => {
        statusBar.update({
            autonomousEnabled: status.running,
            loopCount: status.loopCount,
            autoAllEnabled: config.get('autoAllEnabled'),
            multiTabEnabled: config.get('multiTabEnabled'),
            mode: config.get('strategy')
        });
    });

    // Update Status Bar on Config Change
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravity')) {
            statusBar.update({
                autonomousEnabled: autonomousLoop.isRunning(),
                loopCount: 0, // We assume loop count preserves or resets? 
                autoAllEnabled: config.get('autoAllEnabled'),
                multiTabEnabled: config.get('multiTabEnabled'),
                mode: config.get('strategy')
            });
        }
    });

    // Initial Status Update
    statusBar.update({
        autonomousEnabled: autonomousLoop.isRunning(),
        loopCount: 0,
        autoAllEnabled: config.get('autoAllEnabled'),
        multiTabEnabled: config.get('multiTabEnabled'),
        mode: config.get('strategy')
    });

    // Phase 39: Manual Triggers & Error Suppression
    // Note: cdpStrategy is expected to be defined elsewhere or passed into this scope.
    // For now, it's left as potentially undefined, which TypeScript will flag.
    // Assuming `cdpStrategy` refers to an instance of CDPHandler or similar.
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.getChromeDevtoolsMcpUrl', async () => {
            return 'ws://localhost:9222'; // Dummy return to satisfy whatever is calling this
        }),
        vscode.commands.registerCommand('antigravity.clickRun', () => resolveCDPStrategy()?.executeAction('run')),
        vscode.commands.registerCommand('antigravity.clickExpand', () => resolveCDPStrategy()?.executeAction('expand')),
        vscode.commands.registerCommand('antigravity.clickAccept', () => resolveCDPStrategy()?.executeAction('accept')),
        vscode.commands.registerCommand('antigravity.resetConnection', async () => {
            const cdpStrategy = resolveCDPStrategy();
            if (cdpStrategy) {
                vscode.window.showInformationMessage('Restoring Anti-Gravity...');
                try {
                    await strategyManager.stop();
                    await strategyManager.start();
                    vscode.window.showInformationMessage('Anti-Gravity Reset Complete.');
                } catch (e) { vscode.window.showErrorMessage(`Reset Failed: ${e}`); }
            }
        })
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.toggleExtension', async () => {
            await strategyManager.toggle();
            // Status bar update triggered by config listener or loop callback
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAccept', async () => {
            await config.update('autoAcceptEnabled', !config.get('autoAcceptEnabled'));
            await strategyManager.start();
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAll', async () => {
            const current = config.get<boolean>('autoAllEnabled');
            await config.update('autoAllEnabled', !current);
            if (!current) {
                await config.update('strategy', 'cdp');
            }
            await strategyManager.start();
            await refreshRuntimeState();
        }),
        vscode.commands.registerCommand('antigravity.toggleAutonomous', async () => {
            const isRunning = autonomousLoop.isRunning();
            if (isRunning) {
                autonomousLoop.stop('User toggled off');
                await config.update('autonomousEnabled', false);
            } else {
                await autonomousLoop.start();
                await config.update('autonomousEnabled', true);
            }
        }),
        vscode.commands.registerCommand('antigravity.openSettings', () => {
            DashboardPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('antigravity.toggleMcp', async () => {
            const current = config.get<boolean>('mcpEnabled');
            if (current) {
                await mcpServer.stop();
            } else {
                await mcpServer.start();
            }
            await config.update('mcpEnabled', !current);
        }),
        vscode.commands.registerCommand('antigravity.toggleVoice', async () => {
            const current = config.get<boolean>('voiceControlEnabled');
            if (current) {
                await voiceControl.stop();
            } else {
                await voiceControl.start();
            }
            await config.update('voiceControlEnabled', !current);
        }),
        vscode.commands.registerCommand('antigravity.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await testGenerator.generateTestsForFile(editor.document.fileName);
            } else {
                vscode.window.showErrorMessage('No active file to generate tests for');
            }
        }),
        vscode.commands.registerCommand('antigravity.runCodeReview', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const code = editor.document.getText();
                const result = codeReviewer.review(code, editor.document.fileName);

                // Show diagnostics
                const diagnostics = codeReviewer.showDiagnostics(editor.document, result.issues);
                const collection = vscode.languages.createDiagnosticCollection('antigravity-review');
                collection.set(editor.document.uri, diagnostics);

                if (result.passed) {
                    vscode.window.showInformationMessage(`Code Review Passed! Score: ${result.score}`);
                } else {
                    vscode.window.showWarningMessage(`Code Review Failed. Score: ${result.score}. See Problems panel.`);
                }
            } else {
                vscode.window.showErrorMessage('No active file to review');
            }
        }),
        vscode.commands.registerCommand('antigravity.startMultiAgent', async () => {
            const task = await vscode.window.showInputBox({ prompt: 'Enter task for Multi-Agent System' });
            if (task) {
                await agentOrchestrator.coordinateAgents(task);
            }
        }),
        vscode.commands.registerCommand('antigravity.showMemory', async () => {
            const memories = memoryManager.getRecentMemories(20);
            const items = memories.map(m => {
                const lines = m.content.split('\n');
                const preview = lines[0].substring(0, 60) + (lines[0].length > 60 ? '...' : '');
                return {
                    label: `[${m.type.toUpperCase()}] ${preview}`,
                    description: new Date(m.timestamp).toLocaleString(),
                    detail: m.content // Full content accessible? VS Code might truncate detail.
                };
            });
            const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Recent Memories (Select to view full)' });
            if (selection && selection.detail) {
                // Show full content in a document or nice output
                const doc = await vscode.workspace.openTextDocument({ content: selection.detail, language: 'markdown' });
                await vscode.window.showTextDocument(doc);
            }
        }),
        vscode.commands.registerCommand('antigravity.showStatusMenu', async () => {
            const items = [
                {
                    label: '$(rocket) Start Autonomous Loop (Yoke)',
                    description: 'Full AI Agent Mode',
                    action: 'antigravity.toggleAutonomous'
                },
                {
                    label: '$(pulse) Enable Auto-All (CDP)',
                    description: 'Auto-edits & Terminal (Passive)',
                    action: 'antigravity.toggleAutoAll'
                },
                {
                    label: '$(check) Enable Auto-Accept (Simple)',
                    description: 'Basic Auto-Accept only',
                    action: 'antigravity.toggleAutoAccept'
                },
                {
                    label: '$(gear) Open Dashboard',
                    description: 'Configure settings',
                    action: 'antigravity.openSettings'
                }
            ];

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'Antigravity Status: Select Mode'
            });

            if (selection && selection.action) {
                vscode.commands.executeCommand(selection.action);
            }
        }),
        vscode.commands.registerCommand('antigravity.syncProjectTasks', async () => {
            await projectManager.syncFromFixPlan();
            vscode.window.showInformationMessage('Project tasks synced from @fix_plan.md');
        }),
        vscode.commands.registerCommand('antigravity.checkRuntimeState', async () => {
            const cdp = resolveCDPStrategy();
            if (!cdp) {
                vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                return;
            }

            const state = await cdp.getRuntimeState();
            if (!state) {
                vscode.window.showWarningMessage('Antigravity: Runtime state unavailable (CDP not connected or script not injected yet).');
                return;
            }

            const status = state.status || 'unknown';
            const done = state.doneTabs ?? 0;
            const total = state.totalTabs ?? 0;
            const pending = state.pendingAcceptButtons ?? 0;
            const waiting = state.waitingForChatMessage ? 'yes' : 'no';

            statusBar.updateRuntimeState(state);
            log.info(`[RuntimeState] status=${status} tabs=${done}/${total} pending=${pending} waitingForChatMessage=${waiting}`);
            vscode.window.showInformationMessage(`Antigravity Runtime: ${status} | tabs ${done}/${total} | pending ${pending} | waiting chat: ${waiting}`);
        })
    );

    const runtimeStateTimer = setInterval(() => {
        refreshRuntimeState().catch(() => { });
    }, 3000);
    context.subscriptions.push({ dispose: () => clearInterval(runtimeStateTimer) });

    // Initialize based on saved config
    // 1. Strategy (Core Driver)
    if (config.get('autoAllEnabled') || config.get('autoAcceptEnabled')) {
        strategyManager.start().catch(e => log.error(`Failed to start strategy: ${e.message}`));
    }

    refreshRuntimeState().catch(() => { });

    // 2. Autonomous Loop
    if (config.get('autonomousEnabled')) {
        autonomousLoop.start().catch(e => log.error(`Failed to start autonomous loop: ${e.message}`));
    }

    // 3. Modules
    if (config.get('mcpEnabled')) {
        mcpServer.start().catch(e => log.error(`MCP start failed: ${e.message}`));
    }
    if (config.get('voiceControlEnabled')) {
        voiceControl.start().catch(e => log.error(`Voice start failed: ${e.message}`));
    }

    log.info('Antigravity Autopilot activated!');
}

export function deactivate() {
    autonomousLoop.stop('Deactivating');
    mcpServer.stop();
    voiceControl.stop();
    if (statusBar) statusBar.dispose();
    log.info('Antigravity Autopilot deactivated');
}
